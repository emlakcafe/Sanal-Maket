"""Qualified parcel matching when postal and cadastral locality names differ.

No place-name aliases are installed. The alternative locality must occur in the
listing's own heading, and the official parcel must independently agree with its
identifiers, area and advertised map pin. The original address stays intact.
"""
import math
import re
import unicodedata


def norm(value):
    value = str(value or "").replace("ı", "i").replace("İ", "I")
    value = "".join(c for c in unicodedata.normalize("NFKD", value) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def place(value):
    return " ".join(w for w in norm(value).split() if w not in {"mah", "mahallesi", "mahalle", "koy", "koyu"})


def field(request, key):
    return request.get(key) if isinstance(request, dict) else getattr(request, key, None)


def valid_point(point):
    return (isinstance(point, (list, tuple)) and len(point) == 2
            and all(isinstance(v, (float, int)) and not isinstance(v, bool) and math.isfinite(v) for v in point)
            and 35 <= point[0] <= 43 and 25 <= point[1] <= 46)


def distance(a, b):
    la, lb = math.radians(a[0]), math.radians(b[0])
    h = math.sin((lb - la) / 2) ** 2 + math.cos(la) * math.cos(lb) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 12742000 * math.asin(min(1, math.sqrt(h)))


def may_resolve(item, request, subject):
    if not item.get("live") or not item.get("detail_verified") or item.get("share_sale") or item.get("multi_parcel_sale"):
        return False
    if not item.get("block") or not item.get("parcel"):
        return False
    address = item.get("address") or {}
    if any(norm(address.get(k)) != norm(field(request, k)) for k in ("province", "district")):
        return False
    name, heading = place(field(request, "place")), norm(item.get("title"))
    if len(name) < 3 or not re.search(r"\b" + re.escape(name) + r"\b", heading):
        return False
    if re.search(r"\b" + re.escape(name) + r"\b.{0,22}\b(?:yakin|yakininda|civari|civarinda)\b", heading):
        return False
    if re.search(r"\b(?:iki|2|uc|3)\s+parsel\b", heading) or "+" in str(item.get("title", "")):
        return False
    pin, center = item.get("advertised_center"), (subject or {}).get("center")
    return bool(valid_point(pin) and valid_point(center) and distance(pin, center) <= 1500)


def agreement(item, parcel, locality_id):
    """Return evidence only for a narrow, independently agreeing match."""
    if str(item.get("block")) != str(parcel.get("block")) or str(item.get("parcel")) != str(parcel.get("parcel")):
        return None
    advertised_area, actual_area = item.get("area"), parcel.get("area")
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v > 0 for v in (advertised_area, actual_area)):
        return None
    delta = abs(advertised_area - actual_area) / actual_area
    if delta > .02 or not valid_point(item.get("advertised_center")) or not valid_point(parcel.get("center")):
        return None
    pin_delta = distance(item["advertised_center"], parcel["center"])
    if pin_delta > 150:
        return None
    return {"resolution_method": "title_parcel_pin_agreement", "resolved_cadastral_locality_id": str(locality_id),
            "pin_delta_m": round(pin_delta, 1), "area_delta_pct": round(delta * 100, 3),
            "location_note": "İlan başlığı, ada/parsel, alan ve harita piniyle eşleşen TKGM parseli. "
                             f"İlan pini ile parsel merkezi arasındaki fark: {pin_delta:.0f} m."}
