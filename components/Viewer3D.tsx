"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import type { ExtractedPolygon, FloorplanExtraction, Point2D } from "@/lib/geometry/types";
import type { ProjectSettingsValue } from "@/components/ProjectSettings";

type ViewPreset = "iso" | "top" | "front" | "right";
type RenderMode = "presentation" | "technical";
type LayerState = { walls: boolean; doors: boolean; windows: boolean; floor: boolean; roof: boolean; grid: boolean };
type RoomMetric = { id: number; area: number };

function worldPoint([px, py]: Point2D, cx: number, cy: number, scale: number) {
  return new THREE.Vector2((px - cx) * scale, (py - cy) * scale);
}

function polygonArea(points: Point2D[], scale: number) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area * 0.5) * scale * scale;
}

function polygonFrame(points: Point2D[], cx: number, cy: number, scale: number) {
  if (!points || points.length < 2) return null;
  const pts = points.map(p => worldPoint(p, cx, cy, scale));
  const mean = pts.reduce((a, p) => a.add(p), new THREE.Vector2()).multiplyScalar(1 / pts.length);
  let xx = 0, zz = 0, xz = 0;
  for (const p of pts) {
    const x = p.x - mean.x, z = p.y - mean.y;
    xx += x * x; zz += z * z; xz += x * z;
  }
  const angle = 0.5 * Math.atan2(2 * xz, xx - zz);
  const c = Math.cos(-angle), s = Math.sin(-angle);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    const dx = p.x - mean.x, dz = p.y - mean.y;
    const rx = dx * c - dz * s, rz = dx * s + dz * c;
    minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
    minZ = Math.min(minZ, rz); maxZ = Math.max(maxZ, rz);
  }
  const spanX = Math.max(maxX - minX, 0.05), spanZ = Math.max(maxZ - minZ, 0.05);
  return {
    x: mean.x, z: mean.y,
    angle: spanX >= spanZ ? angle : angle + Math.PI / 2,
    width: Math.max(spanX, spanZ),
    thickness: Math.min(spanX, spanZ)
  };
}

function addExtrudedPolygon(group: THREE.Group, polygon: ExtractedPolygon, cx: number, cy: number, scale: number, height: number, baseY: number, material: THREE.Material) {
  if (!polygon.outer?.length) return;
  const shape = new THREE.Shape();
  polygon.outer.forEach((point, i) => {
    const p = worldPoint(point, cx, cy, scale);
    if (i === 0) shape.moveTo(p.x, p.y); else shape.lineTo(p.x, p.y);
  });
  shape.closePath();
  for (const holePoints of polygon.holes || []) {
    if (holePoints.length < 3) continue;
    const hole = new THREE.Path();
    holePoints.forEach((point, i) => {
      const p = worldPoint(point, cx, cy, scale);
      if (i === 0) hole.moveTo(p.x, p.y); else hole.lineTo(p.x, p.y);
    });
    hole.closePath();
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = baseY;
  mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
}

function addArchitecturalElement(group: THREE.Group, polygon: ExtractedPolygon, kind: "door" | "window", cx: number, cy: number, scale: number, material: THREE.Material, frameMaterial?: THREE.Material) {
  const frame = polygonFrame(polygon.outer, cx, cy, scale);
  if (!frame) return;
  const isDoor = kind === "door";
  const width = THREE.MathUtils.clamp(frame.width, isDoor ? 0.7 : 0.6, isDoor ? 1.6 : 2.8);
  const thickness = THREE.MathUtils.clamp(frame.thickness, 0.08, 0.16);
  const height = isDoor ? 2.1 : 1.25;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness), material);
  mesh.position.set(frame.x, isDoor ? 1.15 : 1.55, frame.z);
  mesh.rotation.y = -frame.angle;
  mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
  if (!isDoor && frameMaterial) {
    const b = 0.055, d = thickness + 0.02;
    for (const [w,h,x,y] of [[width+b*2,b,0,height/2+b/2],[width+b*2,b,0,-height/2-b/2],[b,height,width/2+b/2,0],[b,height,-width/2-b/2,0]] as number[][]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), frameMaterial);
      f.position.set(x,y,0); mesh.add(f);
    }
  }
}

