"""Bounded public-index discovery for the on-demand research agents.

Exa explicitly offers a keyless MCP search trial. This client uses that search
tool only. It never opens a returned source URL, never uses a personal account,
and never treats a search excerpt as a verified listing or parcel location.
"""
from __future__ import annotations

import asyncio
import copy
import ipaddress
import json
import math
import re
import time
import unicodedata
from datetime import datetime, timezone
from urllib.parse import unquote, urlsplit, urlunsplit

import httpx

MCP_ENDPOINT = "https://mcp.exa.ai/mcp"
PROVIDER = "Exa"
MAX_QUERIES = 3
MAX_CANDIDATES = 30
MAX_RESPONSE_BYTES = 1_500_000
SEARCH_TIMEOUT = 36
CACHE_SECONDS = 300
_cache = {}
_semaphore = asyncio.Semaphore(2)


def _get(req, field, default=""):
    return req.get(field, default) if isinstance(req, dict) else getattr(req, field, default)


def _norm(value):
    text = str(value or "").replace("ı", "i").replace("İ", "I")
    text = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _place(value):
    return " ".join(x for x in _norm(value).split() if x not in {"mah", "mahalle", "mahallesi", "koy", "koyu"})


def _now():
    return datetime.now(timezone.utc).isoformat()


def _emit(progress, status, message, **counts):
    if progress:
        progress({"status": status, "message": message, "counts": counts})


def safe_url(value):
    """Links only; this is never permission to fetch a returned URL."""
    try:
        u = urlsplit(str(value).strip())
        host = (u.hostname or "").lower().rstrip(".")
        if u.scheme != "https" or not host or u.username or u.password or u.port not in {None, 443}:
            return None
        if len(value) > 1800 or any(c.isspace() or ord(c) < 32 for c in str(value)):
            return None
        if "." not in host or host.endswith((".local", ".internal", ".localhost", ".test")):
            return None
        try:
            if not ipaddress.ip_address(host).is_global:
                return None
        except ValueError:
            pass
        return urlunsplit(("https", u.netloc.lower(), u.path, u.query, ""))
    except (ValueError, TypeError):
        return None


def source_name(url):
    host = (urlsplit(url).hostname or "").lower()
    names = {"sahibinden.com": "Sahibinden", "emlakjet.com": "Emlakjet", "remax.com.tr": "RE/MAX",
             "hepsiemlak.com": "Hepsiemlak", "endeksa.com": "Endeksa", "zingat.com": "Zingat",
             "cb.com.tr": "Coldwell Banker", "coldwellbanker.com.tr": "Coldwell Banker",
             "turyap.com.tr": "Turyap", "emlakclick.com": "EmlakClick", "century21.com.tr": "Century 21"}
    for domain, name in names.items():
        if host == domain or host.endswith("." + domain):
            return name
    return host.removeprefix("www.")


def query_plan(req, subject=None):
    region = " ".join(str(_get(req, x)).strip() for x in ("province", "district", "place"))
    nature = "tarla" if _get(req, "zoning") == "field" else "konut villa imarlı arsa"
    # Neighbouring listings have different cadastral identifiers. Broad regional
    # queries discover them; the objective supplies the trusted target context.
    return [
        f"{region} satılık {nature} fiyat metrekare ada parsel emsal ilanlar",
        f"site:sahibinden.com {region} satılık arsa ilan fiyat m²",
        f"{region} satılık {nature} hepsiemlak emlakjet remax yeni ilanlar",
    ]


def _decode_rpc(text, expected_id):
    try:
        body = json.loads(text)
        if isinstance(body, dict) and body.get("id") == expected_id:
            return body
    except ValueError:
        pass
    for event in re.split(r"\r?\n\r?\n", text):
        data = "\n".join(line[5:].lstrip() for line in event.splitlines() if line.startswith("data:"))
        if not data:
            continue
        try:
            body = json.loads(data)
        except ValueError:
            continue
        if isinstance(body, dict) and body.get("id") == expected_id:
            return body
    raise ValueError("Arama yanıtının biçimi okunamadı")


async def _rpc(client, payload, headers=None):
    async with client.stream("POST", MCP_ENDPOINT, json=payload, headers=headers or {}) as response:
        response.raise_for_status()
        chunks = []
        size = 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > MAX_RESPONSE_BYTES:
                raise ValueError("Arama yanıtı boyut sınırını aştı")
            chunks.append(chunk)
        raw = b"".join(chunks).decode("utf-8", "replace")
        if "id" not in payload:
            return {}, response.headers
        body = _decode_rpc(raw, payload["id"])
        if body.get("error"):
            raise ValueError("Arama sağlayıcısı sorguyu tamamlayamadı")
        return body.get("result", {}), response.headers


