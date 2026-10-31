#!/usr/bin/env python3
import json
import math
import sys
from pathlib import Path

from shapely.geometry import LineString

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


def segments_from_entity(item):
    verts = item.get("vertices") or []
    out = []
    for i in range(len(verts)-1):
        a = verts[i]; b = verts[i+1]
        dx = b["x"]-a["x"]; dy = b["y"]-a["y"]
        length = math.hypot(dx,dy)
        if length > 1e-9:
            out.append((a,b,length))
    return out

def normalize_angle(a):
    while a < 0:
        a += math.pi
    while a >= math.pi:
        a -= math.pi
    return a

def angle_diff(a,b):
    d = abs(normalize_angle(a)-normalize_angle(b))
    return min(d, math.pi-d)

def segment_projection_overlap(a1,a2,b1,b2):
    ux=a2["x"]-a1["x"]; uy=a2["y"]-a1["y"]
    length=math.hypot(ux,uy)
    if length <= 1e-9:
        return 0.0
    ux/=length; uy/=length
    def proj(p):
        return (p["x"]-a1["x"])*ux+(p["y"]-a1["y"])*uy
    b0,b1p=sorted([proj(b1),proj(b2)])
    left=max(0.0,b0); right=min(length,b1p)
    return max(0.0,right-left)

def avg_point(a,b):
    return {"x":(a["x"]+b["x"])/2.0,"y":(a["y"]+b["y"])/2.0,"z":0.0}

def orient_like(a1,a2,b1,b2):
    same=math.hypot(a1["x"]-b1["x"],a1["y"]-b1["y"])+math.hypot(a2["x"]-b2["x"],a2["y"]-b2["y"])
    flip=math.hypot(a1["x"]-b2["x"],a1["y"]-b2["y"])+math.hypot(a2["x"]-b1["x"],a2["y"]-b1["y"])
    return (b1,b2) if same <= flip else (b2,b1)

def reconstruct_walls(entities, unit_scale):
    raw=[]
    for item in entities:
        if item.get("kind")!="wall":
            continue
        for a,b,length in segments_from_entity(item):
            if length*unit_scale < 0.35:
                continue
            angle=math.atan2(b["y"]-a["y"],b["x"]-a["x"])
            raw.append({"a":a,"b":b,"length":length,"angle":angle,"layer":item.get("layer","")})

    min_thick=max(0.08/unit_scale,1e-6)
    max_thick=max(0.40/unit_scale,min_thick*1.1)
    max_angle=math.radians(4.0)

    candidates=[]
    for i in range(len(raw)):
        s1=raw[i]
        line1=LineString([(s1["a"]["x"],s1["a"]["y"]),(s1["b"]["x"],s1["b"]["y"])])
        for j in range(i+1,len(raw)):
            s2=raw[j]
            if angle_diff(s1["angle"],s2["angle"])>max_angle:
                continue
            overlap=segment_projection_overlap(s1["a"],s1["b"],s2["a"],s2["b"])
            if overlap*unit_scale < 0.45:
                continue
            if overlap / max(1e-9,min(s1["length"],s2["length"])) < 0.35:
                continue
            line2=LineString([(s2["a"]["x"],s2["a"]["y"]),(s2["b"]["x"],s2["b"]["y"])])
            dist=line1.distance(line2)
            if dist < min_thick or dist > max_thick:
                continue
            score=dist + abs(s1["length"]-s2["length"])*0.02
            candidates.append((score,i,j,dist))

    candidates.sort(key=lambda x:x[0])
    used=set()
    walls=[]
    for _,i,j,dist in candidates:
        if i in used or j in used:
            continue
        s1,s2=raw[i],raw[j]
        b1,b2=orient_like(s1["a"],s1["b"],s2["a"],s2["b"])
        start=avg_point(s1["a"],b1)
        end=avg_point(s1["b"],b2)
        length=math.hypot(end["x"]-start["x"],end["y"]-start["y"])
        if length*unit_scale < 0.45:
            continue
        walls.append({
            "start":start,
            "end":end,
            "thickness":dist,
            "length":length,
            "sourceLayers":[s1["layer"],s2["layer"]]
        })
        used.add(i); used.add(j)

    dedup=[]
    seen=set()
    for w in walls:
        sx,sy=w["start"]["x"],w["start"]["y"]
        ex,ey=w["end"]["x"],w["end"]["y"]
        mx=(sx+ex)/2.0; my=(sy+ey)/2.0
        ang=normalize_angle(math.atan2(ey-sy,ex-sx))
        key=(
            round(mx*unit_scale,2),
            round(my*unit_scale,2),
            round(ang,2),
            round(w["thickness"]*unit_scale,2),
            round(w["length"]*unit_scale,2)
        )
        if key in seen:
            continue
        seen.add(key)
        if w["length"]*unit_scale > 25.0:
            continue
        dedup.append(w)

    return dedup


