"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ExtractedPolygon, FloorplanExtraction, Point2D } from "@/lib/geometry/types";

type ViewPreset = "iso" | "top" | "front" | "right";
type RenderMode = "presentation" | "technical";

type LayerState = {
  walls: boolean;
  doors: boolean;
  windows: boolean;
  floor: boolean;
  grid: boolean;
};

type SceneRefs = {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  wallGroup: THREE.Group;
  doorGroup: THREE.Group;
  windowGroup: THREE.Group;
  floorGroup: THREE.Group;
  grid: THREE.GridHelper;
  center: THREE.Vector3;
  radius: number;
};

type ElementFrame = {
  x: number;
  z: number;
  angle: number;
  width: number;
  thickness: number;
};

function worldPoint([px, py]: Point2D, cx: number, cy: number, scale: number) {
  return new THREE.Vector2((px - cx) * scale, (py - cy) * scale);
}

function polygonFrame(points: Point2D[], cx: number, cy: number, scale: number): ElementFrame | null {
  if (!points || points.length < 2) return null;
  const pts = points.map(p => worldPoint(p, cx, cy, scale));
  const mean = pts.reduce((a, p) => a.add(p), new THREE.Vector2()).multiplyScalar(1 / pts.length);

  let xx = 0;
  let zz = 0;
  let xz = 0;
  for (const p of pts) {
    const x = p.x - mean.x;
    const z = p.y - mean.y;
    xx += x * x;
    zz += z * z;
    xz += x * z;
  }

  const angle = 0.5 * Math.atan2(2 * xz, xx - zz);
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    const dx = p.x - mean.x;
    const dz = p.y - mean.y;
    const rx = dx * c - dz * s;
    const rz = dx * s + dz * c;
    minX = Math.min(minX, rx);
    maxX = Math.max(maxX, rx);
    minZ = Math.min(minZ, rz);
    maxZ = Math.max(maxZ, rz);
  }

  const spanX = Math.max(maxX - minX, 0.05);
  const spanZ = Math.max(maxZ - minZ, 0.05);
  const width = Math.max(spanX, spanZ);
  const thickness = Math.min(spanX, spanZ);
  const longAngle = spanX >= spanZ ? angle : angle + Math.PI / 2;

  return {
    x: mean.x,
    z: mean.y,
    angle: longAngle,
    width,
    thickness
  };
}

