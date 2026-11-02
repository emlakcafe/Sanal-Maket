import bpy
import math
import os
import sys
from mathutils import Vector

# Usage:
# blender.exe -b -P scripts/blender/render_glb.py -- input.glb output.png
argv = sys.argv
if "--" not in argv:
    raise SystemExit("Missing -- input.glb output.png")
args = argv[argv.index("--")+1:]
if len(args) < 2:
    raise SystemExit("Usage: render_glb.py input.glb output.png")

input_glb = os.path.abspath(args[0])
output_png = os.path.abspath(args[1])

# Clean scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# Import GLB
bpy.ops.import_scene.gltf(filepath=input_glb)

# Renderer
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.render.resolution_x = 1600
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.render.filepath = output_png

# World
scene.world.color = (0.04, 0.055, 0.075)

# Materials helper
def ensure_mat(name, base, roughness=0.5, metallic=0.0, transmission=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*base, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if "Transmission Weight" in bsdf.inputs:
            bsdf.inputs["Transmission Weight"].default_value = transmission
        elif "Transmission" in bsdf.inputs:
            bsdf.inputs["Transmission"].default_value = transmission
        if transmission > 0:
            bsdf.inputs["IOR"].default_value = 1.45
    return mat

wall_mat = ensure_mat("EC_Wall", (0.82,0.78,0.68), 0.72, 0.0, 0.0)
roof_mat = ensure_mat("EC_Roof", (0.05,0.06,0.07), 0.48, 0.05, 0.0)
glass_mat = ensure_mat("EC_Glass", (0.12,0.32,0.40), 0.08, 0.0, 0.92)
metal_mat = ensure_mat("EC_Metal", (0.08,0.09,0.10), 0.28, 0.65, 0.0)
ground_mat = ensure_mat("EC_Ground", (0.16,0.27,0.10), 0.92, 0.0, 0.0)

# Classify imported meshes by names/material names
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH':
        continue
    n = (obj.name or "").lower()
    mats = " ".join([m.name.lower() for m in obj.data.materials if m])
    key = n + " " + mats
    target = wall_mat
    if "glass" in key or "window" in key or "cam" in key:
        target = glass_mat
    elif "roof" in key or "cati" in key or "çatı" in key:
        target = roof_mat
    elif "rail" in key or "metal" in key or "korkuluk" in key or "frame" in key:
        target = metal_mat
    elif "ground" in key or "terrain" in key or "zemin" in key or "site" in key:
        target = ground_mat
    obj.data.materials.clear()
    obj.data.materials.append(target)

# Bounding box
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
if not meshes:
    raise SystemExit("No mesh found after GLB import")

coords=[]
for obj in meshes:
    for corner in obj.bound_box:
        coords.append(obj.matrix_world @ Vector(corner))

min_v=Vector((min(v.x for v in coords),min(v.y for v in coords),min(v.z for v in coords)))
max_v=Vector((max(v.x for v in coords),max(v.y for v in coords),max(v.z for v in coords)))
center=(min_v+max_v)*0.5
size=max_v-min_v
radius=max(size.x,size.y,size.z,1.0)

# Ground plane
bpy.ops.mesh.primitive_plane_add(size=radius*4, location=(center.x,center.y,min_v.z-0.02))
plane=bpy.context.object
plane.data.materials.append(ground_mat)

# Sun
bpy.ops.object.light_add(type='SUN', location=(center.x+radius,center.y-radius,center.z+radius*2))
sun=bpy.context.object
sun.data.energy=3.0
sun.rotation_euler=(math.radians(35),0,math.radians(35))

# Area fill light
bpy.ops.object.light_add(type='AREA', location=(center.x-radius*0.8,center.y+radius*0.6,center.z+radius*1.4))
area=bpy.context.object
area.data.energy=1200
area.data.shape='DISK'
area.data.size=radius*0.9

# Camera
bpy.ops.object.camera_add()
cam=bpy.context.object
scene.camera=cam
cam.location=(center.x+radius*1.6, center.y-radius*1.7, center.z+radius*1.1)

def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z','Y').to_euler()

look_at(cam, center)
cam.data.lens=42

# Color management
scene.view_settings.look='AgX - Medium High Contrast'

# Render
os.makedirs(os.path.dirname(output_png), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(output_png)[0] + ".blend")
bpy.ops.render.render(write_still=True)
print(f"RENDER_OK:{output_png}")
