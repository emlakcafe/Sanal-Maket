"""Public listing readers, separated by the actual source page format.

No network access is performed here. JSON-LD belongs to a listing only when its
URL matches the requested detail URL; visible, labelled fields provide the DOM
fallback. Advertised map pins are never accepted as verified parcel centres.
"""
from __future__ import annotations

import json
import math
import re
import unicodedata
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup


BASES = {"RE/MAX": "https://remax.com.tr", "Emlakjet": "https://www.emlakjet.com"}


def norm(value):
    value = str(value or "").replace("ı", "i").replace("İ", "I")
    value = "".join(c for c in unicodedata.normalize("NFKD", value) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def slug(value):
    return norm(value).replace(" ", "-")


def _get(req, name, default=""):
    return req.get(name, default) if isinstance(req, dict) else getattr(req, name, default)


def _text(node):
    return node.get_text(" ", strip=True) if node is not None else ""


def _place(value):
    # RE/MAX appends the village's internal neighbourhood in parentheses.
    # The cadastral locality is the village itself, not "Hacımehmet Merkez".
    return re.sub(r"\s*\([^)]*\)\s*", " ", str(value or "")).strip()


def _number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    text = str(value or "").replace("\u00a0", " ").strip()
    match = re.fullmatch(r"([\d.,]+)\s*(?:m[²2]|metrekare)?", text, re.I)
    if not match:
        return None
    text = match.group(1)
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(?:\.\d{3})+", text):
        text = text.replace(".", "")
    try:
        value = float(text)
        return value if math.isfinite(value) else None
    except ValueError:
        return None


def _integer(value):
    text = str(value or "").strip()
    # RE/MAX formats cadastral numbers with Turkish thousands grouping too:
    # e.g. Ada "1.337" is block 1337, not a decimal number or a missing field.
    if re.fullmatch(r"\d{1,3}(?:\.\d{3})+", text):
        text = text.replace(".", "")
    return str(int(text)) if re.fullmatch(r"\d{1,9}", text) else None


def _money(text):
    """An isolated total-price field, never a unit-price or mixed label."""
    text = str(text or "").replace("\u00a0", " ").strip()
    match = re.fullmatch(r"(?:([\d.,]+)\s*(?:₺|TL|TRY)|(?:₺|TL|TRY)\s*([\d.,]+))", text, re.I)
    return _number(match.group(1) or match.group(2)) if match else None


def _money_in_card(text):
    # Listing cards concatenate total price and price/m². Exclude the latter.
    for match in re.finditer(r"(?<![\d.,])([\d.,]+)\s*(?:₺|TL|TRY)(?!\s*/)", text, re.I):
        prefix = norm(text[max(0, match.start() - 18):match.start()])
        if prefix.endswith(("m2 fiyati", "metrekare fiyati")):
            continue
        price = _number(match.group(1))
        if price and price > 0:
            return price
    return None


def _kind(zoning, category):
    # A later explicit zoning field is stronger than a generic "Satılık Arsa".
    for value in (zoning, category):
        value = norm(value)
        if any(word in value for word in ("tarla", "tarim arazisi", "bag bahce", "bag ve bahce")):
            return "field"
        if value == "konut" or any(word in value for word in ("konut imarli", "villa imarli", "imarli konut", "residential zoned")):
            return "residential"
        if value in {"villa", "villa satilik", "satilik villa"}:
            return "residential"
        if value and value not in {"arsa", "satilik arsa", "bilinmiyor", "belirtilmemis", "unknown"}:
            # Explicit industrial/commercial zoning must not be relabelled as
            # residential because another field or marketing title says villa.
            if any(word in value for word in ("sanayi", "ticari", "turizm", "ozel kullanim")):
                return "unknown"
    return "unknown"


def _clean_url(value, base=""):
    if not isinstance(value, str) or not value.strip():
        return None
    parsed = urlsplit(urljoin(base, str(value or "")))
    if parsed.scheme != "https" or parsed.username or parsed.password:
        return None
    return "https://" + (parsed.hostname or "").lower() + parsed.path.rstrip("/")


def _listing_url(value, source, base=""):
    cleaned = _clean_url(value, base or BASES.get(source, ""))
    if not cleaned or source not in BASES:
        return None
    parsed = urlsplit(cleaned)
    if parsed.hostname != urlsplit(BASES[source]).hostname:
        return None
    pattern = r"/(?:tr/portfoy|en/property)/P\d+" if source == "RE/MAX" else r"/ilan/[^/]+-\d+"
    return cleaned if re.fullmatch(pattern, parsed.path, re.I) else None


def _json_nodes(soup):
    def unpack(value):
        if isinstance(value, list):
            for item in value:
                yield from unpack(item)
        elif isinstance(value, dict):
            if isinstance(value.get("@graph"), list):
                yield from unpack(value["@graph"])
            else:
                yield value
    result = []
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            result.extend(unpack(json.loads(script.string or script.get_text())))
        except (ValueError, TypeError):
            continue
    return result


def _has_type(node, kind):
    types = node.get("@type", [])
    return kind in (types if isinstance(types, list) else [types])


def _properties(node):
    result = {}
    for prop in node.get("additionalProperty", []) if isinstance(node, dict) else []:
        if isinstance(prop, dict) and prop.get("name") and prop.get("value") is not None:
            result[norm(prop["name"])] = str(prop["value"])
    return result


def _field(fields, *names):
    return next((fields[norm(name)] for name in names if fields.get(norm(name))), "")


def _dom_fields(soup, source):
    fields = {}
    if source == "RE/MAX":
        for row in soup.select(".property-detail-section .property-detail-row"):
            label, value = row.select_one(".property-detail-label"), row.select_one(".property-detail-value")
            if label and value:
                fields.setdefault(norm(_text(label)), _text(value))
    else:
        h1 = soup.find("h1")
        article = h1.find_parent("article") if h1 else None
        for label in (article.select("dt") if article else []):
            value = label.find_next_sibling("dd")
            if value:
                fields.setdefault(norm(_text(label)), _text(value))
    return fields


def _remax_address(soup, nodes):
    result = {"province": "", "district": "", "place": ""}
    # Explicit category breadcrumb links encode hierarchy. Do not parse titles.
    entries = []
    for node in nodes:
        if _has_type(node, "BreadcrumbList"):
            for entry in node.get("itemListElement", []):
                if isinstance(entry, dict):
                    item = entry.get("item", "")
                    if isinstance(item, dict):
                        item = item.get("@id") or item.get("url") or ""
                    entries.append((item, entry.get("name", "")))
    entries.extend((a.get("href", ""), _text(a)) for a in soup.select('a[href*="/arsa-arazi/satilik/"]'))
    for url, text in entries:
        path = urlsplit(url).path.rstrip("/")
        match = re.fullmatch(r"/tr/arsa-arazi/satilik/([^/]+)(?:/([^/]+))?(?:/([^/]+))?", path)
        if not match or not text or len(text) > 120:
            continue
        key = "place" if match.group(3) else "district" if match.group(2) else "province"
        result.setdefault(key, "")
        if not result[key]:
            result[key] = _place(text) if key == "place" else text
    return result


def _emlakjet_dom_address(soup):
    h1 = soup.find("h1")
    article = h1.find_parent("article") if h1 else None
    button = article.select_one('[data-widget-click="genel-bakis||haritada-gor"]') if article else None
    text = _text(button)
    text = re.sub(r"\s*Haritada Gör\s*$", "", text, flags=re.I)
    parts = [part.strip() for part in text.split(",")]
    if len(parts) == 3 and all(parts):
        return {"place": _place(parts[0]), "district": parts[1], "province": parts[2]}
    return {"province": "", "district": "", "place": ""}


def _dom_price(soup, source):
    h1 = soup.find("h1")
    if not h1:
        return None
    if source == "Emlakjet":
        article = h1.find_parent("article")
        if not article:
            return None
        # Current Emlakjet overview has isolated total and unit-price spans.
        # dt/dd properties and the description/recommendations are excluded.
        for element in article.find_all(["span", "h2", "p"]):
            if element.find_parent(["dd", "dt", "del", "s"]) or element.find_parent(id="features"):
                continue
            price = _money(_text(element))
            if price:
                return price
    else:
        scope = h1.find_parent("main") or soup
        # RE/MAX's mobile and desktop price headers share this exact observed
        # container structure. An arbitrary later h2/h3 is not a price field.
        for element in scope.select(".flex.flex-wrap.items-center.gap-2 > .flex.items-end.gap-2 > h2"):
            if element.find_parent(["aside", "footer", "nav"]):
                continue
            if element.find_parent(class_=re.compile("similar-properties")):
                continue
            price = _money(_text(element))
            if price:
                return price
    return None


def _valid_address(address, req):
    return bool(address.get("place") and norm(address.get("province")) == norm(_get(req, "province"))
                and norm(address.get("district")) == norm(_get(req, "district")))


def _record(title, url, area, price, category, zoning, address, source, *, fields=None, detail=False, reader="", listing_date=None):
    if not title or not area or not price or area <= 0 or price <= 0:
        return None
    fields = fields or {}
    kind = _kind(zoning, category)
    ownership = _field(fields, "Tapu Durumu")
    share_evidence = []
    if re.search(r"\b(?:hisseli|hisse|musterek|payli|istirak)\b", norm(ownership)):
        share_evidence.append("Tapu Durumu: " + ownership)
    title_norm = norm(title)
    if (re.search(r"\b(?:hisse|hissesi|hisseleri|hisseli)\b", title_norm)
            and not re.search(r"\b(?:hisseli degil|hisse yok|hissesi yok)\b", title_norm)):
        share_evidence.append("Başlıkta hisse satışı belirtiliyor")
    return {"title": str(title)[:220], "url": url, "area": area, "price": price,
            "unit": price / area, "kind": kind, "type": kind,
            "block": _integer(_field(fields, "Ada", "Ada No", "Ada Numarası")),
            "parcel": _integer(_field(fields, "Parsel", "Parsel No", "Parsel Numarası")),
            "center": None, "distance": None, "source": source,
            "live": bool(detail), "detail_verified": bool(detail),
            "detail_status": "read" if detail else "not_checked",
            "address": address, "reader": reader, "listing_date": listing_date,
            "share_sale": bool(share_evidence), "share_evidence": share_evidence,
            "field_evidence": {"category": category, "zoning": zoning, "ownership": ownership}}


def parse_detail(html, url, req, source):
    target = _listing_url(url, source)
    if not target:
        return None
    soup = BeautifulSoup(html, "html.parser")
    canonical = soup.select_one('link[rel="canonical"][href]')
    if canonical and _clean_url(canonical["href"], target) != target:
        return None
    h1 = soup.find("h1")
    if not h1:
        return None
    title = _text(h1)
    notices = " ".join(_text(el) for el in soup.select('h1, [role="alert"]'))
    if any(word in norm(notices) for word in ("ilan yayindan kaldir", "ilan bulunamadi", "ilan artik aktif degil", "ilan pasif", "ilan satildi")):
        return None
    nodes = _json_nodes(soup)
    relevant = [n for n in nodes if _has_type(n, "RealEstateListing") or _has_type(n, "Product")]
    matched = [n for n in relevant if _clean_url(n.get("url") or n.get("@id"), target) == target]
    if relevant and not matched:
        return None
    dom = _dom_fields(soup, source)
    fields = dict(dom)
    listing = next((n for n in matched if _has_type(n, "RealEstateListing")), {})
    product = next((n for n in matched if _has_type(n, "Product")), {})
    offered = listing.get("itemOffered") or {}
    if not isinstance(offered, dict):
        offered = {}
    structured_fields = _properties(offered)
    structured_fields.update(_properties(listing))
    fields.update(structured_fields)

    expected_id = target.rsplit("/", 1)[-1] if source == "RE/MAX" else target.rsplit("-", 1)[-1]
    observed_id = _field(dom, "Portföy No", "İlan Numarası")
    identifier = listing.get("identifier")
    if isinstance(identifier, dict):
        identifier = identifier.get("value")
    if observed_id and observed_id != expected_id:
        return None
    if identifier and str(identifier) != expected_id:
        return None

    offer = product.get("offers") or listing.get("offers") or {}
    if isinstance(offer, list):
        offer = next((x for x in offer if isinstance(x, dict) and _clean_url(x.get("url"), target) == target), {})
    if not isinstance(offer, dict):
        offer = {}
    if offer.get("url") and _clean_url(offer["url"], target) != target:
        return None
    availability = str(offer.get("availability", "")).rsplit("/", 1)[-1].lower()
    if availability in {"outofstock", "soldout", "discontinued", "instoreonly"}:
        return None
    if offer.get("priceCurrency") and str(offer["priceCurrency"]).upper() not in {"TRY", "TL"}:
        return None
    price = _number(offer.get("price")) or _dom_price(soup, source)
    size = offered.get("floorSize") or {}
    area = _number(size.get("value")) if isinstance(size, dict) and size.get("unitCode", "MTK") in {"MTK", "m2", "m²"} else None
    area = area or _number(_field(fields, "Metrekare", "m²", "Alan", "Metrekare (m²)"))
    category = _field(fields, "Kategori", "Emlak Tipi", "İlan Tipi")
    zoning = _field(fields, "İmar Durumu", "Arsa Tipi")
    if "satilik" not in norm(category):
        return None

    address = _remax_address(soup, nodes) if source == "RE/MAX" else _emlakjet_dom_address(soup)
    structured_address = listing.get("address") or offered.get("address") or {}
    if isinstance(structured_address, dict):
        if structured_address.get("addressRegion"):
            address["province"] = structured_address["addressRegion"]
        if source == "RE/MAX":
            if structured_address.get("addressLocality"):
                address["place"] = _place(structured_address["addressLocality"])
        else:
            if structured_address.get("addressLocality"):
                address["district"] = structured_address["addressLocality"]
            if structured_address.get("streetAddress"):
                address["place"] = _place(structured_address["streetAddress"])
    if not _valid_address(address, req):
        return None
    date = listing.get("dateModified") or listing.get("datePosted") or _field(fields, "İlan Güncelleme Tarihi", "Yayınlanma Tarihi") or None
    row = _record(title, target, area, price, category, zoning, address, source, fields=fields, detail=True,
                  reader=("remax" if source == "RE/MAX" else "emlakjet") + ("-jsonld-dom" if matched else "-labelled-dom"), listing_date=date)
    geo = listing.get("geo") or offered.get("geo") or {}
    if row and isinstance(geo, dict):
        lat, lon = _number(geo.get("latitude")), _number(geo.get("longitude"))
        if lat is not None and lon is not None and 35 <= lat <= 43 and 25 <= lon <= 46:
            row["advertised_center"] = [lat, lon]
    return row


def detail_problem(html, url, source):
    """Explain a rejected detail without presenting its fields as verified."""
    generic = "Zorunlu fiyat/alan/adres alanları doğrulanamadı"
    target = _listing_url(url, source)
    if not target:
        return generic
    soup = BeautifulSoup(html, "html.parser")
    canonical = soup.select_one('link[rel="canonical"][href]')
    if canonical and _clean_url(canonical["href"], target) != target:
        return "Kaynak sayfadaki ilan kimlikleri çelişiyor"
    notices = " ".join(_text(el) for el in soup.select('h1, [role="alert"]'))
    if any(word in norm(notices) for word in ("ilan yayindan kaldir", "ilan bulunamadi", "ilan artik aktif degil", "ilan pasif", "ilan satildi")):
        return "Kaynak ilanı yayından kaldırılmış veya satılmış olarak işaretliyor"
    relevant = [n for n in _json_nodes(soup) if _has_type(n, "RealEstateListing") or _has_type(n, "Product")]
    matched = [n for n in relevant if _clean_url(n.get("url") or n.get("@id"), target) == target]
    if relevant and not matched:
        return "Kaynak sayfadaki ilan kimlikleri çelişiyor"
    for node in matched:
        offers = node.get("offers", [])
        for offer in offers if isinstance(offers, list) else [offers]:
            if isinstance(offer, dict) and str(offer.get("availability", "")).rsplit("/", 1)[-1].lower() in {"outofstock", "soldout", "discontinued"}:
                return "Kaynak ilanı yayından kaldırılmış veya satılmış olarak işaretliyor"
    return generic


def _category_address(url, req, source, soup, nodes):
    if source == "RE/MAX":
        address = _remax_address(soup, nodes)
        expected = "/tr/arsa-arazi/satilik/" + slug(_get(req, "province")) + "/" + slug(_get(req, "district"))
    else:
        address = {"province": "", "district": "", "place": ""}
        expected = "/satilik-arsa/" + slug(_get(req, "province")) + "-" + slug(_get(req, "district"))
    path = urlsplit(url).path.rstrip("/")
    # Category route supplies its explicitly selected province/district only.
    # It never supplies the requested place to a listing with a missing address.
    if path == expected or path.startswith(expected + ("/" if source == "RE/MAX" else "-")):
        address["province"] = address.get("province") or _get(req, "province")
        address["district"] = address.get("district") or _get(req, "district")
    if norm(address["province"]) != norm(_get(req, "province")) or norm(address["district"]) != norm(_get(req, "district")):
        return None
    return address


def _card(a, url, req, source, category_address, title_hint=""):
    container = a.find_parent(id=re.compile(r"^property-card-")) if source == "RE/MAX" else a.find_parent("article")
    container = container or a
    text = container.get_text("\n", strip=True)
    if len(text) > 2200:
        return None
    address = dict(category_address)
    category = ""
    for line in text.splitlines():
        if re.fullmatch(r"Satılık\s*[·/]\s*[^\n]{1,80}", line, re.I):
            category = line
        if source == "RE/MAX":
            parts = [x.strip() for x in line.split("/")]
            if len(parts) == 2 and norm(parts[0]) == norm(_get(req, "district")):
                address.update(district=parts[0], place=_place(parts[1]))
        elif "," in line:
            parts = [x.strip() for x in line.split(",")]
            if len(parts) == 2 and norm(parts[0]) == norm(_get(req, "district")):
                address.update(district=parts[0], place=_place(parts[1]))
    if not _valid_address(address, req):
        return None
    area_match = re.search(r"(?<![\d.,/])([\d.,]+)\s*m[²2](?!\w)", text, re.I)
    area = _number(area_match.group(1)) if area_match else None
    price = _money_in_card(text)
    heading = container.find(["h2", "h3", "h4"])
    title = title_hint or _text(heading)
    if not title:
        image = container.find("img", alt=True)
        title = image.get("alt", "") if image else ""
    return _record(title, url, area, price, category, "", address, source,
                   reader=("remax" if source == "RE/MAX" else "emlakjet") + "-card")


def candidates(html, url, req, source):
    if source not in BASES or urlsplit(url).hostname != urlsplit(BASES[source]).hostname:
        return {}
    soup = BeautifulSoup(html, "html.parser")
    nodes = _json_nodes(soup)
    address = _category_address(url, req, source, soup, nodes)
    if not address:
        return {}
    result = {}
    if source == "Emlakjet":
        listings = [n for n in nodes if _has_type(n, "RealEstateListing") and _listing_url(n.get("url"), source)]
        if listings:
            for node in listings:
                target = _listing_url(node["url"], source)
                fields = _properties(node)
                location = _field(fields, "Konum")
                parts = [x.strip() for x in location.split(",")]
                own_address = dict(address)
                if len(parts) == 2:
                    own_address.update(place=_place(parts[0]), district=parts[1])
                offer = node.get("offers") or {}
                row = None
                if _valid_address(own_address, req) and isinstance(offer, dict) and offer.get("priceCurrency", "TRY") in {"TRY", "TL"}:
                    row = _record(node.get("name"), target, _number(_field(fields, "Metrekare")), _number(offer.get("price")),
                                  _field(fields, "İlan Tipi", "Kategori"), "", own_address, source,
                                  reader="emlakjet-card-jsonld", listing_date=node.get("datePosted"))
                result[target] = row
            return result
    title_hints = {}
    allowed = set()
    for node in nodes:
        if _has_type(node, "ItemList"):
            for entry in node.get("itemListElement", []):
                if not isinstance(entry, dict):
                    continue
                target = _listing_url(entry.get("url"), source)
                if target:
                    allowed.add(target)
                    title_hints[target] = entry.get("name", "")
    # Without JSON-LD, use main search links up to the recommendation heading.
    scope = soup.select_one("#search-results") or soup.find("main") or soup
    for element in scope.find_all(["a", "h2", "h3"]):
        if element.name != "a":
            if norm(_text(element)) in {"benzer ilanlar", "bu ilana bakanlar bunlara da bakti"}:
                break
            continue
        target = _listing_url(element.get("href"), source, url)
        if not target or (allowed and target not in allowed):
            continue
        card = _card(element, target, req, source, address, title_hints.get(target, ""))
        if target not in result or card:
            result[target] = card
    for target in allowed:
        result.setdefault(target, None)
    return result


def search_urls(req, source):
    province, district = slug(_get(req, "province")), slug(_get(req, "district"))
    if source == "RE/MAX":
        return [BASES[source] + "/tr/arsa-arazi/satilik/" + province + "/" + district]
    if source != "Emlakjet":
        return []
    base = BASES[source] + "/satilik-arsa/" + province + "-" + district
    place = slug(_place(_get(req, "place")))
    kind = norm(_get(req, "place_kind"))
    variants = []
    if place:
        if place.endswith(("-koyu", "-mahallesi")):
            variants.append(place)
        elif kind in {"koy", "village"}:
            variants.extend([place + "-koyu", place])
        elif kind in {"mahalle", "neighborhood"}:
            variants.extend([place + "-mahallesi", place])
        else:
            variants.extend([place + "-koyu", place + "-mahallesi", place])
    return list(dict.fromkeys([base + "-" + value for value in variants] + [base]))
