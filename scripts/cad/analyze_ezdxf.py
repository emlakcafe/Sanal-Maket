#!/usr/bin/env python3
import json
import math
import sys
from pathlib import Path

try:
    import ezdxf
except Exception as exc:
    print(json.dumps({"error":"EZDXF_NOT_INSTALLED","detail":str(exc)}, ensure_ascii=False))
    sys.exit(3)

RULES = [
    ("wall", ["DUVAR","WALL","A-WALL","MIM-DUVAR","MIM_DUVAR","MIMARI DUVAR"]),
    ("column", ["KOLON","COLUMN","COL","BETONARME KOLON"]),
    ("door", ["KAPI","DOOR","KAPI-PEN","KAPI_PEN"]),
    ("window", ["PENCERE","WINDOW","KA-PEN","KAPI-PEN","KAPI_PEN"]),
    ("stair", ["MERDIVEN","STAIR","STAIRS"]),
    ("axis", ["AKS","AXIS","GRID"]),
    ("dimension", ["OLCU","ÖLÇÜ","DIM","DIMENSION"]),
    ("text", ["YAZI","TEXT","TXT","ACIKLAMA","AÇIKLAMA","NOT"]),
    ("slab", ["DOSEME","DÖŞEME","SLAB","FLOOR"]),
    ("roof", ["CATI","ÇATI","ROOF"]),
    ("furniture", ["MOBILYA","MOBİLYA","FURN","FURNITURE","ESYA","EŞYA"]),
]

TR_MAP = str.maketrans({
    "İ":"I","Ş":"S","Ğ":"G","Ü":"U","Ö":"O","Ç":"C",
    "ı":"I","ş":"S","ğ":"G","ü":"U","ö":"O","ç":"C"
})

KINDS = ["wall","column","door","window","stair","axis","dimension","text","slab","roof","furniture","unknown"]

def norm(s):
    return str(s or "").translate(TR_MAP).upper()

def classify(layer):
    n = norm(layer)
    best = ("unknown", 0.0)
    for kind, tokens in RULES:
        for token in tokens:
            t = norm(token)
            if n == t:
                return kind, 1.0
            token_like = (
                n.startswith(t + "-") or n.startswith(t + "_") or
                n.endswith("-" + t) or n.endswith("_" + t) or
                ("-" + t + "-") in n or ("_" + t + "_") in n
            )
            if token_like:
                conf = min(0.94, 0.68 + len(t) / max(len(n), 1) * 0.25)
                if conf > best[1]:
                    best = (kind, conf)
    return best

