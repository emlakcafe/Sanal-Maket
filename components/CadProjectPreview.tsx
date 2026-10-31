"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type ProjectGlbPart = {
  name:string;
  base64:string;
  elevation:number;
};

export default function CadProjectPreview({parts}:{parts:ProjectGlbPart[]}){
  const hostRef=useRef<HTMLDivElement|null>(null);
  const [status,setStatus]=useState("Proje birleştiriliyor...");

  useEffect(()=>{
    const host=hostRef.current;
    if(!host||!parts.length) return;

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

    scene.add(new THREE.HemisphereLight(0xffffff,0x6d7881,2.0));
    const sun=new THREE.DirectionalLight(0xffffff,2.8);
    sun.position.set(14,22,12);
    sun.castShadow=true;
    scene.add(sun);

    const controls=new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true;
    controls.enablePan=true;
    controls.enableZoom=true;

    const loader=new GLTFLoader();
    const urls:string[]=[];
    const group=new THREE.Group();
    scene.add(group);

    let cancelled=false;
    const jobs=parts.map(part=>new Promise<void>((resolve,reject)=>{
      const bytes=Uint8Array.from(atob(part.base64),ch=>ch.charCodeAt(0));
      const blob=new Blob([bytes],{type:"model/gltf-binary"});
      const url=URL.createObjectURL(blob);
      urls.push(url);

      loader.load(url,gltf=>{
        if(cancelled){resolve();return;}
        const model=gltf.scene;
        model.rotation.x=-Math.PI/2;
        model.position.y=part.elevation;
        model.name=part.name;
        model.traverse(obj=>{
          const mesh=obj as THREE.Mesh;
          if(mesh.isMesh){
            mesh.castShadow=true;
            mesh.receiveShadow=true;
          }
        });
        group.add(model);
        resolve();
      },undefined,reject);
    }));

    Promise.all(jobs).then(()=>{
      if(cancelled) return;
      const box=new THREE.Box3().setFromObject(group);
      if(!box.isEmpty()){
        const center=box.getCenter(new THREE.Vector3());
        const size=box.getSize(new THREE.Vector3());
        const radius=Math.max(size.x,size.y,size.z,8);
        controls.target.copy(center);
        camera.position.copy(center.clone().add(new THREE.Vector3(radius*.85,radius*.8,radius*1.05)));
        camera.near=Math.max(.01,radius/5000);
        camera.far=radius*100;
        camera.updateProjectionMatrix();
        controls.update();

        const grid=new THREE.GridHelper(radius*2.6,50,0x8795a5,0xcbd5e1);
        grid.position.y=box.min.y;
        scene.add(grid);
      }
      setStatus("Proje hazır · "+parts.length+" parça birleştirildi");
    }).catch(err=>{
      setStatus("Proje birleştirme hatası: "+String((err as any)?.message||err));
    });

    const resize=()=>{
      const w=host.clientWidth||800;
      const h=Math.max(560,host.clientHeight||660);
      renderer.setSize(w,h,true);
      camera.aspect=w/h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro=new ResizeObserver(resize);
    ro.observe(host);

    let raf=0;
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
      urls.forEach(u=>URL.revokeObjectURL(u));
      host.innerHTML="";
    };
  },[parts]);

  return <div style={{border:"1px solid #8eb7e6",borderRadius:12,overflow:"hidden",background:"#fff"}}>
    <div style={{padding:"10px 12px",borderBottom:"1px solid #d7e2ef",background:"#edf6ff",fontSize:12}}>
      <b>Birleştirilmiş Proje Önizleme</b> · {status}
    </div>
    <div ref={hostRef} style={{width:"100%",height:660,cursor:"grab"}}/>
  </div>;
}