def _blocks(result):
    structured = result.get("structuredContent")
    if isinstance(structured, dict):
        rows = structured.get("results")
        if isinstance(rows, dict):
            rows = rows.get("web") or rows.get("results")
        if isinstance(rows, list):
            for row in rows:
                if isinstance(row, dict):
                    yield {"title": row.get("title", ""), "url": row.get("url", ""),
                           "text": row.get("text") or row.get("description") or " ".join(row.get("highlights") or row.get("snippets") or [])}
            return
    for content in result.get("content", []):
        if not isinstance(content, dict) or content.get("type") != "text":
            continue
        text = content.get("text", "")
        # Current hosted Exa tool returns labelled blocks, not untrusted HTML.
        for match in re.finditer(r"(?m)^Title:\s*(.*?)\r?\nURL:\s*(\S+)\s*\r?\n", text):
            start = match.end()
            end = re.search(r"(?m)^Title:\s", text[start:])
            body = text[start:start + end.start()] if end else text[start:]
            body = re.sub(r"\A(?:Published:.*\n|Author:.*\n|\s*\n)*", "", body)
            body = re.sub(r"\AHighlights:\s*", "", body)
            yield {"title": match.group(1).strip(), "url": match.group(2), "text": body.strip()}


def _number(text):
    text = text.strip()
    if re.fullmatch(r"\d{1,3}(?:[.,]\d{3}){2,}", text):
        text = re.sub(r"[.,]", "", text)
    elif "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".") if text.rfind(",") > text.rfind(".") else text.replace(",", "")
    elif re.fullmatch(r"\d{1,3}(?:\.\d{3})+", text):
        text = text.replace(".", "")
    elif "," in text:
        text = text.replace(",", ".")
    try:
        value = float(text)
        return value if value > 0 and math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def excerpt_numbers(text):
    """Only unambiguous values in the leading excerpt, never a valuation."""
    text = re.split(r"(?mi)^\s*#{0,4}\s*(?:İlan Açıklaması|Açıklama|Description)\s*$", text, maxsplit=1)[0][:2600]
    prices = set()
    for m in re.finditer(r"(?<![\d.,])([\d]+(?:[.,]\d+)*)\s*(?:TL|TRY|₺)(?!\w)", text, re.I):
        after = text[m.end():m.end() + 12]
        before = _norm(text[max(0, m.start() - 25):m.start()])
        if re.match(r"\s*/\s*m", after, re.I) or before.endswith(("m2 fiyati", "birim fiyati")):
            continue
        value = _number(m.group(1))
        if value:
            prices.add(value)
    labelled = {_number(m.group(1)) for m in re.finditer(r"(?mi)^\s*(?:[-*]\s*)?(?:Metrekare(?:\s*\(m[²2]\))?|Arsa\s*(?:Alanı|m[²2])|m[²2])\s*[:|]?\s*([\d]+(?:[.,]\d+)*)(?:\s*m[²2])?\s*$", text)}
    labelled.discard(None)
    # A standalone land-area label is stronger than construction rights in a
    # marketing paragraph. Without a label, restrict extraction to the header.
    areas = labelled or {_number(m.group(1)) for m in re.finditer(r"(?<![\d.,])([\d]+(?:[.,]\d+)*)\s*m[²2](?!\w)", text[:800], re.I)}
    areas.discard(None)
    return {"asking_price": next(iter(prices)) if len(prices) == 1 else None,
            "area": next(iter(areas)) if len(areas) == 1 else None}


def candidate_type(url):
    host, path = urlsplit(url).hostname or "", urlsplit(url).path
    if host == "sahibinden.com" or host.endswith(".sahibinden.com"):
        return "listing" if path.startswith("/ilan/") else "category"
    if host in {"emlakjet.com", "www.emlakjet.com"}:
        return "listing" if path.startswith("/ilan/") else "category"
    if host in {"remax.com.tr", "www.remax.com.tr"}:
        return "listing" if re.fullmatch(r"/tr/portfoy/P\d+/?", path) else "category"
    if host in {"hepsiemlak.com", "www.hepsiemlak.com"}:
        return "listing" if re.search(r"/\d+-\d+/?$", path) else "category"
    if re.search(r"/(?:ilan|emlak)/.+|/\d{5,}/?$|[-/]\d{5,}(?:\.html)?/?$", path):
        return "listing"
    return "reference"