def point_in_poly(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        ax, ay = poly[i]["x"], poly[i]["y"]
        bx, by = poly[j]["x"], poly[j]["y"]
        hit = ((ay > y) != (by > y)) and (x < (bx-ax)*(y-ay)/((by-ay) or 1e-12)+ax)
        if hit:
            inside = not inside
        j = i
    return inside

def inside_region(points, region):
    if not region:
        return True
    b = region["bounds"]
    poly = region["polygon"]
    for p in points:
        x, y = p[0], p[1]
        if b["minX"] <= x <= b["maxX"] and b["minY"] <= y <= b["maxY"] and point_in_poly(x, y, poly):
            return True
    return False

def v3(v):
    return {"x": float(v.x), "y": float(v.y), "z": float(getattr(v, "z", 0.0) or 0.0)}

def entity_points(entity):
    t = entity.dxftype()
    if t == "LINE":
        return [entity.dxf.start, entity.dxf.end]
    if t == "LWPOLYLINE":
        return [type("P", (), {"x":p[0],"y":p[1],"z":0.0})() for p in entity.get_points("xy")]
    if t == "POLYLINE":
        return [v.dxf.location for v in entity.vertices]
    if t in ("CIRCLE","ARC"):
        return [entity.dxf.center]
    if t in ("TEXT","MTEXT"):
        ins = entity.dxf.insert if hasattr(entity.dxf, "insert") else None
        return [ins] if ins is not None else []
    if t == "POINT":
        return [entity.dxf.location]
    if t == "ELLIPSE":
        return [entity.dxf.center]
    return []

def text_value(entity):
    t = entity.dxftype()
    try:
        if t == "TEXT":
            return entity.dxf.text or ""
        if t == "MTEXT":
            return entity.plain_text() or ""
        if t == "ATTRIB":
            return entity.dxf.text or ""
        if t == "DIMENSION":
            return entity.dxf.text or ""
    except Exception:
        return ""
    return ""

def iter_virtual(entity, depth=0):
    if depth > 16:
        return
    if entity.dxftype() == "INSERT":
        try:
            for child in entity.virtual_entities():
                yield from iter_virtual(child, depth+1)
        except Exception:
            return
    else:
        yield entity

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error":"ARGS","detail":"usage: analyze_ezdxf.py file.dxf selection.json"}, ensure_ascii=False))
        return 2

    dxf_path = Path(sys.argv[1])
    selection_path = Path(sys.argv[2])
    region = json.loads(selection_path.read_text(encoding="utf-8"))

    try:
        doc = ezdxf.readfile(str(dxf_path))
    except Exception as exc:
        print(json.dumps({"error":"DXF_READ_FAILED","detail":str(exc)}, ensure_ascii=False))
        return 4

    msp = doc.modelspace()
    entities = []
    texts = []
    layer_counts = {}
    counts = {k:0 for k in KINDS}
    minx = miny = float("inf")
    maxx = maxy = float("-inf")

    def add_bound(pt):
        nonlocal minx, miny, maxx, maxy
        x, y = float(pt[0]), float(pt[1])
        minx = min(minx, x); maxx = max(maxx, x)
        miny = min(miny, y); maxy = max(maxy, y)

    for source in msp:
        for e in iter_virtual(source):
            layer = str(getattr(e.dxf, "layer", "0") or "0")
            layer_counts[layer] = layer_counts.get(layer, 0) + 1
            kind, _ = classify(layer)
            t = e.dxftype()
            if t in ("TEXT","MTEXT","ATTRIB") and kind == "unknown":
                kind = "text"
            if t == "DIMENSION" and kind == "unknown":
                kind = "dimension"

            pts = entity_points(e)
            if not pts:
                continue
            tuples = [(float(p.x), float(p.y), float(getattr(p, "z", 0.0) or 0.0)) for p in pts]
            if not inside_region(tuples, region):
                continue

            item = {"type":t, "layer":layer, "kind":kind}

            if t in ("LINE","LWPOLYLINE","POLYLINE"):
                item["vertices"] = [{"x":p[0],"y":p[1],"z":p[2]} for p in tuples]
            elif t in ("CIRCLE","ARC","ELLIPSE"):
                c = e.dxf.center
                item["center"] = v3(c)
                if t in ("CIRCLE","ARC"):
                    item["radius"] = float(e.dxf.radius)
            elif t in ("TEXT","MTEXT","ATTRIB","POINT"):
                p = pts[0]
                item["center"] = v3(p)

            txt = text_value(e).strip()
            if txt:
                item["text"] = txt
                texts.append({"layer":layer,"text":txt})

            counts[kind] += 1
            entities.append(item)
            for p in tuples:
                add_bound(p)

    layers = []
    for name, entity_count in layer_counts.items():
        kind, confidence = classify(name)
        layers.append({
            "name":name,
            "kind":kind,
            "confidence":confidence,
            "entityCount":entity_count
        })
    layers.sort(key=lambda x:(-x["confidence"],-x["entityCount"]))

    warnings = []
    if not entities:
        warnings.append("Seçilen alanda modellenebilir CAD geometrisi bulunamadı.")
    if counts["wall"] == 0:
        warnings.append("Seçilen planda DUVAR geometrisi bulunamadı veya farklı katmandadır.")
    if counts["column"] == 0:
        warnings.append("Seçilen planda KOLON geometrisi bulunamadı veya farklı katmandadır.")
    if counts["door"] == 0:
        warnings.append("Seçilen planda KAPI geometrisi bulunamadı veya farklı katmandadır.")
    if counts["window"] == 0:
        warnings.append("Seçilen planda PENCERE geometrisi bulunamadı veya farklı katmandadır.")

    bounds = None
    if math.isfinite(minx):
        bounds = {"minX":minx,"minY":miny,"maxX":maxx,"maxY":maxy}

    result = {
        "engine":"ezdxf",
        "dxfVersion":doc.dxfversion,
        "layers":layers,
        "entities":entities,
        "counts":counts,
        "texts":texts[:5000],
        "bounds":bounds,
        "warnings":warnings
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
