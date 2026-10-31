#!/usr/bin/env python3
import json
import math
import sys
from pathlib import Path

import numpy as np
import trimesh

try:
    import ifcopenshell
    import ifcopenshell.api.aggregate
    import ifcopenshell.api.context
    import ifcopenshell.api.geometry
    import ifcopenshell.api.project
    import ifcopenshell.api.root
    import ifcopenshell.api.spatial
    import ifcopenshell.api.unit
    import ifcopenshell.geom
    import ifcopenshell.util.shape
except Exception as exc:
    print(json.dumps({"error":"IFCOPENSHELL_NOT_INSTALLED","detail":str(exc)},ensure_ascii=False))
    raise SystemExit(3)

def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))

def main():
    if len(sys.argv)<4:
        print(json.dumps({"error":"ARGS","detail":"usage: build_ifc.py analysis.json output.ifc preview.glb"}))
        return 2

    analysis=load_json(sys.argv[1])
    output=Path(sys.argv[2])
    preview_output=Path(sys.argv[3])
    recon=analysis.get("reconstruction") or {}
    scale=float(recon.get("unitScale") or 0.001)
    floor_height=float(analysis.get("floorHeight") or 3.0)
    walls=analysis.get("wallSegments") or []

    if not walls:
        print(json.dumps({"error":"NO_WALLS","detail":"IFC üretimi için yeniden oluşturulmuş duvar bulunamadı."},ensure_ascii=False))
        return 4

    pts=[]
    for w in walls:
        for key in ("start","end"):
            p=w.get(key) or {}
            pts.append((float(p.get("x",0))*scale,float(p.get("y",0))*scale))
    minx=min(x for x,y in pts); maxx=max(x for x,y in pts)
    miny=min(y for x,y in pts); maxy=max(y for x,y in pts)
    ox=(minx+maxx)/2.0
    oy=(miny+maxy)/2.0

    model=ifcopenshell.api.project.create_file()
    project=ifcopenshell.api.root.create_entity(model,ifc_class="IfcProject",name="Emlak Cafe BIM Project")
    ifcopenshell.api.unit.assign_unit(model)
    model3d=ifcopenshell.api.context.add_context(model,context_type="Model")
    body=ifcopenshell.api.context.add_context(
        model,context_type="Model",context_identifier="Body",
        target_view="MODEL_VIEW",parent=model3d
    )

    site=ifcopenshell.api.root.create_entity(model,ifc_class="IfcSite",name="Site")
    building=ifcopenshell.api.root.create_entity(model,ifc_class="IfcBuilding",name="Building")
    storey=ifcopenshell.api.root.create_entity(model,ifc_class="IfcBuildingStorey",name="Ground Floor")

    ifcopenshell.api.aggregate.assign_object(model,relating_object=project,products=[site])
    ifcopenshell.api.aggregate.assign_object(model,relating_object=site,products=[building])
    ifcopenshell.api.aggregate.assign_object(model,relating_object=building,products=[storey])

    created=0
    skipped=0
    for idx,w in enumerate(walls):
        a=w.get("start") or {}
        b=w.get("end") or {}
        p1=(float(a.get("x",0))*scale-ox,float(a.get("y",0))*scale-oy)
        p2=(float(b.get("x",0))*scale-ox,float(b.get("y",0))*scale-oy)
        length=math.hypot(p2[0]-p1[0],p2[1]-p1[1])
        thickness=max(0.07,min(0.45,float(w.get("thickness") or 0.20)*scale))
        if length<0.25 or length>40:
            skipped+=1
            continue

        wall=ifcopenshell.api.root.create_entity(
            model,ifc_class="IfcWall",name=f"Wall {idx+1:04d}"
        )
        ifcopenshell.api.geometry.create_2pt_wall(
            model,element=wall,context=body,p1=p1,p2=p2,
            elevation=0.0,height=floor_height,thickness=thickness,is_si=True
        )
        ifcopenshell.api.spatial.assign_container(
            model,relating_structure=storey,products=[wall]
        )
        created+=1

    if created==0:
        print(json.dumps({"error":"NO_IFC_WALLS","detail":"Geçerli IfcWall üretilemedi."},ensure_ascii=False))
        return 5

    model.write(str(output))

    # Build browser preview directly from the IFC geometry with IfcOpenShell.
    settings=ifcopenshell.geom.settings()
    scene=trimesh.Scene()
    preview_meshes=0
    preview_faces=0

    for wall in model.by_type("IfcWall"):
        try:
            shape=ifcopenshell.geom.create_shape(settings,wall)
            verts=np.asarray(ifcopenshell.util.shape.get_vertices(shape.geometry),dtype=float)
            faces=np.asarray(ifcopenshell.util.shape.get_faces(shape.geometry),dtype=np.int64)
            if verts.size==0 or faces.size==0:
                continue
            matrix=np.asarray(ifcopenshell.util.shape.get_shape_matrix(shape),dtype=float)
            homo=np.concatenate([verts,np.ones((verts.shape[0],1),dtype=float)],axis=1)
            world=(matrix @ homo.T).T[:,:3]
            mesh=trimesh.Trimesh(vertices=world,faces=faces,process=False)
            mesh.visual.face_colors=[198,202,208,255]
            scene.add_geometry(mesh,node_name=f"ifc_wall_{wall.id()}",geom_name=f"ifc_wall_{wall.id()}")
            preview_meshes+=1
            preview_faces+=int(len(faces))
        except Exception:
            continue

    if preview_meshes==0:
        print(json.dumps({"error":"IFC_PREVIEW_FAILED","detail":"IFC üretildi ancak önizleme mesh'i oluşturulamadı."},ensure_ascii=False))
        return 6

    glb=scene.export(file_type="glb")
    preview_output.write_bytes(glb)

    data=output.read_bytes()
    print(json.dumps({
        "ok":True,
        "bytes":len(data),
        "walls":created,
        "skipped":skipped,
        "origin":{"x":ox,"y":oy},
        "schema":model.schema,
        "previewBytes":len(glb),
        "previewMeshes":preview_meshes,
        "previewFaces":preview_faces
    }))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
