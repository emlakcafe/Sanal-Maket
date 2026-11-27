"""Source-backed regional asking-price summaries; no network or parcel inference.

The selected locality is the scope, not an assumed 1 km circle. Search-index
observations remain separately labelled and never acquire page/active status.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
import ipaddress
import math
import re
import unicodedata
from urllib.parse import unquote, urlsplit, urlunsplit


MIN_RECORDS = 3
REASONS = {
    "unsafe_url": "Kaynak bağlantısı güvenli veya geçerli değil.",
    "not_listing": "Tek bir ilanı gösteren kaynak değil.",
    "dated_snapshot": "Önceki tarihli sabit araştırma kaydı güncel gruba alınmadı.",
    "not_current_detail": "Detay sayfasının bu sorguda okunduğu doğrulanmadı.",
    "region_mismatch": "İlanın kendi il/ilçe/mahalle-köy bilgisi seçili yerleşimle uyuşmuyor.",
    "region_unconfirmed": "İlanın kendi kaynağında il, ilçe ve mahalle/köy birlikte doğrulanamadı.",
    "building": "Tamamlanmış konut/bina veya kiralık ilanı arsa karşılaştırmasına alınmadı.",
    "share_sale": "Hisse/pay satışı müstakil arsayla karşılaştırılmadı.",
    "multiple_parcels": "Birden fazla parselin birlikte satışı tek parsel gibi değerlendirilmedi.",
    "unknown_kind": "Konut/villa imarlı arsa veya tarla türü kaynakta açık değil.",
    "kind_conflict": "Kaynakta taşınmaz türü veya imar bilgisi çelişiyor.",
    "missing_values": "Tekil ilan talep fiyatı ve arsa alanı birlikte okunamadı.",
    "conflicting_values": "Aynı kanıt içinde birbiriyle çelişen fiyat/alan değerleri var.",
    "parcel_area_conflict": "İlan alanıyla alınmış TKGM parsel alanı arasında uyuşmazlık var.",
    "subject_listing": "Sorgulanan taşınmazın kendi ilanı emsal olarak sayılmadı.",
    "size_mismatch": "İlan alanı hedef parselin yarısı ile iki katı arasındaki boyut aralığında değil.",
    "duplicate": "Aynı ilanın veya aynı parselin tekrar kaydı bir kez sayıldı.",
    "superseded_by_detail": "Bu ilanın okunmuş detay sayfası arama özeti yerine kullanıldı.",
    "authoritative_rejection": "Okunmuş detay sayfasındaki dışlama nedeni arama özetiyle geçersiz kılınmadı.",
    "conflicting_observations": "Aynı taşınmaz için eşit düzeydeki kaynaklarda fiyat/alan/tür çelişkisi var.",
}


def _norm(value):
    text = str(value or "").replace("ı", "i").replace("İ", "I")
    text = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _place(value):
    return " ".join(word for word in _norm(value).split() if word not in {"mah", "mahalle", "mahallesi", "koy", "koyu"})


def _positive(value):
    return float(value) if type(value) in (int, float) and math.isfinite(value) and value > 0 else None


def _number(value):
    text = str(value or "").strip()
    if not re.fullmatch(r"\d+(?:[.,]\d+)*", text):return None
    if re.fullmatch(r"\d{1,3}(?:[.,]\d{3}){2,}", text):text = re.sub(r"[.,]", "", text)
    elif "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".") if text.rfind(",") > text.rfind(".") else text.replace(",", "")
    elif re.fullmatch(r"\d{1,3}(?:\.\d{3})+", text):text = text.replace(".", "")
    elif "," in text:text = text.replace(",", ".")
    try:return _positive(float(text))
    except ValueError:return None


def _integer(value):
    number = _number(value)
    return str(int(number)) if number and number.is_integer() and number <= 999999999 else None


def _url(value):
    if not isinstance(value, str) or not value or len(value) > 2000 or value != value.strip():return None
    if "\\" in value or any(c.isspace() or ord(c) < 32 for c in value):return None
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").encode("idna").decode("ascii").lower().rstrip(".")
        if parsed.scheme != "https" or parsed.username is not None or parsed.password is not None or parsed.port not in (None, 443):return None
        if "." not in host or host.endswith((".local", ".localhost", ".internal", ".test", ".invalid", ".lan", ".home")):return None
        try:
            ipaddress.ip_address(host)
            return None
        except ValueError:pass
        if not re.fullmatch(r"[a-z0-9.-]+", host):return None
        # Listing paths identify these observations; fragments and tracking
        # query parameters must not turn a single property into duplicates.
        return urlunsplit(("https", host, parsed.path.rstrip("/"), "", ""))
    except (ValueError, UnicodeError):return None


def _identity(url):
    parsed = urlsplit(url)
    host = (parsed.hostname or "").removeprefix("www.").removeprefix("m.")
    path = parsed.path
    if host == "emlakjet.com":pattern = r"/ilan/[^/]+-(\d+)$"
    elif host == "sahibinden.com":pattern = r"/ilan/[^/]*?(\d{6,})(?:/detay)?$"
    elif host == "remax.com.tr":pattern = r"/(?:tr/portfoy|en/property)/(P\d+)$"
    elif host == "hepsiemlak.com":pattern = r"/(\d+-\d+)$"
    else:pattern = r"(?:/ilan/[^/]*?[-/]|/emlak/[^/]*?[-/]|/)(\d{5,})(?:\.html)?$"
    match = re.search(pattern, path, re.I)
    return (host, match.group(1).lower()) if match else None


def _header(value):
    # Preserve header values and labelled attributes; discard later narrative,
    # related listings and automated regional-price widgets when delimited.
    text = str(value or "")[:3000]
    marker = re.search(r"(?:#{1,5}\s*(?:İlan\s+)?Açıklama\b|\b(?:Benzer İlanlar|Bölge Raporu|EmlakZeka|Fiyat Değişimi)\b|İlan Açıklaması\s*:)", text, re.I)
    return text[:marker.start()] if marker else text


def _header_values(text):
    prices = set()
    for match in re.finditer(r"(?<![\d.,])([\d]+(?:[.,]\d+)*)\s*(?:TL|TRY|₺)(?!\w)", text, re.I):
        if re.match(r"\s*/\s*m", text[match.end():], re.I):continue
        if _norm(text[max(0, match.start()-35):match.start()]).endswith(("m2 fiyati", "birim fiyati")):continue
        value = _number(match.group(1))
        if value:prices.add(value)
    for match in re.finditer(r"(?:₺|\bTL|\bTRY)\s*([\d]+(?:[.,]\d+)*)", text, re.I):
        preceding = text[:match.start()].rstrip()
        if preceding and preceding[-1].isdigit():continue
        if re.match(r"\s*(?:TL|TRY|₺)?\s*/\s*m", text[match.end():], re.I):continue
        value = _number(match.group(1))
        if value:prices.add(value)
    labelled = set()
    pattern = r"(?:\bMetrekare|\bMetre\s*Kare|\bArsa\s*Alanı|\bm[²2])\s*(?:\(m[²2]\))?\s*(?!Birim\b|Fiyatı\b)[:|]?\s*([\d]+(?:[.,]\d+)*)"
    for match in re.finditer(pattern, text, re.I):
        # In "500 m² 4.000.000 TL", m² closes the previous value; it is
        # not an area label for the following price. Unit-price labels also
        # sometimes lose their "Birim Fiyatı" text in search snippets.
        if re.match(r"m[²2]",match.group(),re.I) and re.search(r"\d[\d.,]*\s*$",text[:match.start()]):continue
        if re.match(r"\s*(?:TL|TRY|₺|/\s*m[²2])",text[match.end():],re.I):continue
        value = _number(match.group(1))
        if value:labelled.add(value)
    unlabelled = set()
    for match in re.finditer(r"(?<![\d.,])([\d]+(?:[.,]\d+)*)\s*m[²2](?!\w)",text[:400],re.I):
        following = _norm(text[match.end():match.end()+55])
        preceding = _norm(text[max(0,match.start()-35):match.start()])
        if re.match(r"(?:brut|net|insaat|kullanim|kapali|bina|gross|net)\b",following):continue
        if re.search(r"\b(?:insaat|brut|net|kullanim|kapali|bina) (?:alani |hakki )?$",preceding):continue
        unlabelled.add(_number(match.group(1)))
    areas = labelled or unlabelled
    areas.discard(None)
    return prices, areas


def _region(row, req, indexed):
    address = row.get("address")
    wanted = (_norm(req.get("province")), _norm(req.get("district")), _place(req.get("place")))
    if not all(wanted):return None, "region_unconfirmed"
    if isinstance(address, dict) and all(address.get(k) for k in ("province", "district", "place")):
        actual = (_norm(address["province"]), _norm(address["district"]), _place(address["place"]))
        return (deepcopy(address), None) if actual == wanted else (None, "region_mismatch")
    if not indexed:return None, "region_unconfirmed"
    title = _place(row.get("title", ""))
    snippet = _header(row.get("snippet", ""))
    path = _place(unquote(urlsplit(row.get("url", "")).path))
    # A query or scattered mentions of a province and a nearby village are
    # not the source's own address. Titles/URLs must contain one ordered
    # contiguous triplet; body text additionally needs address separators.
    ordered = (" ".join(wanted)," ".join(reversed(wanted)))
    direct = any(re.search(r"\b"+re.escape(triple)+r"\b",text) for triple in ordered for text in (title,path))
    proximity = r"\b"+re.escape(wanted[2])+r"(?:e|a|ne|na|ye|ya)?\b.{0,15}\b(?:yakin\w*|civar\w*)\b"
    if re.search(proximity,title):return None,"region_mismatch"
    suffix = r"(?:\s+(?:Köyü|Koyu|Mahallesi|Mah\.?))?"
    separator = r"\s*[,/>|–-]\s*"
    raw_names = [str(req.get(key,"")) for key in ("province","district","place")]
    raw_names[-1] = re.sub(r"\s+(?:Köyü|Koyu|Mahallesi|Mah\.?)$","",raw_names[-1],flags=re.I)
    # An explicit source address outranks an otherwise matching title. In
    # particular, "Yenimahalle Köyü, Termal, Yalova" cannot become Akköy
    # because the search engine retained Akköy in its title.
    letters = r"[A-Za-zÇĞİÖŞÜçğıöşü]+"
    place_name = letters+r"(?:\s+"+letters+r"){0,3}\.?"
    reverse_address = r"("+place_name+r")"+separator+re.escape(raw_names[1])+separator+re.escape(raw_names[0])+r"\b"
    for match in re.finditer(reverse_address,snippet,re.I):
        actual=_place(match.group(1))
        if actual != wanted[2] and not actual.endswith(" "+wanted[2]):return None,"region_mismatch"
    forward_address = re.escape(raw_names[0])+separator+re.escape(raw_names[1])+separator+r"("+place_name+r")"
    for match in re.finditer(forward_address,snippet,re.I):
        actual=re.split(r"\s+(?:Haritada|Metrekare|İlan|Satılık)\b",match.group(1),flags=re.I)[0]
        actual=_place(actual)
        if actual != wanted[2] and not actual.startswith(wanted[2]+" "):return None,"region_mismatch"
    explicit = False
    for names in (raw_names,list(reversed(raw_names))):
        pattern = separator.join(re.escape(name)+suffix for name in names)
        for match in re.finditer(pattern,snippet,re.I):
            nearby = _norm(snippet[max(0,match.start()-40):match.end()+30])
            if not re.search(r"\b(?:kiyas|karsilastirma|karsilastir|civar|yakin)\w*\b",nearby):explicit=True
    if not (direct or explicit):return None, "region_unconfirmed"
    return {k:str(req.get(k,"")) for k in ("province","district","place")}, None


def _kind(row, text):
    fields = row.get("field_evidence") or {}
    explicit = _norm(str(fields.get("zoning", ""))+" "+str(fields.get("category", "")))
    combined = _norm(text + " " + str(fields.get("category", "")) + " " + str(fields.get("zoning", "")))
    if re.search(r"\b(?:sanayi|ticari|turizm|akaryakit|depolama)\b", explicit or combined):return None
    field = bool(re.search(r"\b(?:tarla|tarim arazisi|bag bahce|bag ve bahce|bahce)\b", explicit or combined))
    residential = bool(re.search(r"\b(?:konut imarli|villa imarli|imarli konut|imarli villa)\b", explicit or combined) or _norm(fields.get("zoning")) in {"konut","villa"} or re.search(r"\bimar durumu (?:konut|villa)\b", combined))
    observed = row.get("kind")
    if field and residential:return None
    if observed in {"residential","field"}:
        if (observed == "residential" and field and not residential) or (observed == "field" and residential and not field):return None
        return observed
    return "field" if field else "residential" if residential else None


def _block_parcel(row, header):
    values = []
    for key in ("block","parcel"):
        supplied = _integer(row.get(key))
        label = "ada" if key == "block" else "parsel"
        matches = {_integer(m.group(1)) for m in re.finditer(r"\b"+label+r"\s*(?:No|Numarası)?\s*[:|]?\s*(\d+(?:\.\d{3})*)\b", header, re.I)}
        matches.discard(None)
        if not matches:
            matches = {_integer(m.group(1)) for m in re.finditer(r"\b(\d+(?:\.\d{3})*)\s*"+label+r"\b", header, re.I)}
            matches.discard(None)
        if supplied:matches.add(supplied)
        values.append(next(iter(matches)) if len(matches) == 1 else None)
    return values


def _keys(row, url, address=None, block=None, parcel=None):
    keys = set()
    for value in [url] + list(row.get("source_urls") or []):
        safe = _url(value)
        if not safe:continue
        parsed = urlsplit(safe)
        keys.add(("url", (parsed.hostname or "").removeprefix("www.").removeprefix("m."), parsed.path))
        identity = _identity(safe)
        if identity:keys.add(("listing",)+identity)
    address = address or row.get("address") or {}
    block, parcel = block or _integer(row.get("block")), parcel or _integer(row.get("parcel"))
    if block and parcel and all(address.get(k) for k in ("province","district","place")):
        keys.add(("cadastre",_norm(address["province"]),_norm(address["district"]),_place(address["place"]),block,parcel))
        if str(row.get("locality_id","")).isdigit():keys.add(("cadastre_id",str(row["locality_id"]),block,parcel))
    return keys


def _observation(row, req, indexed):
    if not isinstance(row, dict):return None, "missing_values"
    url = _url(row.get("url"))
    if not url:return None, "unsafe_url"
    if not _identity(url) or indexed and row.get("candidate_type") != "listing":return None, "not_listing"
    if not indexed and (row.get("observed_on") or row.get("reader") == "dated-source-observation"):return None, "dated_snapshot"
    if not indexed and not (row.get("live") and row.get("detail_verified")):return None, "not_current_detail"
    if indexed and row.get("evidence_status") != "search_index":return None, "not_current_detail"
    address, error = _region(row, req, indexed)
    if error:return None, error
    header = _header(row.get("snippet", "")) if indexed else ""
    text = str(row.get("title", "")) + " " + header
    normalized = _norm(text)
    fields = row.get("field_evidence") or {}
    ownership = _norm(str(fields.get("ownership", "")))
    category = _norm(fields.get("category", ""))
    if re.search(r"\b(?:daire|apartman|rezidans|residans|mustakil ev|kiralik|bina)\b",category):return None,"building"
    if "villa" in category and "imarli" not in category and not re.search(r"\b(?:arsa\w*|arazi|parsel\w*)\b",category):return None,"building"
    if re.search(r"(?<!\d)[1-9]\s*\+\s*\d(?!\d)",text) or re.search(r"\b(?:daire|apartman|rezidans|residans|mustakil ev|kiralik|satilik bina)\b",normalized):return None,"building"
    if re.search(r"\b(?:tamamlanmis villa|insasi tamamlanmis|oturuma hazir|kullanima hazir|iskanli villa|esyali villa)\b",normalized):return None,"building"
    if re.search(r"\bsatilik villa\b(?! imarli)", normalized) and not re.search(r"\b(?:arsa\w*|arazi|parsel\w*)\b", normalized):return None, "building"
    if row.get("share_sale") or re.search(r"\b(?:hisseli|hisse|hissesi|payli|musterek|istirak)\b", ownership):return None, "share_sale"
    without_negations = re.sub(r"\b(?:hisseli degil|hisse yok|hissesi yok)\b", "", normalized)
    if re.search(r"\b(?:hisse|hissesi|hisseli|pay satiligi)\b", without_negations):return None, "share_sale"
    if row.get("multi_parcel_sale") or re.search(r"\b(?:iki|uc) (?:adet )?parsel\b|\b(?:[2-9]|\d{2,}) adet parsel\b|\d+\s*\+\s*\d+\s*m[²2]",normalized,re.I):return None,"multiple_parcels"
    normalized_title=_norm(row.get("title"))
    for match in re.finditer(r"\b(?:[2-9]|\d{2,})\s+parsel\b",normalized_title,re.I):
        if re.search(r"\b(?:ada|\d+)\s*$",normalized_title[:match.start()]):continue
        if re.match(r"\s+\d+\b",normalized_title[match.end():]):continue
        return None,"multiple_parcels"
    if "ilan alani tkgm parsel alaniyla uyusmadi" in _norm(row.get("location_note")):return None, "parcel_area_conflict"
    kind = _kind(row, text)
    if kind is None:return None, "unknown_kind"
    price, area = _positive(row.get("asking_price" if indexed else "price")), _positive(row.get("area"))
    if indexed:
        prices, areas = _header_values(text)
        if len(prices) > 1 or len(areas) > 1:return None, "conflicting_values"
        header_price = next(iter(prices)) if prices else None
        header_area = next(iter(areas)) if areas else None
        if price and header_price and not math.isclose(price, header_price, rel_tol=1e-6):return None, "conflicting_values"
        if area and header_area and not math.isclose(area, header_area, rel_tol=.002):return None, "conflicting_values"
        # Retain a parsed value only when the preserved own-listing header also
        # supports it. No values are borrowed from the query or other results.
        price, area = header_price, header_area
    if not price or not area or not _positive(price/area):return None, "missing_values"
    block, parcel = _block_parcel(row, text)
    if block and parcel and block == _integer(req.get("block")) and parcel == _integer(req.get("parcel")):return None, "subject_listing"
    record = {"title":str(row.get("title") or "İlan")[:240],"url":url,"source":str(row.get("source") or urlsplit(url).hostname),
              "area":area,"asking_price":price,"unit_price":price/area,"kind":kind,"address":address,"block":block,"parcel":parcel,
              "evidence":"search_index" if indexed else "detail_page",
              "evidence_label":"Arama dizinindeki ilan özeti; sayfa ve aktiflik doğrulanmadı" if indexed else "Bu sorguda okunmuş ilan detay sayfası",
              "checked_at":row.get("checked_at"),"listing_date":row.get("listing_date"),
              "source_urls":list(dict.fromkeys([url]+[u for value in row.get("source_urls",[]) if (u:=_url(value))])),
              "location_verified":False,"distance_scope":"regional","_quality":1 if indexed else 2}
    record["_keys"] = _keys(row,url,address,block,parcel)
    return record, None


def _quantile(values, fraction):
    values=sorted(values); index=(len(values)-1)*fraction; lower=int(index)
    return values[lower]+(values[min(lower+1,len(values)-1)]-values[lower])*(index-lower)


def build_regional_analysis(requestdict, subject, items, search_candidates):
    req = requestdict.model_dump() if hasattr(requestdict,"model_dump") else dict(requestdict or {})
    subject_area = _positive(subject.get("area")) if isinstance(subject,dict) and subject.get("source") and "tkgm" in _norm(subject.get("source")) else None
    observations=[]; excluded=[]; authoritative_keys=set()
    def reject(row, code):
        excluded.append({"title":str((row or {}).get("title", "İlan"))[:240],"url":_url((row or {}).get("url")),"reason_code":code,"reason":REASONS[code]})
    for indexed, rows in ((False,items or []),(True,search_candidates or [])):
        for row in rows:
            if not isinstance(row,dict):continue
            url=_url(row.get("url")); basic_keys=_keys(row,url) if url else set()
            if indexed and basic_keys & authoritative_keys:
                reject(row,"superseded_by_detail");continue
            record,error=_observation(row,req,indexed)
            if not indexed and row.get("live") and row.get("detail_verified") and not row.get("observed_on"):
                authoritative_keys.update(basic_keys)
                if record:authoritative_keys.update(record["_keys"])
            if error:reject(row,error)
            else:observations.append(record)
    # Union observations by all URL aliases and cadastral identity; a listing
    # with several aliases must not bridge into two counted properties.
    components=[]
    for observation in observations:
        matches=[group for group in components if group["keys"] & observation["_keys"]]
        if not matches:components.append({"keys":set(observation["_keys"]),"rows":[observation]});continue
        first=matches[0];first["keys"].update(observation["_keys"]);first["rows"].append(observation)
        for group in matches[1:]:first["keys"].update(group["keys"]);first["rows"].extend(group["rows"]);components.remove(group)
    selected=[]
    for group in components:
        quality=max(row["_quality"] for row in group["rows"])
        strongest=[row for row in group["rows"] if row["_quality"]==quality]
        chosen=strongest[0]
        if any(row["kind"]!=chosen["kind"] or not math.isclose(row["asking_price"],chosen["asking_price"],rel_tol=1e-6) or not math.isclose(row["area"],chosen["area"],rel_tol=.002) for row in strongest[1:]):
            for row in group["rows"]:reject(row,"conflicting_observations")
            continue
        for row in group["rows"]:
            if row is not chosen:reject(row,"duplicate" if row["_quality"]==quality else "superseded_by_detail")
        chosen=deepcopy(chosen)
        chosen["source_urls"]=list(dict.fromkeys(url for row in group["rows"] for url in row["source_urls"]))
        if subject_area and not .5*subject_area<=chosen["area"]<=2*subject_area:
            reject(chosen,"size_mismatch");continue
        selected.append({key:value for key,value in chosen.items() if not key.startswith("_")})
    groups=[]
    for kind,name in (("residential","Konut/villa imarlı arsa"),("field","Tarla / tarımsal arazi")):
        records=sorted((row for row in selected if row["kind"]==kind),key=lambda row:row["unit_price"])
        available=len(records)>=MIN_RECORDS
        units=[row["unit_price"] for row in records]
        group={"kind":kind,"name":name,"status":"available" if available else "insufficient","count":len(records),
               "detail_count":sum(row["evidence"]=="detail_page" for row in records),"index_count":sum(row["evidence"]=="search_index" for row in records),
               "unit_q25":None,"unit_median":None,"unit_q75":None,"unit_min":None,"unit_max":None,
               "total_low":None,"total_median":None,"total_high":None,"subject_area":subject_area,
               "conditional_zoning":req.get("zoning","unknown")=="unknown","records":records,"notes":[]}
        if available:
            for key,fraction in (("unit_q25",.25),("unit_median",.5),("unit_q75",.75)):group[key]=round(_quantile(units,fraction),2)
            group["unit_min"],group["unit_max"]=round(min(units),2),round(max(units),2)
            if subject_area and req.get("zoning","unknown") in {"unknown",kind}:
                totals=[group[key]*subject_area for key in ("unit_q25","unit_median","unit_q75")]
                if all(_positive(value) for value in totals):
                    for target,value in zip(("total_low","total_median","total_high"),totals):group[target]=round(value)
                    group["notes"].append(name+" niteliğinde olduğu koşuluyla, ilan talep fiyatlarından hesaplanan bölgesel toplam aralıktır.")
        else:group["notes"].append("Bu grupta fiyat bandı için en az üç tekil, kaynaklı ve uygun ilan gerekir.")
        if not subject_area:group["notes"].append("Hedef parsel alanı TKGM'den doğrulanamadı; toplam parsel değeri hesaplanmadı.")
        else:group["notes"].append(f"Boyut karşılaştırması {subject_area*.5:.2f}–{subject_area*2:.2f} m² aralığıyla sınırlandı.")
        group["notes"].append("Orta bant ilan birim fiyatlarının yüzde 25–75 aralığıdır; alt/üst uçlar yalnız gözlenen ilan fiyatlarıdır.")
        groups.append(group)
    return {"status":"available" if any(group["status"]=="available" for group in groups) else "insufficient" if selected else "unavailable",
            "scope":"regional_asking_prices","region":{key:str(req.get(key,"")) for key in ("province","district","place")},
            "subject_area":subject_area,"checked_at":datetime.now(timezone.utc).isoformat(),"groups":groups,
            "excluded":excluded,"excluded_counts":dict(Counter(row["reason_code"] for row in excluded)),
            "notes":["Mahalle/köy geneli; 1 km filtresi uygulanmadı.","Fiyatlar gerçekleşmiş satışlar değil ilan talep fiyatlarıdır.","Arama dizini kontrol zamanı ilanın aktif veya satılmamış olduğunu doğrulamaz."]}
