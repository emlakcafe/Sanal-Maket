#!/usr/bin/env python3
import json
import math
import sys
from pathlib import Path

import trimesh
from shapely.geometry import LineString, Polygon, MultiPolygon
from shapely.ops import unary_union, polygonize

def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))

def polygons_from_geom(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return [p for p in g.geoms if not p.is_empty]
    try:
        return [p for p in g.geoms if isinstance(p, Polygon) and not p.is_empty]
    except Exception:
        return []

def main():
    if len(sys.argv)<3:
        print(json.dumps({"error":"ARGS","detail":"usage: build_roof_glb.py analysis.json output.glb"}))
        return 2

    analysis=load_json(sys.argv[1])
    output=Path(sys.argv[2])
    recon=analysis.get("reconstruction") or {}
    scale=float(recon.get("unitScale") or 0.001)

    lines=[]
    raw_pts=[]

    for e in analysis.get("entities") or []:
        kind=e.get("kind")
        t=e.get("type")
        if t not in ("LINE","LWPOLYLINE","POLYLINE"):
            continue
        verts=e.get("vertices") or []
        if len(verts)<2:
            continue
        pts=[]
        for v in verts:
            x=float(v.get("x",0))*scale
            y=float(v.get("y",0))*scale
            pts.append((x,y))
            raw_pts.append((x,y))
        for i in range(len(pts)-1):
            if math.hypot(pts[i+1][0]-pts[i][0],pts[i+1][1]-pts[i][1])>0.05:
                lines.append(LineString([pts[i],pts[i+1]]))

    if not lines:
        print(json.dumps({"error":"NO_ROOF_LINES","detail":"Seçilen çatı alanında çizgi geometrisi bulunamadı."},ensure_ascii=False))
        return 3

    merged=unary_union(lines)
    polys=[p.buffer(0) for p in polygonize(merged)]
    polys=[p for p in polys if p.area>0.50]

    if not polys:
        # Fallback: use buffered line network envelope, never selection rectangle.
        footprint=merged.buffer(0.10).buffer(0)
        polys=polygons_from_geom(footprint)

    if not polys:
        print(json.dumps({"error":"ROOF_POLYGON_FAILED","detail":"Çatı konturu kapalı poligona dönüştürülemedi."},ensure_ascii=False))
        return 4

    # Prefer the largest coherent roof polygons; discard tiny annotation cells.
    polys=sorted(polys,key=lambda p:p.area,reverse=True)
    largest=polys[0].area
    keep=[p for p in polys if p.area>=max(1.0,largest*0.03)]

    union=unary_union(keep).buffer(0)
    roof_polys=polygons_from_geom(union)

    minx,miny,maxx,maxy=union.bounds
    ox=(minx+maxx)/2.0
    oy=(miny+maxy)/2.0

    scene=trimesh.Scene()
    count=0
    total_area=0.0

    for p in roof_polys:
        if p.area<0.5:
            continue
        coords=[(x-ox,y-oy) for x,y in p.exterior.coords]
        holes=[[(x-ox,y-oy) for x,y in ring.coords] for ring in p.interiors]
        local=Polygon(coords,holes).buffer(0)
        if local.is_empty or local.area<0.5:
            continue
        mesh=trimesh.creation.extrude_polygon(local,height=0.24)
        mesh.visual.face_colors=[150,72,55,255]
        scene.add_geometry(mesh,node_name=f"roof_{count}",geom_name=f"roof_{count}")
        total_area+=local.area
        count+=1

    if count==0:
        print(json.dumps({"error":"ROOF_MESH_FAILED","detail":"Çatı mesh'i oluşturulamadı."},ensure_ascii=False))
        return 5

    glb=scene.export(file_type="glb")
    output.write_bytes(glb)
    print(json.dumps({
        "ok":True,
        "bytes":len(glb),
        "roofPolygons":count,
        "roofArea":round(total_area,2),
        "origin":{"x":ox,"y":oy},
        "bounds":scene.bounds.tolist() if scene.bounds is not None else None
    }))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
