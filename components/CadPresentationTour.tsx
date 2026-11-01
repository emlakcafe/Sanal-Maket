"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import * as THREE from "three";
import {GLTFLoader} from "three/examples/jsm/loaders/GLTFLoader.js";

type Room={id:number;area:number;x:number;y:number};

export default function CadPresentationTour({
  base64,
  rooms=[]
}:{base64:string;rooms?:Room[]}){
  const hostRef=useRef<HTMLDivElement|null>(null);
  const jumpRef=useRef<(room:Room)=>void>(()=>{});
  const [status,setStatus]=useState("Sunum hazırlanıyor...");
  const [activeRoom,setActiveRoom]=useState<number|null>(null);
  const ordered=useMemo(()=>[...rooms].sort((a,b)=>b.area-a.area),[rooms]);

  useEffect(()=>{
    const host=hostRef.current;
    if(!host||!base64) return;

    const scene=new THREE.Scene();
    scene.background=new THREE.Color(0xf1f5f9);

    const camera=new THREE.PerspectiveCamera(68,1,.03,500);
    camera.rotation.order="YXZ";

    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.05;
    renderer.shadowMap.enabled=true;
    renderer.domElement.tabIndex=0;
    renderer.domElement.style.outline="none";
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff,0x64748b,1.8));
    const sun=new THREE.DirectionalLight(0xffffff,2.4);
    sun.position.set(8,14,6);
    sun.castShadow=true;
    scene.add(sun);

    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    const blob=new Blob([bytes],{type:"model/gltf-binary"});
    const url=URL.createObjectURL(blob);

    let disposed=false;
    let model:THREE.Object3D|null=null;
    const obstacles:THREE.Box3[]=[];
    const floorY=0.03;
    const eyeHeight=1.65;
    let yaw=0;
    let pitch=-0.08;
    let dragging=false;
    let lastX=0,lastY=0;
    const held=new Set<string>();

    function setCameraRotation(){
      camera.rotation.set(pitch,yaw,0);
    }

    function roomPosition(room:Room){
      // Builder is Z-up. Preview rotates model -90deg around X => CAD y becomes -Three z.
      return new THREE.Vector3(room.x,eyeHeight,-room.y);
    }

    function canStand(p:THREE.Vector3){
      const probe=new THREE.Vector3(p.x,eyeHeight*.55,p.z);
      for(const box of obstacles){
        const expanded=box.clone().expandByScalar(.16);
        if(expanded.containsPoint(probe)) return false;
      }
      return true;
    }

    function jump(room:Room){
      const target=roomPosition(room);
      camera.position.copy(target);
      yaw=0;
      pitch=-0.08;
      setCameraRotation();
      setActiveRoom(room.id);
      renderer.domElement.focus({preventScroll:true});
    }
    jumpRef.current=jump;

    new GLTFLoader().load(url,gltf=>{
      if(disposed) return;
      model=gltf.scene;
      model.rotation.x=-Math.PI/2;
      scene.add(model);
      model.updateMatrixWorld(true);

      model.traverse(obj=>{
        const mesh=obj as THREE.Mesh;
        if(!mesh.isMesh) return;
        mesh.castShadow=true;
        mesh.receiveShadow=true;
        const n=(mesh.name||"").toLowerCase();
        if(!n.includes("room_")&&!n.includes("glass_")){
          const box=new THREE.Box3().setFromObject(mesh);
          if(!box.isEmpty() && box.max.y-box.min.y>.35) obstacles.push(box);
        }
      });

      const box=new THREE.Box3().setFromObject(model);
      if(ordered.length){
        jump(ordered[0]);
      }else if(!box.isEmpty()){
        const center=box.getCenter(new THREE.Vector3());
        camera.position.set(center.x,eyeHeight,center.z);
        if(!canStand(camera.position)){
          camera.position.set(box.min.x+1,eyeHeight,box.min.z+1);
        }
      }
      setStatus("Hazır · mouse ile bak · W A S D ile yürü");
    },undefined,err=>{
      setStatus("Sunum modeli açılamadı: "+String((err as any)?.message||err));
    });

    const down=(e:PointerEvent)=>{
      dragging=true;lastX=e.clientX;lastY=e.clientY;
      renderer.domElement.focus({preventScroll:true});
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const move=(e:PointerEvent)=>{
      if(!dragging) return;
      yaw-=(e.clientX-lastX)*.003;
      pitch=THREE.MathUtils.clamp(pitch-(e.clientY-lastY)*.0022,-1.15,1.15);
      lastX=e.clientX;lastY=e.clientY;
      setCameraRotation();
    };
    const up=(e:PointerEvent)=>{
      dragging=false;
      try{renderer.domElement.releasePointerCapture(e.pointerId)}catch{}
    };
    const keyDown=(e:KeyboardEvent)=>{
      const k=e.key.toLowerCase();
      if(["w","a","s","d"].includes(k)){e.preventDefault();held.add(k);}
    };
    const keyUp=(e:KeyboardEvent)=>held.delete(e.key.toLowerCase());
    const blur=()=>held.clear();

    renderer.domElement.addEventListener("pointerdown",down);
    renderer.domElement.addEventListener("pointermove",move);
    renderer.domElement.addEventListener("pointerup",up);
    renderer.domElement.addEventListener("pointercancel",up);
    renderer.domElement.addEventListener("keydown",keyDown);
    renderer.domElement.addEventListener("keyup",keyUp);
    renderer.domElement.addEventListener("blur",blur);

    const resize=()=>{
      const w=host.clientWidth||900;
      const h=Math.max(560,host.clientHeight||620);
      renderer.setSize(w,h,true);
      camera.aspect=w/h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro=new ResizeObserver(resize);ro.observe(host);

    let raf=0,last=performance.now();
    const loop=(now:number)=>{
      const dt=Math.min((now-last)/1000,.06);last=now;
      const forward=Number(held.has("w"))-Number(held.has("s"));
      const side=Number(held.has("d"))-Number(held.has("a"));
      if(forward||side){
        const len=Math.hypot(forward,side)||1;
        const speed=2.2*dt/len;
        const dx=(-Math.sin(yaw)*forward+Math.cos(yaw)*side)*speed;
        const dz=(-Math.cos(yaw)*forward-Math.sin(yaw)*side)*speed;
        const candidate=camera.position.clone();
        candidate.x+=dx;
        if(canStand(candidate)) camera.position.x=candidate.x;
        candidate.copy(camera.position);
        candidate.z+=dz;
        if(canStand(candidate)) camera.position.z=candidate.z;
        camera.position.y=eyeHeight+floorY;
      }
      renderer.render(scene,camera);
      raf=requestAnimationFrame(loop);
    };
    raf=requestAnimationFrame(loop);

    return()=>{
      disposed=true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown",down);
      renderer.domElement.removeEventListener("pointermove",move);
      renderer.domElement.removeEventListener("pointerup",up);
      renderer.domElement.removeEventListener("pointercancel",up);
      renderer.domElement.removeEventListener("keydown",keyDown);
      renderer.domElement.removeEventListener("keyup",keyUp);
      renderer.domElement.removeEventListener("blur",blur);
      renderer.dispose();
      URL.revokeObjectURL(url);
      host.innerHTML="";
    };
  },[base64,ordered]);

  return <div style={{border:"1px solid #b8cce6",borderRadius:12,overflow:"hidden",background:"#fff"}}>
    <div style={{padding:"9px 10px",borderBottom:"1px solid #d7e2ef",background:"#f8fbff",display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}>
      <div style={{fontSize:11}}><b>Daire İçi Sunum</b> · {status}</div>
      <div style={{fontSize:10,color:"#58718e"}}>Göz hizası 1,65 m · Mouse bakış · W/A/S/D yürüyüş</div>
    </div>
    {ordered.length>0&&<div style={{display:"flex",gap:6,flexWrap:"wrap",padding:8,borderBottom:"1px solid #e1e9f2",background:"#fbfdff"}}>
      {ordered.slice(0,40).map(room=><button key={room.id} type="button" onClick={()=>jumpRef.current(room)} style={{
        padding:"6px 8px",border:"1px solid #bfd0e2",borderRadius:7,
        background:activeRoom===room.id?"#176be0":"#fff",color:activeRoom===room.id?"#fff":"#355d82",
        fontSize:10,fontWeight:800,cursor:"pointer"
      }}>Oda {room.id} · {room.area.toFixed(2)} m²</button>)}
    </div>}
    <div ref={hostRef} style={{width:"100%",height:640,cursor:"grab"}}/>
  </div>;
}