function addRoof(group: THREE.Group, box: THREE.Box3, settings: ProjectSettingsValue, material: THREE.Material) {
  if (settings.roofType === "none") return;
  const size = new THREE.Vector3(); const center = new THREE.Vector3();
  box.getSize(size); box.getCenter(center);
  const eave = settings.floorHeight + 0.12;
  const rise = Math.tan(THREE.MathUtils.degToRad(settings.roofPitch)) * (Math.min(size.x, size.z) / 2);

  if (settings.roofType === "hip") {
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4), material);
    roof.scale.set(size.x * 0.72, Math.max(rise, .35), size.z * 0.72);
    roof.rotation.y = Math.PI / 4;
    roof.position.set(center.x, eave + rise / 2, center.z);
    roof.castShadow = true; group.add(roof);
    return;
  }

  const alongX = size.x >= size.z;
  const halfW = (alongX ? size.z : size.x) / 2 + 0.25;
  const halfL = (alongX ? size.x : size.z) / 2 + 0.25;
  const vertices = new Float32Array([
    -halfL,0,-halfW,  halfL,0,-halfW,  -halfL,0,halfW,  halfL,0,halfW,
    -halfL,rise,0,    halfL,rise,0
  ]);
  const indices = [0,1,4,1,5,4, 2,4,3,3,4,5, 0,4,2,2,4,4, 1,3,5,3,2,5];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(vertices,3));
  g.setIndex(indices); g.computeVertexNormals();
  const roof = new THREE.Mesh(g, material);
  if (!alongX) roof.rotation.y = Math.PI/2;
  roof.position.set(center.x, eave, center.z);
  roof.castShadow = true; group.add(roof);
}