def _region_match(title, url, excerpt, req):
    province, district, place = (_norm(_get(req, "province")), _norm(_get(req, "district")), _place(_get(req, "place")))
    if not province or not district or not place:
        return False
    identity = _norm(title + " " + unquote(url))
    has = lambda needle, text: bool(re.search(r"\b" + re.escape(needle) + r"\b", text))
    # A nearby-place description is discovery of another place, not evidence
    # that a listing belongs to this query. Exact distances are resolved later.
    if re.search(r"\b" + re.escape(place) + r"\b.{0,25}\b(?:yakin|yakininda|civarinda)\b", _norm(title)):
        return False
    province_in_address, place_in_address = False, False
    for line in excerpt[:1800].splitlines():
        if len(line) > 200 or not re.search(r"[/,>›]", line):
            continue
        address = _norm(line)
        if has(province, address) and has(district, address):
            province_in_address = True
            place_in_address = place_in_address or has(place, address)
    return (has(province, identity) or province_in_address) and (has(place, identity) or place_in_address)


def parse_candidates(result, req, query, checked_at=None):
    now = checked_at or _now()
    region = _norm(_get(req, "province"))
    place = _place(_get(req, "place"))
    rows, rejected = [], 0
    for block in _blocks(result):
        url = safe_url(block.get("url"))
        title = str(block.get("title") or "").strip()
        excerpt = str(block.get("text") or "")[:6000]
        lead = _norm(title + " " + unquote(url or "") + " " + excerpt[:1800])
        # A source may relax search operators. Never trust the submitted query
        # as evidence that a returned listing is in the requested locality.
        if not url or not _region_match(title, url, excerpt, req):
            rejected += 1
            continue
        # Completed apartments/villas are not land comparables. Search engines
        # may broaden a land query; inspect each item's own heading/category.
        property_identity = _norm(title + " " + unquote(url or ""))
        land_category = bool(re.search(r"\b(?:satilik (?:konut imarli|villa imarli|tarla|arsa)|konut imarli satilik)\b", _norm(excerpt[:1000])))
        if not re.search(r"\b(arsa|arsasi|arazi|tarla|parsel|imarli)\b", property_identity) and not land_category:
            rejected += 1
            continue
        if not title or title == "N/A":
            title = next((line.lstrip("# ").strip() for line in excerpt.splitlines() if line.strip() and not line.startswith(("---", "description:", "image:"))), source_name(url))[:220]
        excerpt = re.sub(r"(?m)^Author:.*$", "", excerpt)
        snippet = re.sub(r"\s+", " ", excerpt).strip()[:700]
        row = {"title": title[:240], "url": url, "snippet": snippet, "source": source_name(url),
               "provider": PROVIDER, "query": query, "queries": [query], "checked_at": now,
               "candidate_type": candidate_type(url),
               "evidence_status": "search_index", "discovery_only": True, "location_verified": False,
               "detail_verified": False, "distance_m": None,
               "price_note": "Arama kaydındaki talep fiyatı; ilan sayfası, aktiflik ve 1 km mesafe henüz doğrulanmadı."}
        row.update(excerpt_numbers(title + " " + excerpt) if row["candidate_type"] == "listing" else {"asking_price": None, "area": None})
        rows.append(row)
    return rows, rejected


