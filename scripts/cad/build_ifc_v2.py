#!/usr/bin/env python3
import json, math, sys
from pathlib import Path
import numpy as np
import trimesh

try:
    from shapely.geometry import LineString
    from shapely.ops import unary_union, polygonize
except Exception as exc:
    print(json.dumps({"error":"SHAPELY_NOT_INSTALLED","detail":str(exc)},ensure_ascii=False))
    raise SystemExit(3)

try:
    import ifcopenshell
    import ifcopenshell.api.aggregate
    import ifcopenshell.api.context
    import ifcopenshell.api.geometry
    import ifcopenshell.api.project
    import ifcopenshell.api.root
    import ifcopenshell.api.spatial
    import ifcopenshell.api.unit
except Exception as exc:
    print(json.dumps({"error":"IFCOPENSHELL_NOT_INSTALLED","detail":str(exc)},ensure_ascii=False))
    raise SystemExit(4)

def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))

def add_box(scene,x1,y1,x2,y2,thickness,z0,z1,color,name):
    dx=x2-x1; dy=y2-y1
    length=math.hypot(dx,dy)
    if length<0.02 or z1<=z0:
        return 0
    angle=math.atan2(dy,dx)
    cx=(x1+x2)/2.0; cy=(y1+y2)/2.0
    mesh=trimesh.creation.box(extents=[length,thickness,z1-z0])
    ca=math.cos(angle); sa=math.sin(angle)
    tf=np.array([
        [ca,-sa,0,cx],
        [sa, ca,0,cy],
        [0,0,1,(z0+z1)/2.0],
        [0,0,0,1]
    ],dtype=float)
    mesh.apply_transform(tf)
    mesh.visual.face_colors=color
    scene.add_geometry(mesh,node_name=name,geom_name=name)
    return int(len(mesh.faces))

def split_intervals(length,ops):
    cuts=[]
    for op in ops:
        center=max(0.0,min(length,float(op["t"])*length))
        half=max(0.15,float(op.get("width") or 0.8)/2.0)
        a=max(0.0,center-half); b=min(length,center+half)
        if b-a>0.12:
            cuts.append((a,b,op))
    cuts.sort(key=lambda x:x[0])

    merged=[]
    for a,b,op in cuts:
        if not merged or a>merged[-1][1]+0.03:
            merged.append([a,b,[op]])
        else:
            merged[-1][1]=max(merged[-1][1],b)
            merged[-1][2].append(op)
    return merged

