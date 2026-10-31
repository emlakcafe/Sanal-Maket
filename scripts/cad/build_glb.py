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

    scene=trimesh.Scene()

    wall_segments=analysis.get("wallSegments") or []
    openings=analysis.get("openings") or []

    wall_mesh_count=0
    door_count=0
    window_count=0
    glass_count=0
    wall_footprints=[]

    def add_box(name,cx,cy,z0,length,thickness,height,angle,color):
        nonlocal wall_mesh_count
        if length<=0.02 or height<=0.02:
            return
        mesh=trimesh.creation.box(extents=[length,thickness,height])
        ca=math.cos(angle); sa=math.sin(angle)
        transform=np.array([
            [ca,-sa,0,cx],
            [sa, ca,0,cy],
            [0,  0, 1,z0+height/2.0],
            [0,  0, 0,1]
        ],dtype=float)
        mesh.apply_transform(transform)
        mesh.visual.face_colors=color
        scene.add_geometry(mesh,node_name=name,geom_name=name)
        wall_mesh_count+=1

    def add_panel(name,cx,cy,z0,width,depth,height,angle,color):
        mesh=trimesh.creation.box(extents=[width,depth,height])
        ca=math.cos(angle); sa=math.sin(angle)
        transform=np.array([
            [ca,-sa,0,cx],
            [sa, ca,0,cy],
            [0,  0, 1,z0+height/2.0],
            [0,  0, 0,1]
        ],dtype=float)
        mesh.apply_transform(transform)
        mesh.visual.face_colors=color
        scene.add_geometry(mesh,node_name=name,geom_name=name)

    for wi,w in enumerate(wall_segments):
        a=w.get("start") or {}; b=w.get("end") or {}
        ax=float(a.get("x",0))*unit_scale
        ay=float(a.get("y",0))*unit_scale
        bx=float(b.get("x",0))*unit_scale
        by=float(b.get("y",0))*unit_scale
        thickness=max(0.08,min(0.45,float(w.get("thickness",0))*unit_scale))
        dx=bx-ax; dy=by-ay
        length=math.hypot(dx,dy)
        if length<0.35 or length>30:
            continue
        angle=math.atan2(dy,dx)
        ux=dx/length; uy=dy/length

        wall_footprints.append(
            LineString([(ax,ay),(bx,by)]).buffer(thickness/2.0,cap_style=2,join_style=2)
        )

        wall_ops=[o for o in openings if int(o.get("wallIndex",-1))==wi]
        intervals=[]
        for o in wall_ops:
            station=max(0.0,min(length,float(o.get("t",0))*length))
            width=max(0.45,min(float(o.get("width",0.9)),length))
            left=max(0.0,station-width/2.0)
            right=min(length,station+width/2.0)
            if right-left<0.30:
                continue
            intervals.append((left,right,o))

        bounds={0.0,length}
        for left,right,_ in intervals:
            bounds.add(left);bounds.add(right)
        cuts=sorted(bounds)

        for si in range(len(cuts)-1):
            x0,x1=cuts[si],cuts[si+1]
            seg_len=x1-x0
            if seg_len<=0.02:
                continue
            mid=(x0+x1)/2.0
            cover=None
            for left,right,o in intervals:
                if left<=mid<=right:
                    cover=o
                    break

            cx=ax+ux*mid
            cy=ay+uy*mid

            if cover is None:
                add_box(
                    f"wall_{wi}_{si}",cx,cy,0.0,seg_len,thickness,floor_height,angle,
                    [225,222,216,255]
                )
                continue

            kind=cover.get("kind")
            if kind=="door":
                door_count+=1
                door_h=min(2.15,max(1.95,floor_height-0.25))
                if floor_height>door_h:
                    add_box(
                        f"door_header_{wi}_{si}",cx,cy,door_h,seg_len,thickness,
                        floor_height-door_h,angle,[225,222,216,255]
                    )
                # thin door leaf, slightly recessed from wall thickness
                add_panel(
                    f"door_leaf_{wi}_{si}",cx,cy,0.0,seg_len*0.94,max(0.035,thickness*0.18),
                    door_h,angle,[132,91,60,255]
                )
            elif kind=="window":
                window_count+=1
                sill=min(0.90,max(0.60,floor_height*0.30))
                head=min(2.20,max(sill+0.80,floor_height*0.76))
                add_box(
                    f"window_sill_{wi}_{si}",cx,cy,0.0,seg_len,thickness,sill,angle,
                    [225,222,216,255]
                )
                if floor_height>head:
                    add_box(
                        f"window_head_{wi}_{si}",cx,cy,head,seg_len,thickness,
                        floor_height-head,angle,[225,222,216,255]
                    )
                glass_h=max(0.45,head-sill)
                add_panel(
                    f"glass_{wi}_{si}",cx,cy,sill,seg_len*0.92,max(0.018,thickness*0.08),
                    glass_h,angle,[102,174,205,150]
                )
                glass_count+=1

    if wall_mesh_count==0:
        print(json.dumps({"error":"WALL_MESH_FAILED","detail":"Wall/opening meshes could not be generated."}))
        return 5

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

    # Thin slab under the wall footprint; use reconstructed wall footprint rather than selection rectangle.
    footprint=unary_union(wall_footprints).buffer(0.10).buffer(0)
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
        "wallPolygons":wall_mesh_count,
        "doors":door_count,
        "windows":window_count,
        "glassPanels":glass_count,
        "columns":col_index,
        "bounds":bounds
    }
    print(json.dumps(result))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