async def search(req, subject=None, progress=None, transport=None):
    key = tuple(_norm(_get(req, field)) for field in ("province", "district", "place", "zoning", "block", "parcel")) + (str((subject or {}).get("area")),)
    now = time.monotonic()
    if transport is None and key in _cache and now - _cache[key][0] < CACHE_SECONDS:
        result = copy.deepcopy(_cache[key][1])
        result["cached"] = True
        _emit(progress, "complete", "Son 5 dakikada aynı parsel için alınan arama sonuçları kullanıldı.", candidates=len(result["candidates"]), queries=len(result["queries"]))
        return result
    result = {"provider": PROVIDER, "status": "empty", "candidates": [], "queries": [], "notes": [],
              "checked_at": _now(), "matched_count": 0, "rejected_count": 0, "cached": False,
              "access_mode": "keyless_trial", "source_fetches": 0}
    unique = {}

    async def execute():
        async with _semaphore:
            headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json", "User-Agent": "EmlakCafeResearch/1.1"}
            async with httpx.AsyncClient(timeout=httpx.Timeout(14), headers=headers, follow_redirects=False, transport=transport) as client:
                _emit(progress, "running", "Web arama bağlantısı kuruluyor.", candidates=0, queries=0)
                init, response_headers = await _rpc(client, {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                    "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "emlak-cafe-research", "version": "1.0"}}})
                session_headers = {"MCP-Protocol-Version": init.get("protocolVersion", "2025-03-26")}
                if response_headers.get("mcp-session-id"):
                    session_headers["Mcp-Session-Id"] = response_headers["mcp-session-id"]
                await _rpc(client, {"jsonrpc": "2.0", "method": "notifications/initialized"}, session_headers)
                for idx, query in enumerate(query_plan(req, subject)[:MAX_QUERIES]):
                    _emit(progress, "running", f"Web araması {idx + 1}/{MAX_QUERIES}: {_get(req, 'place')} satılık ilanları.", candidates=len(unique), queries=len(result["queries"]))
                    objective = (f"Find public individual real-estate sale listings in {_get(req, 'province')} / {_get(req, 'district')} / {_get(req, 'place')}, Turkey. "
                        "Prefer exact locality, asking price, square metres, cadastral block/parcel and listing date. "
                        "Exclude other provinces with the same village name, rentals, sold claims, social-media profiles and general investment articles. "
                        "Use search index results only. Do not infer activity, official zoning, authorization, or exact distance from search text.")
                    if isinstance(subject, dict) and isinstance(subject.get("area"), (int, float)) and subject["area"] > 0:
                        objective += (f" The target parcel, independently returned by TKGM, is block {_get(req, 'block')} / parcel {_get(req, 'parcel')}, "
                            f"area {subject['area']} square metres, recorded nature {subject.get('nature', 'unknown')}. "
                            f"Prefer land between {subject['area'] * .5:.0f} and {subject['area'] * 2:.0f} square metres. "
                            "Nearby comparables usually have DIFFERENT block/parcel numbers; do not restrict discovery to the target itself.")
                        if isinstance(subject.get("center"), (list, tuple)) and len(subject["center"]) == 2:
                            objective += f" Target latitude/longitude: {subject['center']}. The application separately verifies the requested 1 km radius."
                    result["queries"].append(query)
                    found, _ = await _rpc(client, {"jsonrpc": "2.0", "id": 10 + idx, "method": "tools/call",
                        "params": {"name": "web_search_exa", "arguments": {"query": query, "objective": objective, "numResults": 10}}}, session_headers)
                    if found.get("isError"):
                        raise ValueError("Arama aracı sorguyu tamamlayamadı; sağlayıcı sınırına ulaşılmış olabilir")
                    rows, rejected = parse_candidates(found, req, query, result["checked_at"])
                    result["rejected_count"] += rejected
                    for row in rows:
                        if row["url"] in unique:
                            unique[row["url"]]["queries"].append(query)
                        elif len(unique) < MAX_CANDIDATES:
                            unique[row["url"]] = row
                    # Two searches suffice when broad and Sahibinden-index
                    # discovery have already yielded enough regional candidates.
                    if idx >= 1 and len(unique) >= 15:
                        break
                result["status"] = "ok" if unique else "empty"

    try:
        await asyncio.wait_for(execute(), SEARCH_TIMEOUT)
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        result["status"] = "partial" if unique else "blocked" if code in {401, 403, 429} else "error"
        result["notes"].append(f"Arama sağlayıcısı HTTP {code} döndürdü. Otomatik tekrar yapılmadı.")
    except (TimeoutError, httpx.TimeoutException):
        result["status"] = "partial" if unique else "error"
        result["notes"].append("Web aramasının süre sınırı doldu; tamamlanan sorgular korundu.")
    except (httpx.RequestError, ValueError):
        result["status"] = "partial" if unique else "error"
        result["notes"].append("Web arama bağlantısı veya yanıtı tamamlanamadı; mevcut kaynak okuyucuları çalışmaya devam eder.")
    result["candidates"] = list(unique.values())
    result["matched_count"] = len(unique)
    if not any(row["source"] == "Sahibinden" for row in unique.values()):
        result["notes"].append("Bu aramada Sahibinden için bölgeyle eşleşen indeks sonucu alınamadı; bu, bölgede ilan olmadığı anlamına gelmez.")
    result["notes"].append("Exa anahtarsız deneme araması; Google değildir. Sağlayıcının ücretsiz kullanım sınırına tabidir.")
    if transport is None and result["status"] in {"ok", "empty"}:
        if len(_cache) >= 64:
            _cache.pop(next(iter(_cache)))
        _cache[key] = (time.monotonic(), copy.deepcopy(result))
    status = "complete" if result["status"] in {"ok", "empty"} else result["status"]
    message = f"{len(unique)} bölgesel arama adayı bulundu; konum ve ilan sayfası ayrıca doğrulanacak."
    if status in {"error", "blocked"}:
        message = result["notes"][0]
    _emit(progress, status, message, candidates=len(unique), queries=len(result["queries"]), rejected=result["rejected_count"])
    return result
