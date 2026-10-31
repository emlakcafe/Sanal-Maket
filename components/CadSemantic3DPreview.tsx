"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CadSemanticAnalysis } from "@/lib/cad/semanticAnalyzer";

export type BuiltFloor = {
  name:string;
  analysis:CadSemanticAnalysis;
  elevation:number;
  height:number;
};

export default function CadSemantic3DPreview({
  floors,
  wallThickness,
  unitScale
}:{
  floors:BuiltFloor[];
  wallThickness:number;
  unitScale:number;
}){
  const ref=useRef<HTMLDivElement|null>(null);
  const cameraRef=useRef<THREE.PerspectiveCamera|null>(null);
  const controlsRef=useRef<OrbitControls|null>(null);
  const boundsRef=useRef<THREE.Box3|null>(null);
  const [ready,setReady]=useState(false);

  function focusModel(mode:"iso"|"top"|"front"="iso"){
    const camera=cameraRef.current;
    const controls=controlsRef.current;
    const box=boundsRef.current;
    if(!camera||!controls||!box||box.isEmpty()) return;
    const size=box.getSize(new THREE.Vector3());
    const center=box.getCenter(new THREE.Vector3());
    const radius=Math.max(size.x,size.z,size.y,10);
    controls.target.copy(center);
    if(mode==="top") camera.position.copy(center.clone().add(new THREE.Vector3(0,radius*1.7,0.01)));
    else if(mode==="front") camera.position.copy(center.clone().add(new THREE.Vector3(0,radius*.45,radius*1.6)));
    else camera.position.copy(center.clone().add(new THREE.Vector3(radius*.9,radius*.75,radius*1.1)));
    camera.near=Math.max(.01,radius/5000);
    camera.far=radius*100;
    camera.updateProjectionMatrix();
    controls.update();
  }

  useEffect(()=>{
    const host=ref.current;
    if(!host) return;

    const scene=new THREE.Scene();
    scene.background=new THREE.Color(0xf2f6fa);
    const camera=new THREE.PerspectiveCamera(48,1,.01,100000);
    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled=true;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff,0x72806e,1.8));
    const sun=new THREE.DirectionalLight(0xffffff,2.4);
    sun.position.set(10,20,12);
    sun.castShadow=true;
    scene.add(sun);

    const controls=new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true;
    controls.enablePan=true;
    controls.enableZoom=true;
    controls.mouseButtons.LEFT=THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE=THREE.MOUSE.DOLLY;
    controls.mouseButtons.RIGHT=THREE.MOUSE.PAN;
    cameraRef.current=camera;
    controlsRef.current=controls;

    const group=new THREE.Group();
    scene.add(group);

    const wallMat=new THREE.MeshStandardMaterial({color:0xe8e2d8,roughness:.72});
    const columnMat=new THREE.MeshStandardMaterial({color:0xb7bcc5,roughness:.65});
    const doorMat=new THREE.MeshStandardMaterial({color:0x8f6748,roughness:.65});
    const windowMat=new THREE.MeshPhysicalMaterial({color:0x8dbbd0,roughness:.12,transmission:.55,transparent:true,opacity:.72});

    const addSegment=(a:{x:number;y:number},b:{x:number;y:number},height:number,thickness:number,mat:THREE.Material,y=0)=>{
      const ax=a.x*unitScale, az=a.y*unitScale, bx=b.x*unitScale, bz=b.y*unitScale;
      const dx=bx-ax, dz=bz-az;
      const len=Math.hypot(dx,dz);
      if(!Number.isFinite(len)||len<1e-6) return;
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(len,height,thickness),mat);
      mesh.position.set((ax+bx)/2,y+height/2,(az+bz)/2);
      mesh.rotation.y=-Math.atan2(dz,dx);
      mesh.castShadow=true; mesh.receiveShadow=true;
      group.add(mesh);
    };

    for(const floor of floors){
      const floorHeight=floor.height;
      const baseY=floor.elevation;

      const recognizedCount =
        floor.analysis.counts.wall +
        floor.analysis.counts.column +
        floor.analysis.counts.door +
        floor.analysis.counts.window +
        floor.analysis.counts.stair;

      const slabBox=recognizedCount>0 ? floor.analysis.bounds : null;
      if(slabBox){
        const w=(slabBox.maxX-slabBox.minX)*unitScale;
        const d=(slabBox.maxY-slabBox.minY)*unitScale;
        if(w>0.01 && d>0.01){
          const slab=new THREE.Mesh(
            new THREE.BoxGeometry(w,0.18,d),
            new THREE.MeshStandardMaterial({color:0xd8dbe0,roughness:.82})
          );
          slab.position.set(
            ((slabBox.minX+slabBox.maxX)/2)*unitScale,
            baseY+0.09,
            ((slabBox.minY+slabBox.maxY)/2)*unitScale
          );
          slab.receiveShadow=true;
          group.add(slab);
        }
      }

      for(const e of floor.analysis.entities){
        const vs=e.vertices||[];
        if(e.kind==="wall" && vs.length>=2){
          for(let i=0;i<vs.length-1;i++) addSegment(vs[i],vs[i+1],floorHeight,wallThickness,wallMat,baseY+0.18);
        } else if(e.kind==="column"){
          if(e.center && e.radius){
            const m=new THREE.Mesh(new THREE.CylinderGeometry(e.radius*unitScale,e.radius*unitScale,floorHeight,24),columnMat);
            m.position.set(e.center.x*unitScale,baseY+0.18+floorHeight/2,e.center.y*unitScale); group.add(m);
          } else if(vs.length>=2){
            for(let i=0;i<vs.length-1;i++) addSegment(vs[i],vs[i+1],floorHeight,wallThickness*1.8,columnMat,baseY+0.18);
          }
        } else if((e.kind==="door"||e.kind==="window") && vs.length>=2){
          const mat=e.kind==="door"?doorMat:windowMat;
          const h=e.kind==="door"?Math.min(2.2,floorHeight*.75):Math.min(1.5,floorHeight*.5);
          const y=e.kind==="door"?0:Math.min(.9,floorHeight*.28);
          for(let i=0;i<vs.length-1;i++) addSegment(vs[i],vs[i+1],h,wallThickness*.7,mat,baseY+0.18+y);
        }
      }
    }

    const box=new THREE.Box3().setFromObject(group);
    boundsRef.current=box;
    if(!box.isEmpty()){
      const size=box.getSize(new THREE.Vector3());
      const center=box.getCenter(new THREE.Vector3());
      const radius=Math.max(size.x,size.z,size.y,10);
      controls.target.copy(center);
      camera.position.copy(center.clone().add(new THREE.Vector3(radius*.9,radius*.75,radius*1.1)));
      camera.near=Math.max(.01,radius/5000);
      camera.far=radius*100;
      camera.updateProjectionMatrix();
      controls.update();
      setReady(true);
      const grid=new THREE.GridHelper(radius*2,40,0x7f8c9d,0xcbd5e1);
      grid.position.y=0;
      scene.add(grid);
    }

    const resize=()=>{
      const w=host.clientWidth,h=Math.max(480,host.clientHeight);
      renderer.setSize(w,h,true); camera.aspect=w/h; camera.updateProjectionMatrix();
    };
    resize();
    const ro=new ResizeObserver(resize); ro.observe(host);

    let raf=0;
    const loop=()=>{controls.update();renderer.render(scene,camera);raf=requestAnimationFrame(loop);};
    loop();

    return ()=>{setReady(false);cameraRef.current=null;controlsRef.current=null;boundsRef.current=null;cancelAnimationFrame(raf);ro.disconnect();controls.dispose();renderer.dispose();host.innerHTML="";};
  },[floors,wallThickness,unitScale]);

  return <div style={{border:"1px solid #b8cce6",borderRadius:12,overflow:"hidden",background:"#fff"}}>
    <div style={{display:"flex",gap:8,alignItems:"center",padding:"9px 10px",borderBottom:"1px solid #d7e2ef",background:"#f8fbff"}}>
      <b style={{fontSize:12}}>Canlı 3D Önizleme</b>
      <span style={{fontSize:10,color:"#6f8299"}}>Sol tuş: döndür · Tekerlek: zoom · Sağ tuş: pan</span>
      <div style={{marginLeft:"auto",display:"flex",gap:6}}>
        <button type="button" onClick={()=>focusModel("iso")} disabled={!ready} style={previewBtn}>İzometrik</button>
        <button type="button" onClick={()=>focusModel("top")} disabled={!ready} style={previewBtn}>Üstten</button>
        <button type="button" onClick={()=>focusModel("front")} disabled={!ready} style={previewBtn}>Önden</button>
      </div>
    </div>
    <div ref={ref} style={{width:"100%",height:620,overflow:"hidden",cursor:"grab"}}/>
  </div>;
}


const previewBtn:React.CSSProperties={
  border:"1px solid #aac0da",
  background:"#fff",
  color:"#174b86",
  borderRadius:7,
  padding:"7px 10px",
  fontSize:11,
  fontWeight:700,
  cursor:"pointer"
};