def point_seg_distance(px,py,ax,ay,bx,by):
    vx=bx-ax; vy=by-ay
    d=vx*vx+vy*vy
    if d<=1e-12:
        return math.hypot(px-ax,py-ay),0.0
    t=((px-ax)*vx+(py-ay)*vy)/d
    t=max(0.0,min(1.0,t))
    qx=ax+t*vx; qy=ay+t*vy
    return math.hypot(px-qx,py-qy),t

def entity_sample_points(item):
    pts=[]
    for v in item.get("vertices") or []:
        pts.append((float(v.get("x",0)),float(v.get("y",0))))
    c=item.get("center")
    if c:
        pts.append((float(c.get("x",0)),float(c.get("y",0))))
    return pts

def cluster_points(points, threshold):
    n=len(points)
    parent=list(range(n))
    def find(x):
        while parent[x]!=x:
            parent[x]=parent[parent[x]]
            x=parent[x]
        return x
    def union(a,b):
        ra,rb=find(a),find(b)
        if ra!=rb:
            parent[rb]=ra
    for i in range(n):
        xi,yi=points[i]
        for j in range(i+1,n):
            xj,yj=points[j]
            if math.hypot(xj-xi,yj-yi)<=threshold:
                union(i,j)
    groups={}
    for i in range(n):
        groups.setdefault(find(i),[]).append(i)
    return list(groups.values())

def reconstruct_openings(entities, walls, unit_scale):
    candidates=[]

    # Strong door signal: swing arcs with residential-scale radius.
    for idx,e in enumerate(entities):
        t=e.get("type")
        layer=norm(e.get("layer",""))
        radius=float(e.get("radius") or 0.0)
        center=e.get("center")
        if t=="ARC" and center and 0.45 <= radius*unit_scale <= 1.60:
            kind="door" if ("KAPI" in layer or "DOOR" in layer) else None
            if kind:
                candidates.append({
                    "kind":"door",
                    "x":float(center.get("x",0)),
                    "y":float(center.get("y",0)),
                    "width":max(0.70,min(1.60,radius*unit_scale)),
                    "source":"arc",
                    "entityIndex":idx
                })

    # Window signal: many line/polyline primitives close to each other on window-related layers.
    win_points=[]
    for idx,e in enumerate(entities):
        layer=norm(e.get("layer",""))
        if not ("PENCERE" in layer or "WINDOW" in layer or "KA-PEN" in layer or "KAP-PEN" in layer):
            continue
        if e.get("type") not in ("LINE","LWPOLYLINE","POLYLINE"):
            continue
        pts=entity_sample_points(e)
        if not pts:
            continue
        xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
        cx=sum(xs)/len(xs); cy=sum(ys)/len(ys)
        win_points.append((cx,cy,idx))

    if win_points:
        coords=[(p[0],p[1]) for p in win_points]
        groups=cluster_points(coords, max(0.35/unit_scale,1.0))
        for g in groups:
            if len(g)<3:
                continue
            pts=[]
            for gi in g:
                e=entities[win_points[gi][2]]
                pts.extend(entity_sample_points(e))
            if not pts:
                continue
            xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
            width_m=max(max(xs)-min(xs),max(ys)-min(ys))*unit_scale
            if width_m<0.45 or width_m>3.50:
                continue
            candidates.append({
                "kind":"window",
                "x":sum(xs)/(len(xs)),
                "y":sum(ys)/(len(ys)),
                "width":max(0.45,min(3.50,width_m)),
                "source":"cluster",
                "members":len(g)
            })

    # Snap each opening to nearest reconstructed wall.
    out=[]
    for op in candidates:
        best=None
        for wi,w in enumerate(walls):
            ax=float(w["start"]["x"]); ay=float(w["start"]["y"])
            bx=float(w["end"]["x"]); by=float(w["end"]["y"])
            dist,t=point_seg_distance(op["x"],op["y"],ax,ay,bx,by)
            dist_m=dist*unit_scale
            if dist_m>0.35:
                continue
            score=dist_m
            if best is None or score<best[0]:
                best=(score,wi,t)
        if best is None:
            continue
        _,wi,t=best
        w=walls[wi]
        ax=float(w["start"]["x"]); ay=float(w["start"]["y"])
        bx=float(w["end"]["x"]); by=float(w["end"]["y"])
        x=ax+(bx-ax)*t; y=ay+(by-ay)*t
        wall_len=float(w["length"])*unit_scale
        width=min(op["width"], max(0.35, wall_len-0.20))
        out.append({
            "kind":op["kind"],
            "wallIndex":wi,
            "t":t,
            "x":x,
            "y":y,
            "width":width,
            "source":op.get("source"),
            "members":op.get("members",1)
        })

    # De-duplicate openings on same wall and close station.
    dedup=[]
    for op in sorted(out,key=lambda z:(z["wallIndex"],z["t"],z["kind"])):
        duplicate=False
        for prev in dedup[-8:]:
            if prev["wallIndex"]==op["wallIndex"] and abs(prev["t"]-op["t"])<0.045:
                # Door arc wins over a generic window cluster at same location.
                if op["kind"]=="door" and prev["kind"]!="door":
                    prev.update(op)
                duplicate=True
                break
        if not duplicate:
            dedup.append(op)

    return dedup
