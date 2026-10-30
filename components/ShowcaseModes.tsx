"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type UnitType = "1+1" | "2+1" | "3+1";

function setupRenderer(mount: HTMLDivElement, background = 0xe7eef5) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  mount.appendChild(renderer.domElement);
  return { scene, renderer };
}

function bindResize(mount: HTMLDivElement, renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
  const resize = () => {
    const w = mount.clientWidth;
    const h = Math.max(420, mount.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(mount);
  return ro;
}

export function FloorPlan3D({ type }: { type: UnitType }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = ref.current;
    if (!mount) return;
    const { scene, renderer } = setupRenderer(mount, 0xf2f0eb);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(8, 10, 10);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.5, 0);
    controls.maxPolarAngle = Math.PI / 2.02;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8b887f, 2.3));
    const sun = new THREE.DirectionalLight(0xffffff, 2.8);
    sun.position.set(8, 14, 9);
    sun.castShadow = true;
    scene.add(sun);

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(type === "1+1" ? 7 : type === "2+1" ? 9 : 11, 0.18, 7.5),
      new THREE.MeshStandardMaterial({ color: 0xd7c2a7, roughness: 0.9 })
    );
    floor.receiveShadow = true;
    scene.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 0.85 });
    const furnitureMat = new THREE.MeshStandardMaterial({ color: 0x9a8069, roughness: 0.82 });
    const sofaMat = new THREE.MeshStandardMaterial({ color: 0x697d8d, roughness: 0.8 });
    const bedMat = new THREE.MeshStandardMaterial({ color: 0xe4ddd3, roughness: 0.9 });

    const W = type === "1+1" ? 7 : type === "2+1" ? 9 : 11;
    const D = 7.5;
    const wallH = 1.2;
    const wallT = 0.14;

    const addWall = (w:number,d:number,x:number,z:number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
      m.position.set(x, wallH/2, z);
      m.castShadow = true;
      scene.add(m);
    };

    addWall(W, wallT, 0, -D/2);
    addWall(W, wallT, 0, D/2);
    addWall(wallT, D, -W/2, 0);
    addWall(wallT, D, W/2, 0);

    const rooms = type === "1+1"
      ? [{x:0,z:0,w:0.14,d:D-0.5}]
      : type === "2+1"
        ? [{x:-1.1,z:0,w:0.14,d:D-0.5},{x:2.1,z:1.2,w:3.1,d:0.14}]
        : [{x:-2.2,z:0,w:0.14,d:D-0.5},{x:1.1,z:0,w:0.14,d:D-0.5},{x:3.2,z:1.3,w:2.5,d:0.14}];

    for (const r of rooms) addWall(r.w,r.d,r.x,r.z);

    const sofa = new THREE.Mesh(new THREE.BoxGeometry(2.1,0.55,0.9),sofaMat);
    sofa.position.set(-W/2+1.5,0.36,-D/2+1.3);
    sofa.castShadow = true;
    scene.add(sofa);

    const table = new THREE.Mesh(new THREE.BoxGeometry(1.2,0.45,0.8),furnitureMat);
    table.position.set(-W/2+2.0,0.28,-0.6);
    scene.add(table);

    const bedCount = type === "1+1" ? 1 : type === "2+1" ? 2 : 3;
    for (let i=0;i<bedCount;i++) {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(1.6,0.42,2.0),bedMat);
      const x = W/2 - 1.4 - (i%2)*2.5;
      const z = D/2 - 1.5 - Math.floor(i/2)*2.4;
      bed.position.set(x,0.25,z);
      bed.castShadow = true;
      scene.add(bed);
    }

    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 512; labelCanvas.height = 128;
    const ctx = labelCanvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0,0,512,128);
    ctx.fillStyle = "#123a70"; ctx.font = "bold 52px Arial"; ctx.textAlign = "center";
    ctx.fillText(type + " · 3D KAT PLANI",256,82);
    const tex = new THREE.CanvasTexture(labelCanvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:tex}));
    sprite.scale.set(4.8,1.2,1);
    sprite.position.set(0,2.2,-D/2+0.2);
    scene.add(sprite);

    const ro = bindResize(mount, renderer, camera);
    let frame=0;
    const loop=()=>{controls.update(); renderer.render(scene,camera); frame=requestAnimationFrame(loop);};
    loop();
    return ()=>{cancelAnimationFrame(frame);ro.disconnect();controls.dispose();renderer.dispose();mount.innerHTML="";};
  }, [type]);

  return <div style={{width:"100%",height:"100%"}} ref={ref} />;
}

