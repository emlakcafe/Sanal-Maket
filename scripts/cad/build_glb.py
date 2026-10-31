#!/usr/bin/env python3
import base64
import json
import math
import sys
from pathlib import Path

import numpy as np
import trimesh
from shapely.geometry import LineString, Polygon, MultiPolygon
from shapely.ops import unary_union

def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))

def as_poly_list(geom):
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return [g for g in geom.geoms if not g.is_empty]
    try:
        return [g for g in geom.geoms if isinstance(g, Polygon) and not g.is_empty]
    except Exception:
        return []

def make_transform(cx, cy, z):
    m=np.eye(4)
    m[0,3]=cx
    m[1,3]=cy
    m[2,3]=z
    return m

def main():
    if len(sys.argv)<3:
        print(json.dumps({"error":"ARGS","detail":"usage: build_glb.py analysis.json output.glb"}))
        return 2

    analysis=load_json(sys.argv[1])
    output=Path(sys.argv[2])

    recon=analysis.get("reconstruction") or {}
    unit_scale=float(recon.get("unitScale") or 0.001)
    floor_height=float(analysis.get("floorHeight") or 3.0)

    wall_segments=analysis.get("wallSegments") or []
    if not wall_segments:
        print(json.dumps({"error":"NO_WALLS","detail":"Reconstructed wall segments not found."}))
        return 3

    wall_polys=[]
    for w in wall_segments:
        a=w.get("start") or {}
        b=w.get("end") or {}
        ax=float(a.get("x",0))*unit_scale
        ay=float(a.get("y",0))*unit_scale
        bx=float(b.get("x",0))*unit_scale
        by=float(b.get("y",0))*unit_scale
        thickness=max(0.08,min(0.45,float(w.get("thickness",0))*unit_scale))
        length=math.hypot(bx-ax,by-ay)
        if length<0.35 or length>30:
            continue
        wall_polys.append(
            LineString([(ax,ay),(bx,by)]).buffer(
                thickness/2.0,
                cap_style=2,
                join_style=2
            )
        )

    if not wall_polys:
        print(json.dumps({"error":"NO_VALID_WALLS","detail":"No valid wall polygons generated."}))
        return 4

    wall_union=unary_union(wall_polys).buffer(0)
    wall_meshes=[]
    for poly in as_poly_list(wall_union):
        if poly.area<0.02:
            continue
        mesh=trimesh.creation.extrude_polygon(poly,height=floor_height)
        wall_meshes.append(mesh)

    if not wall_meshes:
        print(json.dumps({"error":"WALL_MESH_FAILED","detail":"Wall polygons could not be extruded."}))
        return 5

    scene=trimesh.Scene()
    for i,m in enumerate(wall_meshes):
        m.visual.face_colors=[225,222,216,255]
        scene.add_geometry(m,node_name=f"wall_{i}",geom_name=f"wall_{i}")

    # Columns: only reliable closed/polyline/circle-like entities.
    col_index=0
    for e in analysis.get("entities") or []:
        if e.get("kind")!="column":
            continue
        center=e.get("center")
        radius=e.get("radius")
        verts=e.get("vertices") or []
        mesh=None
        if center and radius:
            r=max(0.08,float(radius)*unit_scale)
            mesh=trimesh.creation.cylinder(radius=r,height=floor_height,sections=24)
            mesh.apply_translation([
                float(center.get("x",0))*unit_scale,
                float(center.get("y",0))*unit_scale,
                floor_height/2
            ])
        elif len(verts)>=3:
            pts=[(float(v.get("x",0))*unit_scale,float(v.get("y",0))*unit_scale) for v in verts]
            try:
                p=Polygon(pts).buffer(0)
                if p.area>0.01:
                    mesh=trimesh.creation.extrude_polygon(p,height=floor_height)
            except Exception:
                mesh=None
        if mesh is not None:
            mesh.visual.face_colors=[178,184,194,255]
            scene.add_geometry(mesh,node_name=f"column_{col_index}",geom_name=f"column_{col_index}")
            col_index+=1

    # Thin slab under the wall footprint; use wall union envelope rather than selection rectangle.
    footprint=wall_union.buffer(0.10).buffer(0)
    for i,poly in enumerate(as_poly_list(footprint)):
        if poly.area<0.1:
            continue
        slab=trimesh.creation.extrude_polygon(poly,height=0.16)
        slab.apply_translation([0,0,-0.16])
        slab.visual.face_colors=[205,208,212,255]
        scene.add_geometry(slab,node_name=f"slab_{i}",geom_name=f"slab_{i}")

    glb=scene.export(file_type="glb")
    output.write_bytes(glb)

    bounds=scene.bounds.tolist() if scene.bounds is not None else None
    result={
        "ok":True,
        "bytes":len(glb),
        "wallPolygons":len(wall_meshes),
        "columns":col_index,
        "bounds":bounds
    }
    print(json.dumps(result))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