export default function Viewer3D({
  data, settings, onRoomMetrics
}: {
  data: FloorplanExtraction | null;
  settings: ProjectSettingsValue;
  onRoomMetrics?: (rooms: RoomMetric[]) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{scene:THREE.Scene;renderer:THREE.WebGLRenderer;camera:THREE.PerspectiveCamera;orbit:OrbitControls;walk:PointerLockControls;groups:Record<string,THREE.Group>;grid:THREE.GridHelper;center:THREE.Vector3;radius:number}|null>(null);
  const keys = useRef<Record<string,boolean>>({});
  const [layers,setLayers] = useState<LayerState>({walls:true,doors:true,windows:true,floor:true,roof:true,grid:false});
  const [preset,setPreset] = useState<ViewPreset>("iso");
  const [renderMode,setRenderMode] = useState<RenderMode>("presentation");
  const [walkMode,setWalkMode] = useState(false);
  const [sectionMode,setSectionMode] = useState(false);
  const [fullscreen,setFullscreen] = useState(false);

  const counts = useMemo(()=>({walls:data?.polygons.wall?.length??0,doors:data?.polygons.door?.length??0,windows:data?.polygons.window?.length??0}),[data]);

  useEffect(()=>{
    if (!host.current) return;
    const el=host.current, presentation=renderMode==="presentation";
    const scene=new THREE.Scene();
    scene.background=new THREE.Color(presentation?0xdce6ed:0x0b1220);
    const camera=new THREE.PerspectiveCamera(walkMode?68:(presentation?36:45),el.clientWidth/el.clientHeight,.05,300);
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setSize(el.clientWidth,el.clientHeight);
    renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap; renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=presentation?1.1:1;
    el.appendChild(renderer.domElement);

    const orbit=new OrbitControls(camera,renderer.domElement); orbit.enableDamping=true; orbit.screenSpacePanning=true; orbit.maxPolarAngle=Math.PI*.495;
    const walk=new PointerLockControls(camera,renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff,presentation?0x97a7b0:0x203047,presentation?2.6:2.2));
    const sun=new THREE.DirectionalLight(0xfff1da,presentation?3.2:2.3); sun.position.set(10,16,9); sun.castShadow=true; sun.shadow.mapSize.set(2048,2048); scene.add(sun);
    const fill=new THREE.DirectionalLight(0xa6cfff,.8); fill.position.set(-8,8,-6); scene.add(fill);

    const grid=new THREE.GridHelper(30,60,presentation?0xaebbc4:0x37506e,presentation?0xcad3da:0x1c2a3c); scene.add(grid);
    const groups={floor:new THREE.Group(),walls:new THREE.Group(),doors:new THREE.Group(),windows:new THREE.Group(),roof:new THREE.Group()};
    Object.values(groups).forEach(g=>scene.add(g));

    let center=new THREE.Vector3(0,1,0), radius=5;
    if(data){
      const [cw,ch]=data.canvas_size; const rect=data.content_rect||[0,0,cw,ch]; const [rx,ry,rw,rh]=rect;
      const cx=rx+rw/2, cy=ry+rh/2, scale=settings.longSideMeters/Math.max(rw,rh);
      const wallMat=new THREE.MeshStandardMaterial({color:presentation?0xf4f0e8:0xe8edf3,roughness:.62,side:THREE.DoubleSide});
      const floorMat=new THREE.MeshStandardMaterial({color:presentation?0xcdbda4:0x687689,roughness:.78});
      const doorMat=new THREE.MeshStandardMaterial({color:0x805236,roughness:.48});
      const glassMat=new THREE.MeshPhysicalMaterial({color:0xa8d8ea,roughness:.08,transmission:.55,transparent:true,opacity:.5});
      const frameMat=new THREE.MeshStandardMaterial({color:0x303a42,metalness:.45,roughness:.35});
      const roofMat=new THREE.MeshStandardMaterial({color:presentation?0x574d47:0x39424b,roughness:.72,side:THREE.DoubleSide});

      if(data.polygons.floor?.length){
        for(const p of data.polygons.floor) addExtrudedPolygon(groups.floor,p,cx,cy,scale,.06,.04,floorMat);
      } else {
        const slab=new THREE.Mesh(new THREE.BoxGeometry(rw*scale+.2,.1,rh*scale+.2),floorMat); slab.position.y=.05; groups.floor.add(slab);
      }
      for(const p of data.polygons.wall||[]) addExtrudedPolygon(groups.walls,p,cx,cy,scale,sectionMode?1.5:settings.floorHeight,.1,wallMat);
      for(const p of data.polygons.door||[]) addArchitecturalElement(groups.doors,p,"door",cx,cy,scale,doorMat);
      for(const p of data.polygons.window||[]) addArchitecturalElement(groups.windows,p,"window",cx,cy,scale,glassMat,frameMat);

      const buildingBox=new THREE.Box3().setFromObject(groups.walls);
      addRoof(groups.roof,buildingBox,settings,roofMat);
      const allBox=new THREE.Box3(); Object.values(groups).forEach(g=>allBox.expandByObject(g));
      const size=new THREE.Vector3(); allBox.getCenter(center); allBox.getSize(size); radius=Math.max(size.length()*.5,4);

      const roomMetrics=(data.polygons.floor||[]).map((p,i)=>({id:i+1,area:polygonArea(p.outer,scale)})).filter(r=>r.area>1).sort((a,b)=>b.area-a.area);
      onRoomMetrics?.(roomMetrics);
    }

    const setView=(p:ViewPreset)=>{
      const d=Math.max(radius*2,7);
      if(p==="top") camera.position.set(center.x,center.y+d*1.45,center.z+.001);
      else if(p==="front") camera.position.set(center.x,center.y+d*.3,center.z+d);
      else if(p==="right") camera.position.set(center.x+d,center.y+d*.3,center.z);
      else camera.position.set(center.x+d*.82,center.y+d*.7,center.z+d*.92);
      orbit.target.copy(center); orbit.update();
    };
    setView(preset);
    if(walkMode){ camera.position.set(center.x,settings.eyeHeight,center.z); orbit.enabled=false; } else orbit.enabled=true;

    sceneRef.current={scene,renderer,camera,orbit,walk,groups,grid,center,radius};
    const down=(e:KeyboardEvent)=>keys.current[e.code]=true, up=(e:KeyboardEvent)=>keys.current[e.code]=false;
    window.addEventListener("keydown",down); window.addEventListener("keyup",up);
    const resize=()=>{camera.aspect=el.clientWidth/el.clientHeight;camera.updateProjectionMatrix();renderer.setSize(el.clientWidth,el.clientHeight)};
    const ro=new ResizeObserver(resize); ro.observe(el);
    const clock=new THREE.Clock(); let frame=0;
    const animate=()=>{
      frame=requestAnimationFrame(animate); const dt=Math.min(clock.getDelta(),.05);
      if(walkMode && walk.isLocked){
        const speed=3.2*dt; if(keys.current.KeyW) walk.moveForward(speed); if(keys.current.KeyS) walk.moveForward(-speed); if(keys.current.KeyA) walk.moveRight(-speed); if(keys.current.KeyD) walk.moveRight(speed);
        camera.position.y=settings.eyeHeight;
      } else orbit.update();
      renderer.render(scene,camera);
    }; animate();

    return()=>{cancelAnimationFrame(frame);ro.disconnect();window.removeEventListener("keydown",down);window.removeEventListener("keyup",up);orbit.dispose();walk.dispose();renderer.dispose();scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose())}});if(renderer.domElement.parentNode===el)el.removeChild(renderer.domElement);sceneRef.current=null};
  },[data,settings,renderMode,sectionMode,walkMode]);

  useEffect(()=>{const s=sceneRef.current;if(!s)return;s.groups.walls.visible=layers.walls;s.groups.doors.visible=layers.doors;s.groups.windows.visible=layers.windows;s.groups.floor.visible=layers.floor;s.groups.roof.visible=layers.roof;s.grid.visible=layers.grid},[layers]);

  useEffect(()=>{const s=sceneRef.current;if(!s||walkMode)return;const d=Math.max(s.radius*2,7);const c=s.center,cam=s.camera;if(preset==="top")cam.position.set(c.x,c.y+d*1.45,c.z+.001);else if(preset==="front")cam.position.set(c.x,c.y+d*.3,c.z+d);else if(preset==="right")cam.position.set(c.x+d,c.y+d*.3,c.z);else cam.position.set(c.x+d*.82,c.y+d*.7,c.z+d*.92);s.orbit.target.copy(c);s.orbit.update()},[preset,walkMode]);

  async function toggleFullscreen(){const panel=host.current?.closest(".viewerPanel");if(!(panel instanceof HTMLElement))return;if(!document.fullscreenElement)await panel.requestFullscreen();else await document.exitFullscreen()}
  function capture(){const s=sceneRef.current;if(!s)return;s.renderer.render(s.scene,s.camera);const a=document.createElement("a");a.href=s.renderer.domElement.toDataURL("image/png");a.download="emlak-cafe-proje.png";a.click()}
  function startWalk(){setWalkMode(true);setTimeout(()=>sceneRef.current?.walk.lock(),60)}
  function stopWalk(){sceneRef.current?.walk.unlock();setWalkMode(false)}

  return <div className="viewerWorkspace">
    <div className="viewerToolbar">
      <div className="toolbarGroup"><button className={renderMode==="presentation"?"viewerTool active":"viewerTool"} onClick={()=>setRenderMode("presentation")}>Mimari Sunum</button><button className={renderMode==="technical"?"viewerTool active":"viewerTool"} onClick={()=>setRenderMode("technical")}>Teknik</button></div>
      <div className="toolbarGroup"><button className={preset==="iso"?"viewerTool active":"viewerTool"} onClick={()=>setPreset("iso")}>İzometrik</button><button className={preset==="top"?"viewerTool active":"viewerTool"} onClick={()=>setPreset("top")}>Üst</button><button className={preset==="front"?"viewerTool active":"viewerTool"} onClick={()=>setPreset("front")}>Ön</button><button className={preset==="right"?"viewerTool active":"viewerTool"} onClick={()=>setPreset("right")}>Sağ</button></div>
      <div className="toolbarGroup">{walkMode?<button className="viewerTool active" onClick={stopWalk}>Yürüyüşten Çık</button>:<button className="viewerTool walkButton" onClick={startWalk}>Evin İçinde Gez</button>}<button className={sectionMode?"viewerTool active":"viewerTool"} onClick={()=>setSectionMode(v=>!v)}>Dollhouse</button><button className="viewerTool" onClick={capture}>PNG Al</button><button className="viewerTool" onClick={toggleFullscreen}>Tam Ekran</button></div>
    </div>
    <div className="viewerBody">
      <aside className="viewerSidebar">
        <div className="viewerPanelTitle">Mimari Katmanlar</div>
        {(["walls","doors","windows","floor","roof","grid"] as (keyof LayerState)[]).map(k=><label className="viewerToggle" key={k}><input type="checkbox" checked={layers[k]} onChange={()=>setLayers(v=>({...v,[k]:!v[k]}))}/><span>{{walls:"Duvarlar",doors:"Kapılar",windows:"Pencereler",floor:"Zemin",roof:"Çatı",grid:"Izgara"}[k]}</span><b>{k==="walls"?counts.walls:k==="doors"?counts.doors:k==="windows"?counts.windows:"—"}</b></label>)}
        <div className="viewerHelp"><strong>{walkMode?"Yürüyüş modu":"Fare kullanımı"}</strong>{walkMode?<><span>Fare: etrafa bak</span><span>W A S D: yürü</span><span>ESC: imleci bırak</span></>:<><span>Sol tuş: döndür</span><span>Sağ tuş: kaydır</span><span>Tekerlek: yakınlaştır</span></>}</div>
        <div className="viewerMetrics"><strong>Proje ölçüsü</strong><span>Uzun kenar: {settings.longSideMeters.toFixed(1)} m</span><span>Kat yüksekliği: {settings.floorHeight.toFixed(2)} m</span><span>Çatı: {settings.roofType==="gable"?"Beşik":settings.roofType==="hip"?"Kırma":"Yok"}</span></div>
      </aside>
      <div ref={host} className="viewerCanvas"/>
    </div>
  </div>
}