def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error":"ARGS","detail":"usage: analyze_ezdxf.py file.dxf selection.json"}, ensure_ascii=False))
        return 2

    dxf_path = Path(sys.argv[1])
    selection_path = Path(sys.argv[2])
    payload = json.loads(selection_path.read_text(encoding="utf-8"))
    region = payload.get("selection") if isinstance(payload, dict) and "selection" in payload else payload
    unit_mode = payload.get("unitMode","mm") if isinstance(payload, dict) else "mm"
    unit_scale = {"mm":0.001,"cm":0.01,"m":1.0}.get(unit_mode,0.001)

    try:
        doc = ezdxf.readfile(str(dxf_path))
    except Exception as exc:
        print(json.dumps({"error":"DXF_READ_FAILED","detail":str(exc)}, ensure_ascii=False))
        return 4

    def raw_layout_bounds(layout):
        minx = miny = float("inf")
        maxx = maxy = float("-inf")
        count = 0
        for source in layout:
            for e in iter_virtual(source):
                pts = entity_points(e)
                for p in pts:
                    x, y = float(p.x), float(p.y)
                    minx=min(minx,x); maxx=max(maxx,x)
                    miny=min(miny,y); maxy=max(maxy,y)
                    count += 1
        if not math.isfinite(minx):
            return None
        return {"minX":minx,"minY":miny,"maxX":maxx,"maxY":maxy,"pointCount":count}

    def scan_layout(layout):
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

        for source in layout:
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
                    center = e.dxf.center
                    item["center"] = v3(center)
                    if t in ("CIRCLE","ARC"):
                        item["radius"] = float(e.dxf.radius)
                    if t == "ARC":
                        item["startAngle"] = float(getattr(e.dxf,"start_angle",0.0))
                        item["endAngle"] = float(getattr(e.dxf,"end_angle",0.0))
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

        bounds = None
        if math.isfinite(minx):
            bounds = {"minX":minx,"minY":miny,"maxX":maxx,"maxY":maxy}

        recognized = counts["wall"] + counts["column"] + counts["door"] + counts["window"] + counts["stair"]
        return {
            "name": layout.name,
            "rawBounds": raw_layout_bounds(layout),
            "entities": entities,
            "texts": texts,
            "layer_counts": layer_counts,
            "counts": counts,
            "bounds": bounds,
            "recognized": recognized,
            "total": len(entities)
        }

    scans = [scan_layout(layout) for layout in doc.layouts]
    scans.sort(key=lambda s: (s["recognized"], s["total"]), reverse=True)
    best = scans[0] if scans else {
        "name":"Model","entities":[],"texts":[],"layer_counts":{},
        "counts":{k:0 for k in KINDS},"bounds":None,"recognized":0,"total":0
    }

    entities = best["entities"]
    texts = best["texts"]
    layer_counts = best["layer_counts"]
    counts = best["counts"]
    bounds = best["bounds"]

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

    wall_segments = reconstruct_walls(entities, unit_scale)
    openings = reconstruct_openings(entities, wall_segments, unit_scale)

    warnings = []
    if not entities:
        warnings.append("Seçilen alanda modellenebilir CAD geometrisi bulunamadı.")
    if counts["wall"] == 0:
        warnings.append("Seçilen planda DUVAR geometrisi bulunamadı veya farklı katmandadır.")
    elif not wall_segments:
        warnings.append("DUVAR çizgileri okundu ancak paralel duvar çiftleri henüz güvenilir biçimde eşleştirilemedi.")
    if counts["column"] == 0:
        warnings.append("Seçilen planda KOLON geometrisi bulunamadı veya farklı katmandadır.")
    if counts["door"] == 0:
        warnings.append("Seçilen planda KAPI geometrisi bulunamadı veya farklı katmandadır.")
    if counts["window"] == 0:
        warnings.append("Seçilen planda PENCERE geometrisi bulunamadı veya farklı katmandadır.")

    result = {
        "engine":"ezdxf",
        "dxfVersion":doc.dxfversion,
        "layout":best["name"],
        "selectionDiagnostics":{
            "polygon":region.get("polygon"),
            "bounds":region.get("bounds")
        },
        "layoutDiagnostics":[
            {
                "name":s["name"],
                "recognized":s["recognized"],
                "total":s["total"],
                "rawBounds":s.get("rawBounds")
            }
            for s in scans
        ],
        "layers":layers,
        "entities":entities,
        "wallSegments":wall_segments,
        "openings":openings,
        "reconstruction":{
            "rawWallEntityCount":counts["wall"],
            "wallSegmentCount":len(wall_segments),
            "doorOpeningCount":sum(1 for o in openings if o["kind"]=="door"),
            "windowOpeningCount":sum(1 for o in openings if o["kind"]=="window"),
            "unitMode":unit_mode,
            "unitScale":unit_scale
        },
        "counts":counts,
        "texts":texts[:5000],
        "bounds":bounds,
        "warnings":warnings
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