export function Interior360({ unitId, type }: { unitId:string; type:UnitType }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = ref.current;
    if (!mount) return;
    const { scene, renderer } = setupRenderer(mount, 0xded9d0);
    const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
    camera.position.set(0,1.65,0.1);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.rotateSpeed = -0.45;
    controls.target.set(0,1.65,-1);

    const panoCanvas = document.createElement("canvas");
    panoCanvas.width = 2048; panoCanvas.height = 1024;
    const ctx = panoCanvas.getContext("2d")!;
    const g = ctx.createLinearGradient(0,0,0,1024);
    g.addColorStop(0,"#b9d3e3"); g.addColorStop(.48,"#ece7df"); g.addColorStop(.5,"#d3c0a8"); g.addColorStop(1,"#b89c7b");
    ctx.fillStyle=g; ctx.fillRect(0,0,2048,1024);
    ctx.fillStyle="#8db4c6";
    for(let x=140;x<2000;x+=360){ctx.fillRect(x,220,240,250);ctx.strokeStyle="#ffffff";ctx.lineWidth=14;ctx.strokeRect(x,220,240,250);}
    ctx.fillStyle="#f4f0ea"; ctx.fillRect(0,480,2048,160);
    ctx.fillStyle="#4f6072"; ctx.font="bold 56px Arial"; ctx.fillText(unitId+" · "+type+" DAİRE İÇİ 360°",70,590);
    ctx.fillStyle="#6c5848"; ctx.fillRect(320,680,360,120); ctx.fillRect(1120,700,440,100);
    ctx.fillStyle="#eee6da"; ctx.fillRect(1250,510,260,180);

    const texture = new THREE.CanvasTexture(panoCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(20,64,40),
      new THREE.MeshBasicMaterial({map:texture,side:THREE.BackSide})
    );
    scene.add(sphere);

    const ro = bindResize(mount, renderer, camera);
    let frame=0;
    const loop=()=>{controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(loop);};
    loop();
    return ()=>{cancelAnimationFrame(frame);ro.disconnect();controls.dispose();renderer.dispose();mount.innerHTML="";};
  }, [unitId,type]);

  return <div style={{width:"100%",height:"100%",cursor:"grab"}} ref={ref} />;
}

export function RenderPresentation({ unitId, type }: { unitId:string; type:UnitType }) {
  return (
    <div style={{
      width:"100%",height:"100%",display:"grid",placeItems:"center",
      background:"radial-gradient(circle at 50% 30%,#f8fbff 0,#dbe6ed 58%,#bccbd5 100%)",
      color:"#143c6d"
    }}>
      <div style={{textAlign:"center",maxWidth:700,padding:32}}>
        <div style={{fontSize:12,letterSpacing:".2em",opacity:.6}}>MİMARİ SUNUM</div>
        <div style={{fontSize:52,fontWeight:800,margin:"12px 0"}}>{unitId}</div>
        <div style={{fontSize:22,marginBottom:18}}>{type} · Emlak Cafe Residence</div>
        <div style={{height:260,borderRadius:22,background:"linear-gradient(145deg,#e8dfd2,#a9c5d3)",boxShadow:"0 28px 70px rgba(39,72,108,.18)",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",left:"12%",right:"12%",bottom:0,height:"72%",background:"#e9e1d5",borderRadius:"18px 18px 0 0"}}/>
          <div style={{position:"absolute",left:"20%",right:"20%",bottom:"18%",height:"38%",background:"repeating-linear-gradient(90deg,#8fb4c3 0 13%,#f2eee6 13% 17%)"}}/>
        </div>
        <div style={{marginTop:18,fontSize:13,opacity:.65}}>Gerçek proje renderları yüklendiğinde bu alan otomatik olarak onların galerisine dönüşecek.</div>
      </div>
    </div>
  );
}