def main():
    if len(sys.argv)<4:
        print(json.dumps({"error":"ARGS","detail":"usage: build_ifc_v2.py analysis.json output.ifc preview.glb"}))
        return 2

    analysis=load_json(sys.argv[1])
    output=Path(sys.argv[2])
    preview_output=Path(sys.argv[3])
    recon=analysis.get("reconstruction") or {}
    scale=float(recon.get("unitScale") or 0.01)
    floor_height=float(analysis.get("floorHeight") or 2.8)
    walls=analysis.get("wallSegments") or []
    openings=analysis.get("openings") or []

    if not walls:
        print(json.dumps({"error":"NO_WALLS","detail":"V2 üretimi için duvar bulunamadı."},ensure_ascii=False))
        return 5

    pts=[]
    for w in walls:
        for key in ("start","end"):
            p=w.get(key) or {}
            pts.append((float(p.get("x",0))*scale,float(p.get("y",0))*scale))
    minx=min(x for x,y in pts); maxx=max(x for x,y in pts)
    miny=min(y for x,y in pts); maxy=max(y for x,y in pts)
    ox=(minx+maxx)/2.0; oy=(miny+maxy)/2.0

    # IFC semantic shell
    model=ifcopenshell.api.project.create_file()
    project=ifcopenshell.api.root.create_entity(model,ifc_class="IfcProject",name="Emlak Cafe BIM Project v2")
    ifcopenshell.api.unit.assign_unit(model)
    model3d=ifcopenshell.api.context.add_context(model,context_type="Model")
    body=ifcopenshell.api.context.add_context(model,context_type="Model",context_identifier="Body",target_view="MODEL_VIEW",parent=model3d)
    site=ifcopenshell.api.root.create_entity(model,ifc_class="IfcSite",name="Site")
    building=ifcopenshell.api.root.create_entity(model,ifc_class="IfcBuilding",name="Building")
    storey=ifcopenshell.api.root.create_entity(model,ifc_class="IfcBuildingStorey",name="Ground Floor")
    ifcopenshell.api.aggregate.assign_object(model,relating_object=project,products=[site])
    ifcopenshell.api.aggregate.assign_object(model,relating_object=site,products=[building])
    ifcopenshell.api.aggregate.assign_object(model,relating_object=building,products=[storey])

    scene=trimesh.Scene()
    ifc_walls=0; wall_faces=0; door_count=0; window_count=0; glass_count=0

    by_wall={}
    for op in openings:
        wi=int(op.get("wallIndex",-1))
        if wi>=0:
            by_wall.setdefault(wi,[]).append(op)

    room_lines=[]

    for idx,w in enumerate(walls):
        a=w.get("start") or {}; b=w.get("end") or {}
        x1=float(a.get("x",0))*scale-ox; y1=float(a.get("y",0))*scale-oy
        x2=float(b.get("x",0))*scale-ox; y2=float(b.get("y",0))*scale-oy
        dx=x2-x1; dy=y2-y1
        length=math.hypot(dx,dy)
        if length<0.18 or length>60:
            continue
        thickness=max(0.06,min(0.60,float(w.get("thickness") or 8.0)*scale))
        ux=dx/length; uy=dy/length

        room_lines.append(LineString([(x1,y1),(x2,y2)]))

        # semantic IFC keeps original full wall centerline
        wall=ifcopenshell.api.root.create_entity(model,ifc_class="IfcWall",name=f"Wall {idx+1:04d}")
        ifcopenshell.api.geometry.create_2pt_wall(model,element=wall,context=body,p1=(x1,y1),p2=(x2,y2),elevation=0.0,height=floor_height,thickness=thickness,is_si=True)
        ifcopenshell.api.spatial.assign_container(model,relating_structure=storey,products=[wall])
        ifc_walls+=1

        ops=by_wall.get(idx,[])
        intervals=split_intervals(length,ops)

        # solid wall pieces outside openings
        cursor=0.0
        for oi,(oa,ob,group) in enumerate(intervals):
            if oa>cursor:
                ax=x1+ux*cursor; ay=y1+uy*cursor
                bx=x1+ux*oa; by=y1+uy*oa
                wall_faces+=add_box(scene,ax,ay,bx,by,thickness,0,floor_height,[198,202,208,255],f"wall_{idx}_{oi}_a")

            kinds={str(g.get("kind")) for g in group}
            ax=x1+ux*oa; ay=y1+uy*oa
            bx=x1+ux*ob; by=y1+uy*ob

            if "door" in kinds:
                door_h=min(2.10,floor_height*0.86)
                if floor_height>door_h:
                    wall_faces+=add_box(scene,ax,ay,bx,by,thickness,door_h,floor_height,[198,202,208,255],f"door_header_{idx}_{oi}")
                door_count+=1
            else:
                sill=min(0.90,max(0.55,floor_height*0.30))
                head=min(floor_height-0.20,sill+1.20)
                if sill>0:
                    wall_faces+=add_box(scene,ax,ay,bx,by,thickness,0,sill,[198,202,208,255],f"window_sill_{idx}_{oi}")
                if floor_height>head:
                    wall_faces+=add_box(scene,ax,ay,bx,by,thickness,head,floor_height,[198,202,208,255],f"window_header_{idx}_{oi}")
                glass_th=max(0.018,min(0.035,thickness*0.22))
                wall_faces+=add_box(scene,ax,ay,bx,by,glass_th,sill,head,[90,175,210,125],f"glass_{idx}_{oi}")
                window_count+=1; glass_count+=1
            cursor=max(cursor,ob)

        if cursor<length:
            ax=x1+ux*cursor; ay=y1+uy*cursor
            wall_faces+=add_box(scene,ax,ay,x2,y2,thickness,0,floor_height,[198,202,208,255],f"wall_{idx}_tail")

    # Room polygons from snapped wall graph.
    rooms=[]
    try:
        merged=unary_union(room_lines)
        polys=list(polygonize(merged))
        for i,p in enumerate(polys):
            area=float(p.area)
            if area<2.0 or area>350.0:
                continue
            c=p.centroid
            rooms.append({"id":i+1,"area":round(area,2),"x":round(c.x,3),"y":round(c.y,3)})
            # thin floor plate makes room boundaries visible
            try:
                m=trimesh.creation.extrude_polygon(p,height=0.025)
                m.apply_translation([0,0,0.0125])
                m.visual.face_colors=[222,226,231,130]
                scene.add_geometry(m,node_name=f"room_{i+1}",geom_name=f"room_{i+1}")
            except Exception:
                pass
    except Exception as exc:
        print(json.dumps({"warning":"ROOM_POLYGONIZE_FAILED","detail":str(exc)},ensure_ascii=False),file=sys.stderr)

    model.write(str(output))
    glb=scene.export(file_type="glb")
    preview_output.write_bytes(glb)
    data=output.read_bytes()

    print(json.dumps({
        "ok":True,
        "bytes":len(data),
        "walls":ifc_walls,
        "doors":door_count,
        "windows":window_count,
        "glassPanels":glass_count,
        "rooms":rooms,
        "roomCount":len(rooms),
        "origin":{"x":ox,"y":oy},
        "schema":model.schema,
        "previewBytes":len(glb),
        "previewFaces":wall_faces
    },ensure_ascii=False))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
