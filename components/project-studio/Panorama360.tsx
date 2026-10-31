"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export default function Panorama360({imageUrl}:{imageUrl:string|null}){
  const hostRef=useRef<HTMLDivElement|null>(null);

  useEffect(()=>{
    const host=hostRef.current;
    if(!host||!imageUrl) return;

    const scene=new THREE.Scene();
    const camera=new THREE.PerspectiveCamera(72,1,0.1,1100);
    camera.position.set(0,0,.1);

    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    host.appendChild(renderer.domElement);

    const sphere=new THREE.Mesh(
      new THREE.SphereGeometry(40,64,40),
      new THREE.MeshBasicMaterial({
        map:new THREE.TextureLoader().load(imageUrl),
        side:THREE.BackSide
      })
    );
    scene.add(sphere);

    const controls=new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true;
    controls.enableZoom=true;
    controls.enablePan=false;
    controls.rotateSpeed=-.25;
    controls.minDistance=.1;
    controls.maxDistance=5;

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
      controls.dispose();
      sphere.geometry.dispose();
      const mat=sphere.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
      renderer.dispose();
      host.innerHTML="";
    };
  },[imageUrl]);

  if(!imageUrl){
    return <div style={{height:620,display:"grid",placeItems:"center",textAlign:"center",padding:24,color:"#9fb2c5"}}>
      <div>
        <div style={{fontSize:54,marginBottom:10}}>360°</div>
        <b>2:1 equirectangular panorama yükleyin</b>
        <div style={{fontSize:12,marginTop:7}}>JPG/PNG panorama yüklendiğinde oda içinde serbestçe dönebilirsiniz.</div>
      </div>
    </div>;
  }
  return <div ref={hostRef} style={{width:"100%",height:620,cursor:"grab"}}/>;
}
