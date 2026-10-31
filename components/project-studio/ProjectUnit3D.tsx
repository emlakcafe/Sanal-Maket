"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type StudioUnit = {
  id:string;
  block:string;
  floor:number;
  type:string;
  area:number;
  facade:string;
  status:"available"|"reserved"|"sold";
};

export default function ProjectUnit3D({
  units,
  selectedId,
  onSelect
}:{
  units:StudioUnit[];
  selectedId:string|null;
  onSelect:(unit:StudioUnit)=>void;
}){
  const hostRef=useRef<HTMLDivElement|null>(null);

  useEffect(()=>{
    const host=hostRef.current;
    if(!host) return;

    const scene=new THREE.Scene();
    scene.background=new THREE.Color(0x0b1623);

    const camera=new THREE.PerspectiveCamera(42,1,0.1,1000);
    camera.position.set(18,15,22);

    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.15;
    renderer.shadowMap.enabled=true;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff,0x253547,2.4));
    const sun=new THREE.DirectionalLight(0xffffff,3);
    sun.position.set(10,24,14);
    sun.castShadow=true;
    scene.add(sun);

    const controls=new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true;
    controls.minDistance=8;
    controls.maxDistance=55;
    controls.target.set(0,4,0);

    const ground=new THREE.Mesh(
      new THREE.PlaneGeometry(34,24),
      new THREE.MeshStandardMaterial({color:0x172433,roughness:1})
    );
    ground.rotation.x=-Math.PI/2;
    ground.receiveShadow=true;
    scene.add(ground);

    const grid=new THREE.GridHelper(34,34,0x38516c,0x213246);
    grid.position.y=0.01;
    scene.add(grid);

    const blockPositions:Record<string,[number,number]>={
      A:[-8,-1],
      B:[0,-1],
      C:[8,-1]
    };

    const hitMeshes:THREE.Mesh[]=[];
    const statusColor={
      available:0x2fc878,
      reserved:0xe4ad45,
      sold:0xd4545d
    };

    for(const unit of units){
      const base=blockPositions[unit.block]||[0,0];
      const floorY=(unit.floor-1)*2.05+1.1;
      const index=units.filter(x=>x.block===unit.block&&x.floor===unit.floor).findIndex(x=>x.id===unit.id);
      const count=units.filter(x=>x.block===unit.block&&x.floor===unit.floor).length;
      const z=(index-(count-1)/2)*2.55;

      const geo=new THREE.BoxGeometry(5.5,1.85,2.15);
      const color=unit.id===selectedId?0x6f9cff:statusColor[unit.status];
      const mat=new THREE.MeshStandardMaterial({
        color,
        roughness:.55,
        metalness:.05,
        transparent:unit.status==="sold",
        opacity:unit.status==="sold"?.62:1
      });
      const mesh=new THREE.Mesh(geo,mat);
      mesh.position.set(base[0],floorY,z);
      mesh.castShadow=true;
      mesh.receiveShadow=true;
      mesh.userData.unit=unit;
      hitMeshes.push(mesh);
      scene.add(mesh);

      const edge=new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({color:0xd9e7f5,transparent:true,opacity:.25})
      );
      mesh.add(edge);
    }

    for(const [name,[x,z]] of Object.entries(blockPositions)){
      const canvas=document.createElement("canvas");
      canvas.width=256; canvas.height=96;
      const ctx=canvas.getContext("2d");
      if(ctx){
        ctx.fillStyle="rgba(8,17,29,.85)";
        ctx.fillRect(0,0,256,96);
        ctx.fillStyle="#ffffff";
        ctx.font="bold 42px Arial";
        ctx.textAlign="center";
        ctx.textBaseline="middle";
        ctx.fillText(name+" BLOK",128,48);
      }
      const tex=new THREE.CanvasTexture(canvas);
      const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true}));
      sprite.position.set(x,9.3,z);
      sprite.scale.set(4.2,1.55,1);
      scene.add(sprite);
    }

    const raycaster=new THREE.Raycaster();
    const pointer=new THREE.Vector2();
    const onPointer=(ev:PointerEvent)=>{
      const rect=renderer.domElement.getBoundingClientRect();
      pointer.x=((ev.clientX-rect.left)/rect.width)*2-1;
      pointer.y=-((ev.clientY-rect.top)/rect.height)*2+1;
      raycaster.setFromCamera(pointer,camera);
      const hit=raycaster.intersectObjects(hitMeshes,false)[0];
      if(hit?.object?.userData?.unit) onSelect(hit.object.userData.unit as StudioUnit);
    };
    renderer.domElement.addEventListener("pointerup",onPointer);

    const resize=()=>{
      const w=host.clientWidth||800;
      const h=host.clientHeight||620;
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
      renderer.domElement.removeEventListener("pointerup",onPointer);
      controls.dispose();
      scene.traverse(o=>{
        const m=o as THREE.Mesh;
        if(m.geometry) m.geometry.dispose?.();
        const mat=(m as any).material;
        if(Array.isArray(mat)) mat.forEach(x=>x.dispose?.());
        else mat?.dispose?.();
      });
      renderer.dispose();
      host.innerHTML="";
    };
  },[units,selectedId,onSelect]);

  return <div ref={hostRef} style={{width:"100%",height:620,cursor:"grab"}}/>;
}
