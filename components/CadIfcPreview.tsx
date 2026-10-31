"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { IfcAPI } from "web-ifc";

export default function CadIfcPreview({base64}:{base64:string}){
  const hostRef=useRef<HTMLDivElement|null>(null);
  const [status,setStatus]=useState("IFC modeli yükleniyor...");

  useEffect(()=>{
    const host=hostRef.current;
    if(!host||!base64) return;

    let cancelled=false;
    let raf=0;
    let modelID:number|undefined;
    let ifcAPI:IfcAPI|undefined;

    const scene=new THREE.Scene();
    scene.background=new THREE.Color(0xf2f6fa);

    const camera=new THREE.PerspectiveCamera(45,1,.01,5000);
    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.05;
    renderer.shadowMap.enabled=true;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff,0x697783,2.0));
    const sun=new THREE.DirectionalLight(0xffffff,2.7);
    sun.position.set(12,20,10);
    sun.castShadow=true;
    scene.add(sun);

    const controls=new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true;
    controls.enablePan=true;
    controls.enableZoom=true;

    const root=new THREE.Group();
    root.rotation.x=-Math.PI/2;
    scene.add(root);

    const start=async()=>{
      try{
        const bytes=Uint8Array.from(atob(base64),ch=>ch.charCodeAt(0));

        ifcAPI=new IfcAPI();
        ifcAPI.SetWasmPath("/api/web-ifc/");
        await ifcAPI.Init();
        if(cancelled) return;

        modelID=ifcAPI.OpenModel(bytes,{COORDINATE_TO_ORIGIN:true});
        let meshCount=0;

        ifcAPI.StreamAllMeshes(modelID,(flatMesh:any)=>{
          const placedGeometries=flatMesh.geometries;
          for(let i=0;i<placedGeometries.size();i++){
            const pg=placedGeometries.get(i);
            const geom=ifcAPI!.GetGeometry(modelID!,pg.geometryExpressID);
            const verts=ifcAPI!.GetVertexArray(geom.GetVertexData(),geom.GetVertexDataSize());
            const indices=ifcAPI!.GetIndexArray(geom.GetIndexData(),geom.GetIndexDataSize());

            const positions=new Float32Array((verts.length/6)*3);
            const normals=new Float32Array((verts.length/6)*3);
            for(let v=0,j=0;v<verts.length;v+=6,j+=3){
              positions[j]=verts[v];
              positions[j+1]=verts[v+1];
              positions[j+2]=verts[v+2];
              normals[j]=verts[v+3];
              normals[j+1]=verts[v+4];
              normals[j+2]=verts[v+5];
            }

            const geometry=new THREE.BufferGeometry();
            geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));
            geometry.setAttribute("normal",new THREE.BufferAttribute(normals,3));
            geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices),1));

            const color=pg.color||{x:.72,y:.75,z:.78,w:1};
            const material=new THREE.MeshStandardMaterial({
              color:new THREE.Color(color.x,color.y,color.z),
              roughness:.72,
              metalness:0,
              transparent:color.w<.999,
              opacity:color.w
            });

            const mesh=new THREE.Mesh(geometry,material);
            mesh.applyMatrix4(new THREE.Matrix4().fromArray(pg.flatTransformation));
            mesh.castShadow=true;
            mesh.receiveShadow=true;
            root.add(mesh);
            meshCount++;
          }
        });

        root.updateMatrixWorld(true);
        const box=new THREE.Box3().setFromObject(root);
        if(!box.isEmpty()){
          const center=box.getCenter(new THREE.Vector3());
          const size=box.getSize(new THREE.Vector3());
          const radius=Math.max(size.x,size.y,size.z,6);
          controls.target.copy(center);
          camera.position.copy(center.clone().add(new THREE.Vector3(radius*.8,radius*.9,radius*1.05)));
          camera.near=Math.max(.01,radius/5000);
          camera.far=radius*100;
          camera.updateProjectionMatrix();
          controls.update();

          const grid=new THREE.GridHelper(radius*2.5,40,0x8795a5,0xcbd5e1);
          grid.position.y=box.min.y;
          scene.add(grid);
        }

        setStatus("IFC hazır · "+meshCount+" geometri · mouse ile döndür / zoom");
      }catch(err:any){
        setStatus("IFC görüntüleme hatası: "+String(err?.message||err));
      }
    };
    void start();

    const resize=()=>{
      const w=host.clientWidth||800;
      const h=Math.max(560,host.clientHeight||620);
      renderer.setSize(w,h,true);
      camera.aspect=w/h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro=new ResizeObserver(resize);
    ro.observe(host);

    const loop=()=>{
      controls.update();
      renderer.render(scene,camera);
      raf=requestAnimationFrame(loop);
    };
    loop();

    return ()=>{
      cancelled=true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if(ifcAPI&&modelID!==undefined){
        try{ifcAPI.CloseModel(modelID);}catch{}
      }
      root.traverse(obj=>{
        const mesh=obj as THREE.Mesh;
        if(mesh.isMesh){
          mesh.geometry.dispose();
          const mat=mesh.material;
          if(Array.isArray(mat)) mat.forEach(m=>m.dispose());
          else mat?.dispose();
        }
      });
      host.innerHTML="";
    };
  },[base64]);

  return <div style={{border:"1px solid #72a6df",borderRadius:12,overflow:"hidden",background:"#fff"}}>
    <div style={{padding:"10px 12px",borderBottom:"1px solid #d7e2ef",background:"#edf6ff",fontSize:12}}>
      <b>Profesyonel BIM / IFC Önizleme</b> · {status}
    </div>
    <div ref={hostRef} style={{width:"100%",height:620,cursor:"grab"}}/>
  </div>;
}
