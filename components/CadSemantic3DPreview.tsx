"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CadSemanticAnalysis } from "@/lib/cad/semanticAnalyzer";

export default function CadSemantic3DPreview({
  analysis,
  floorHeight,
  wallThickness
}:{
  analysis:CadSemanticAnalysis;
  floorHeight:number;
  wallThickness:number;
}){
  const ref=useRef<HTMLDivElement|null>(null);

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

    const group=new THREE.Group();
    scene.add(group);

    const wallMat=new THREE.MeshStandardMaterial({color:0xe8e2d8,roughness:.72});
    const columnMat=new THREE.MeshStandardMaterial({color:0xb7bcc5,roughness:.65});
    const doorMat=new THREE.MeshStandardMaterial({color:0x8f6748,roughness:.65});
    const windowMat=new THREE.MeshPhysicalMaterial({color:0x8dbbd0,roughness:.12,transmission:.55,transparent:true,opacity:.72});

    const addSegment=(a:{x:number;y:number},b:{x:number;y:number},height:number,thickness:number,mat:THREE.Material,y=0)=>{
      const dx=b.x-a.x, dz=b.y-a.y;
      const len=Math.hypot(dx,dz);
      if(!Number.isFinite(len)||len<1e-6) return;
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(len,height,thickness),mat);
      mesh.position.set((a.x+b.x)/2,y+height/2,(a.y+b.y)/2);
      mesh.rotation.y=-Math.atan2(dz,dx);
      mesh.castShadow=true; mesh.receiveShadow=true;
      group.add(mesh);
    };

    for(const e of analysis.entities){
      const vs=e.vertices||[];
      if(e.kind==="wall" && vs.length>=2){
        for(let i=0;i<vs.length-1;i++) addSegment(vs[i],vs[i+1],floorHeight,wallThickness,wallMat);
      } else if(e.kind==="column"){
        if(e.center && e.radius){
          const m=new THREE.Mesh(new THREE.CylinderGeometry(e.radius,e.radius,floorHeight,24),columnMat);
          m.position.set(e.center.x,floorHeight/2,e.center.y); group.add(m);
        } else if(vs.length>=2){
          for(let i=0;i<vs.length-1;i++) addSegment(vs[i],vs[i+1],floorHeight,wallThickness*1.8,columnMat);
        }
      } else if((e.kind==="door"||e.kind==="window") && vs.length>=2){
        const mat=e.kind==="door"?doorMat:windowMat;
        const h=e.kind==="door"?Math.min(2.2,floorHeight*.75):Math.min(1.5,floorHeight*.5);
        const y=e.kind==="door"?0:Math.min(.9,floorHeight*.28);
        for(let i=0;i<vs.length-1;i++) addSegment(vs[i],vs[i+1],h,wallThickness*.7,mat,y);
      }
    }

    const box=new THREE.Box3().setFromObject(group);
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

    return ()=>{cancelAnimationFrame(raf);ro.disconnect();controls.dispose();renderer.dispose();host.innerHTML="";};
  },[analysis,floorHeight,wallThickness]);

  return <div ref={ref} style={{width:"100%",height:560,border:"1px solid #cbd5e1",borderRadius:12,overflow:"hidden"}}/>;
}