function addExtrudedPolygon(
  group: THREE.Group,
  polygon: ExtractedPolygon,
  options: {
    cx: number;
    cy: number;
    scale: number;
    height: number;
    baseY: number;
    material: THREE.Material;
  }
) {
  if (!polygon.outer || polygon.outer.length < 3) return;

  const shape = new THREE.Shape();
  polygon.outer.forEach((point, index) => {
    const p = worldPoint(point, options.cx, options.cy, options.scale);
    if (index === 0) shape.moveTo(p.x, p.y);
    else shape.lineTo(p.x, p.y);
  });
  shape.closePath();

  for (const holePoints of polygon.holes || []) {
    if (holePoints.length < 3) continue;
    const hole = new THREE.Path();
    holePoints.forEach((point, index) => {
      const p = worldPoint(point, options.cx, options.cy, options.scale);
      if (index === 0) hole.moveTo(p.x, p.y);
      else hole.lineTo(p.x, p.y);
    });
    hole.closePath();
    shape.holes.push(hole);
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: options.height,
    bevelEnabled: false,
    curveSegments: 1
  });
  geometry.rotateX(-Math.PI / 2);

  const mesh = new THREE.Mesh(geometry, options.material);
  mesh.position.y = options.baseY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function makeCanvasTexture(kind: "wood" | "stone") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;

  if (kind === "wood") {
    ctx.fillStyle = "#8c5b3d";
    ctx.fillRect(0, 0, 512, 512);
    for (let x = 0; x < 512; x += 44) {
      ctx.fillStyle = x % 88 === 0 ? "#75472f" : "#98694a";
      ctx.fillRect(x, 0, 2, 512);
    }
    for (let i = 0; i < 180; i++) {
      const y = Math.random() * 512;
      const alpha = 0.04 + Math.random() * 0.05;
      ctx.strokeStyle = `rgba(40,20,10,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(150, y + Math.random() * 12, 350, y - Math.random() * 12, 512, y);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = "#d4c9b8";
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = "rgba(120,105,90,.16)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= 512; i += 96) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === "wood" ? 2 : 3, kind === "wood" ? 1 : 3);
  return texture;
}

function addArchitecturalElement(
  group: THREE.Group,
  polygon: ExtractedPolygon,
  options: {
    kind: "door" | "window";
    cx: number;
    cy: number;
    scale: number;
    material: THREE.Material;
    frameMaterial?: THREE.Material;
  }
) {
  const frame = polygonFrame(polygon.outer, options.cx, options.cy, options.scale);
  if (!frame) return;

  const isDoor = options.kind === "door";
  const width = THREE.MathUtils.clamp(frame.width, isDoor ? 0.65 : 0.55, isDoor ? 1.8 : 2.8);
  const thickness = THREE.MathUtils.clamp(frame.thickness, 0.08, 0.18);
  const height = isDoor ? 2.15 : 1.2;
  const y = isDoor ? 1.195 : 1.55;

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness), options.material);
  mesh.position.set(frame.x, y, frame.z);
  mesh.rotation.y = -frame.angle;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  if (!isDoor && options.frameMaterial) {
    const border = 0.055;
    const frameDepth = thickness + 0.025;
    const frameParts = [
      { w: width + border * 2, h: border, x: 0, y: height / 2 + border / 2 },
      { w: width + border * 2, h: border, x: 0, y: -height / 2 - border / 2 },
      { w: border, h: height, x: width / 2 + border / 2, y: 0 },
      { w: border, h: height, x: -width / 2 - border / 2, y: 0 }
    ];
    for (const part of frameParts) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(part.w, part.h, frameDepth), options.frameMaterial);
      f.position.set(part.x, part.y, 0);
      mesh.add(f);
    }
  }
}

function setCameraPreset(refs: SceneRefs, preset: ViewPreset) {
  const { camera, controls, center, radius } = refs;
  const d = Math.max(radius * 2.05, 7);

  if (preset === "top") camera.position.set(center.x, center.y + d * 1.5, center.z + 0.001);
  else if (preset === "front") camera.position.set(center.x, center.y + d * 0.3, center.z + d);
  else if (preset === "right") camera.position.set(center.x + d, center.y + d * 0.3, center.z);
  else camera.position.set(center.x + d * 0.82, center.y + d * 0.68, center.z + d * 0.92);

  camera.up.set(0, 1, 0);
  controls.target.copy(center);
  controls.update();
}

export default function Viewer3D({ data }: { data: FloorplanExtraction | null }) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRefs = useRef<SceneRefs | null>(null);

  const [layers, setLayers] = useState<LayerState>({
    walls: true,
    doors: true,
    windows: true,
    floor: true,
    grid: false
  });
  const [preset, setPreset] = useState<ViewPreset>("iso");
  const [renderMode, setRenderMode] = useState<RenderMode>("presentation");
  const [sectionMode, setSectionMode] = useState(false);
  const [shadowsEnabled, setShadowsEnabled] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  const counts = useMemo(() => ({
    walls: data?.polygons.wall?.length ?? 0,
    doors: data?.polygons.door?.length ?? 0,
    windows: data?.polygons.window?.length ?? 0
  }), [data]);

  useEffect(() => {
    if (!host.current) return;

    const el = host.current;
    const presentation = renderMode === "presentation";
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(presentation ? 0xe7edf1 : 0x0b1220);
    scene.fog = presentation ? new THREE.Fog(0xe7edf1, 30, 75) : null;

    const camera = new THREE.PerspectiveCamera(presentation ? 34 : 45, el.clientWidth / el.clientHeight, 0.1, 300);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.enabled = shadowsEnabled;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = presentation ? 1.12 : 1;
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enableRotate = true;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.screenSpacePanning = true;
    controls.minDistance = 2.5;
    controls.maxDistance = 45;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;

    scene.add(new THREE.HemisphereLight(0xffffff, presentation ? 0x9ca8b0 : 0x203047, presentation ? 2.7 : 2.25));

    const key = new THREE.DirectionalLight(presentation ? 0xfff2dc : 0xffffff, presentation ? 3.2 : 2.5);
    key.position.set(10, 15, 9);
    key.castShadow = shadowsEnabled;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -14;
    key.shadow.camera.right = 14;
    key.shadow.camera.top = 14;
    key.shadow.camera.bottom = -14;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x9fc7ff, presentation ? 0.95 : 0.7);
    fill.position.set(-8, 8, -6);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, presentation ? 0.7 : 0.25);
    rim.position.set(0, 10, -12);
    scene.add(rim);

    const grid = new THREE.GridHelper(26, 52, presentation ? 0xaebac4 : 0x37506e, presentation ? 0xc9d1d8 : 0x1c2a3c);
    grid.visible = layers.grid;
    scene.add(grid);

    const modelRoot = new THREE.Group();
    const floorGroup = new THREE.Group();
    const wallGroup = new THREE.Group();
    const doorGroup = new THREE.Group();
    const windowGroup = new THREE.Group();
    modelRoot.add(floorGroup, wallGroup, doorGroup, windowGroup);
    scene.add(modelRoot);

    const stoneTexture = presentation ? makeCanvasTexture("stone") : null;
    const woodTexture = presentation ? makeCanvasTexture("wood") : null;

    if (data) {
      const [canvasW, canvasH] = data.canvas_size;
      const rect = data.content_rect || [0, 0, canvasW, canvasH];
      const [, , contentW, contentH] = rect;
      const cx = rect[0] + contentW / 2;
      const cy = rect[1] + contentH / 2;
      const scale = 10 / Math.max(contentW, contentH);

      const floorMaterial = new THREE.MeshStandardMaterial({
        color: presentation ? 0xd7c9b6 : 0x687689,
        map: stoneTexture || undefined,
        roughness: presentation ? 0.72 : 0.94,
        metalness: 0.01
      });

      const wallMaterial = new THREE.MeshStandardMaterial({
        color: presentation ? 0xf7f3ec : 0xe8edf3,
        roughness: presentation ? 0.62 : 0.76,
        metalness: 0,
        side: THREE.DoubleSide
      });

      const doorMaterial = new THREE.MeshStandardMaterial({
        color: presentation ? 0x8f5d3d : 0xa56d43,
        map: woodTexture || undefined,
        roughness: presentation ? 0.46 : 0.68,
        metalness: 0.02
      });

      const glassMaterial = new THREE.MeshPhysicalMaterial({
        color: presentation ? 0xa9dbef : 0x72c8ff,
        roughness: presentation ? 0.08 : 0.15,
        transmission: presentation ? 0.66 : 0.2,
        transparent: true,
        opacity: presentation ? 0.48 : 0.78,
        thickness: 0.08,
        side: THREE.DoubleSide
      });

      const frameMaterial = new THREE.MeshStandardMaterial({
        color: presentation ? 0x2f3943 : 0x6e8798,
        roughness: 0.42,
        metalness: 0.45
      });

      if (data.polygons.floor?.length) {
        for (const polygon of data.polygons.floor) {
          addExtrudedPolygon(floorGroup, polygon, { cx, cy, scale, height: 0.06, baseY: 0.04, material: floorMaterial });
        }
      } else {
        const slab = new THREE.Mesh(
          new THREE.BoxGeometry(contentW * scale + 0.35, 0.1, contentH * scale + 0.35),
          floorMaterial
        );
        slab.position.y = 0.05;
        slab.receiveShadow = true;
        floorGroup.add(slab);
      }

      for (const polygon of data.polygons.wall || []) {
        addExtrudedPolygon(wallGroup, polygon, {
          cx, cy, scale,
          height: sectionMode ? 1.55 : 2.8,
          baseY: 0.1,
          material: wallMaterial
        });
      }

      for (const polygon of data.polygons.door || []) {
        addArchitecturalElement(doorGroup, polygon, {
          kind: "door", cx, cy, scale, material: doorMaterial
        });
      }

      for (const polygon of data.polygons.window || []) {
        addArchitecturalElement(windowGroup, polygon, {
          kind: "window", cx, cy, scale, material: glassMaterial, frameMaterial
        });
      }
    }

    if (presentation) {
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(20, 96),
        new THREE.MeshStandardMaterial({ color: 0xc7d0d4, roughness: 1 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.015;
      ground.receiveShadow = true;
      scene.add(ground);

      const backdrop = new THREE.Mesh(
        new THREE.PlaneGeometry(55, 28),
        new THREE.MeshBasicMaterial({ color: 0xe7edf1 })
      );
      backdrop.position.set(0, 10, -24);
      scene.add(backdrop);
    }

    const box = new THREE.Box3().setFromObject(modelRoot);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    if (!Number.isFinite(center.x)) center.set(0, 1, 0);
    const radius = Math.max(size.length() * 0.5, 4);

    sceneRefs.current = {
      renderer, camera, controls,
      wallGroup, doorGroup, windowGroup, floorGroup, grid, center, radius
    };

    setCameraPreset(sceneRefs.current, preset);

    const resize = () => {
      if (!host.current) return;
      camera.aspect = host.current.clientWidth / host.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.current.clientWidth, host.current.clientHeight);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(el);
    window.addEventListener("resize", resize);

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      controls.dispose();
      renderer.dispose();
      stoneTexture?.dispose();
      woodTexture?.dispose();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => material.dispose());
        }
      });
      sceneRefs.current = null;
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, [data, renderMode, sectionMode, shadowsEnabled]);

  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    refs.wallGroup.visible = layers.walls;
    refs.doorGroup.visible = layers.doors;
    refs.windowGroup.visible = layers.windows;
    refs.floorGroup.visible = layers.floor;
    refs.grid.visible = layers.grid;
  }, [layers]);

  useEffect(() => {
    const refs = sceneRefs.current;
    if (refs) setCameraPreset(refs, preset);
  }, [preset]);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  function toggleLayer(key: keyof LayerState) {
    setLayers(current => ({ ...current, [key]: !current[key] }));
  }

  function resetCamera() {
    const refs = sceneRefs.current;
    if (!refs) return;
    setPreset("iso");
    setCameraPreset(refs, "iso");
  }

  async function toggleFullscreen() {
    if (!host.current) return;
    const container = host.current.closest(".viewerPanel");
    if (!(container instanceof HTMLElement)) return;
    if (!document.fullscreenElement) await container.requestFullscreen?.();
    else await document.exitFullscreen?.();
  }

  function captureImage() {
    const refs = sceneRefs.current;
    if (!refs) return;
    const url = refs.renderer.domElement.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "emlak-cafe-sanal-maket.png";
    a.click();
  }

  return (
    <div className="viewerWorkspace">
      <div className="viewerToolbar">
        <div className="toolbarGroup">
          <button className={renderMode === "presentation" ? "viewerTool active" : "viewerTool"} onClick={() => setRenderMode("presentation")}>Mimari Sunum</button>
          <button className={renderMode === "technical" ? "viewerTool active" : "viewerTool"} onClick={() => setRenderMode("technical")}>Teknik</button>
        </div>

        <div className="toolbarGroup">
          <button className={preset === "iso" ? "viewerTool active" : "viewerTool"} onClick={() => setPreset("iso")}>İzometrik</button>
          <button className={preset === "top" ? "viewerTool active" : "viewerTool"} onClick={() => setPreset("top")}>Üst</button>
          <button className={preset === "front" ? "viewerTool active" : "viewerTool"} onClick={() => setPreset("front")}>Ön</button>
          <button className={preset === "right" ? "viewerTool active" : "viewerTool"} onClick={() => setPreset("right")}>Sağ</button>
        </div>

        <div className="toolbarGroup">
          <button className="viewerTool" onClick={resetCamera}>Sıfırla</button>
          <button className={sectionMode ? "viewerTool active" : "viewerTool"} onClick={() => setSectionMode(v => !v)}>Dollhouse Kesit</button>
          <button className="viewerTool" onClick={captureImage}>PNG Al</button>
          <button className="viewerTool" onClick={toggleFullscreen}>{fullscreen ? "Tam Ekrandan Çık" : "Tam Ekran"}</button>
        </div>
      </div>

      <div className="viewerBody">
        <aside className="viewerSidebar">
          <div className="viewerPanelTitle">Mimari Katmanlar</div>

          <label className="viewerToggle"><input type="checkbox" checked={layers.walls} onChange={() => toggleLayer("walls")} /><span>Duvarlar</span><b>{counts.walls}</b></label>
          <label className="viewerToggle"><input type="checkbox" checked={layers.doors} onChange={() => toggleLayer("doors")} /><span>Kapılar</span><b>{counts.doors}</b></label>
          <label className="viewerToggle"><input type="checkbox" checked={layers.windows} onChange={() => toggleLayer("windows")} /><span>Pencereler</span><b>{counts.windows}</b></label>
          <label className="viewerToggle"><input type="checkbox" checked={layers.floor} onChange={() => toggleLayer("floor")} /><span>Zemin</span><b>1</b></label>
          <label className="viewerToggle"><input type="checkbox" checked={layers.grid} onChange={() => toggleLayer("grid")} /><span>Izgara</span><b>—</b></label>

          <div className="viewerPanelTitle qualityTitle">Görsel Kalite</div>
          <label className="viewerToggle"><input type="checkbox" checked={shadowsEnabled} readOnly /><span>Gölge derinliği</span><b>ON</b></label>
          <label className="viewerToggle"><input type="checkbox" checked={shadowsEnabled} onChange={() => setShadowsEnabled(v => !v)} /><span>Yumuşak Gölgeler</span><b>HD</b></label>

          <div className="viewerHelp">
            <strong>Fare kullanımı</strong>
            <span>Sol tuş: döndür</span>
            <span>Sağ tuş: kaydır</span>
            <span>Tekerlek: yakınlaştır</span>
          </div>

          {data && (
            <div className="viewerMetrics">
              <strong>Model bilgisi</strong>
              <span>Kaynak: {data.canvas_size[0]} × {data.canvas_size[1]}</span>
              <span>Toplam mimari eleman: {counts.walls + counts.doors + counts.windows}</span>
              <span>Mod: {renderMode === "presentation" ? "Mimari Sunum" : "Teknik Analiz"}</span>
            </div>
          )}
        </aside>

        <div ref={host} className="viewerCanvas" />
      </div>
    </div>
  );
}
