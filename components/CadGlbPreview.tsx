"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export default function CadGlbPreview({base64}:{base64:string}){
  const hostRef=useRef<HTMLDivElement|null>(null);
  const [status,setStatus]=useState("GLB yükleniyor...");

  useEffect(()=>{
    const host=hostRef.current;
    if(!host||!base64) return;

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

    const hemi=new THREE.HemisphereLight(0xffffff,0x6d7881,2.0);
    scene.add(hemi);
    const sun=new THREE.DirectionalLight(0xffffff,2.8);
    sun.position.set(12,20,10);
    sun.castShadow=true;
    scene.add(sun);

    const controls=new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true;
    controls.enablePan=true;
    controls.enableZoom=true;

    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    const blob=new Blob([bytes],{type:"model/gltf-binary"});
    const url=URL.createObjectURL(blob);

    let model:THREE.Object3D|null=null;
    new GLTFLoader().load(url,gltf=>{
      model=gltf.scene;
      model.traverse(obj=>{
        const mesh=obj as THREE.Mesh;
        if(mesh.isMesh){
          mesh.castShadow=true;
          mesh.receiveShadow=true;
        }
      });

      // Convert builder Z-up to Three.js Y-up.
      model.rotation.x=-Math.PI/2;
      scene.add(model);

      const box=new THREE.Box3().setFromObject(model);
      if(!box.isEmpty()){
        const center=box.getCenter(new THREE.Vector3());
        const size=box.getSize(new THREE.Vector3());
        const radius=Math.max(size.x,size.y,size.z,6);
        controls.target.copy(center);
        camera.position.copy(center.clone().add(new THREE.Vector3(radius*.8,radius*.95,radius*.9)));
        camera.near=Math.max(.01,radius/5000);
        camera.far=radius*100;
        camera.updateProjectionMatrix();
        controls.update();

        const grid=new THREE.GridHelper(radius*2.4,40,0x8795a5,0xcbd5e1);
        grid.position.y=box.min.y;
        scene.add(grid);
      }
      setStatus("GLB hazır · mouse ile döndür / zoom");
    },undefined,err=>{
      setStatus("GLB yüklenemedi: "+String((err as any)?.message||err));
    });

    const resize=()=>{
      const w=host.clientWidth||800;
      const h=Math.max(520,host.clientHeight||620);
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
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      URL.revokeObjectURL(url);
      host.innerHTML="";
    };
  },[base64]);

  return <div style={{border:"1px solid #b8cce6",borderRadius:12,overflow:"hidden",background:"#fff"}}>
    <div style={{padding:"9px 10px",borderBottom:"1px solid #d7e2ef",background:"#f8fbff",fontSize:11}}>
      <b>GLB Önizleme</b> · {status}
    </div>
    <div ref={hostRef} style={{width:"100%",height:620,cursor:"grab"}}/>
  </div>;
}
