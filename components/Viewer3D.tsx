"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ExtractedPolygon, FloorplanExtraction } from "@/lib/geometry/types";

type ViewPreset = "iso" | "top" | "front" | "right";

type LayerState = {
  walls: boolean;
  doors: boolean;
  windows: boolean;
  slab: boolean;
  grid: boolean;
};

type SceneRefs = {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  wallGroup: THREE.Group;
  doorGroup: THREE.Group;
  windowGroup: THREE.Group;
  slabGroup: THREE.Group;
  grid: THREE.GridHelper;
  center: THREE.Vector3;
  radius: number;
};

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
  polygon.outer.forEach(([px, py], index) => {
    const x = (px - options.cx) * options.scale;
    const y = (py - options.cy) * options.scale;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();

  for (const holePoints of polygon.holes || []) {
    if (holePoints.length < 3) continue;
    const hole = new THREE.Path();
    holePoints.forEach(([px, py], index) => {
      const x = (px - options.cx) * options.scale;
      const y = (py - options.cy) * options.scale;
      if (index === 0) hole.moveTo(x, y);
      else hole.lineTo(x, y);
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

function setCameraPreset(refs: SceneRefs, preset: ViewPreset) {
  const { camera, controls, center, radius } = refs;
  const d = Math.max(radius * 2.15, 7);

  if (preset === "top") {
    camera.position.set(center.x, center.y + d * 1.35, center.z + 0.001);
  } else if (preset === "front") {
    camera.position.set(center.x, center.y + d * 0.28, center.z + d);
  } else if (preset === "right") {
    camera.position.set(center.x + d, center.y + d * 0.28, center.z);
  } else {
    camera.position.set(center.x + d * 0.78, center.y + d * 0.62, center.z + d * 0.88);
  }

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
    slab: true,
    grid: true
  });
  const [preset, setPreset] = useState<ViewPreset>("iso");
  const [sectionMode, setSectionMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const counts = useMemo(() => ({
    walls: data?.polygons.wall?.length ?? 0,
    doors: data?.polygons.door?.length ?? 0,
    windows: data?.polygons.window?.length ?? 0
  }), [data]);

  useEffect(() => {
    if (!host.current) return;

    const el = host.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);

    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 300);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
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

    scene.add(new THREE.HemisphereLight(0xffffff, 0x203047, 2.35));
    const key = new THREE.DirectionalLight(0xffffff, 2.7);
    key.position.set(8, 14, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x9fc7ff, 0.75);
    fill.position.set(-6, 7, -5);
    scene.add(fill);

    const grid = new THREE.GridHelper(24, 48, 0x37506e, 0x1c2a3c);
    scene.add(grid);

    const modelRoot = new THREE.Group();
    const slabGroup = new THREE.Group();
    const wallGroup = new THREE.Group();
    const doorGroup = new THREE.Group();
    const windowGroup = new THREE.Group();

    modelRoot.add(slabGroup, wallGroup, doorGroup, windowGroup);
    scene.add(modelRoot);

    if (data) {
      const [canvasW, canvasH] = data.canvas_size;
      const rect = data.content_rect || [0, 0, canvasW, canvasH];
      const [, , contentW, contentH] = rect;
      const cx = rect[0] + contentW / 2;
      const cy = rect[1] + contentH / 2;
      const scale = 10 / Math.max(contentW, contentH);

      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(contentW * scale + 0.35, 0.12, contentH * scale + 0.35),
        new THREE.MeshStandardMaterial({ color: 0x687689, roughness: 0.94 })
      );
      slab.position.y = 0.06;
      slab.receiveShadow = true;
      slabGroup.add(slab);

      const wallMaterial = new THREE.MeshStandardMaterial({
        color: 0xe8edf3,
        roughness: 0.76,
        side: THREE.DoubleSide
      });
      const doorMaterial = new THREE.MeshStandardMaterial({
        color: 0xa56d43,
        roughness: 0.68,
        side: THREE.DoubleSide
      });
      const windowMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x72c8ff,
        roughness: 0.13,
        transmission: 0.2,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide
      });

      for (const polygon of data.polygons.wall || []) {
        addExtrudedPolygon(wallGroup, polygon, { cx, cy, scale, height: 2.8, baseY: 0.12, material: wallMaterial });
      }
      for (const polygon of data.polygons.door || []) {
        addExtrudedPolygon(doorGroup, polygon, { cx, cy, scale, height: 2.1, baseY: 0.12, material: doorMaterial });
      }
      for (const polygon of data.polygons.window || []) {
        addExtrudedPolygon(windowGroup, polygon, { cx, cy, scale, height: 1.25, baseY: 0.95, material: windowMaterial });
      }
    } else {
      const guide = new THREE.Mesh(
        new THREE.BoxGeometry(7, 0.12, 5),
        new THREE.MeshStandardMaterial({ color: 0x26364b, roughness: 1 })
      );
      guide.position.y = 0.06;
      slabGroup.add(guide);
    }

    const box = new THREE.Box3().setFromObject(modelRoot);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    if (!Number.isFinite(center.x)) center.set(0, 1, 0);
    const radius = Math.max(size.length() * 0.5, 4);

    sceneRefs.current = {
      camera,
      controls,
      wallGroup,
      doorGroup,
      windowGroup,
      slabGroup,
      grid,
      center,
      radius
    };

    setCameraPreset(sceneRefs.current, "iso");

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
  }, [data]);

  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    refs.wallGroup.visible = layers.walls;
    refs.doorGroup.visible = layers.doors;
    refs.windowGroup.visible = layers.windows;
    refs.slabGroup.visible = layers.slab;
    refs.grid.visible = layers.grid;

    refs.wallGroup.children.forEach(child => {
      if (child instanceof THREE.Mesh) {
        child.material = child.material.clone();
        if (!Array.isArray(child.material)) {
          child.material.transparent = sectionMode;
          child.material.opacity = sectionMode ? 0.28 : 1;
          child.material.depthWrite = !sectionMode;
        }
      }
    });
  }, [layers, sectionMode]);

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
    const container = host.current.parentElement;
    if (!container) return;

    if (!document.fullscreenElement) {
      await container.requestFullscreen?.();
    } else {
      await document.exitFullscreen?.();
    }
  }

  return (
    <div className="viewerWorkspace">
      <div className="viewerToolbar">
        <div className="toolbarGroup">
          <button className={preset === "iso" ? "viewerTool active" : "viewerTool"} onClick={() => setPreset("iso")}>İzometrik</button>
          <button className={preset === "top" ? "viewerTool active" : "viewerTool"} onClick={() => setPreset("top")}>Üst</button>
          <button className={preset === "front" ? "viewerTool active" : "viewerTool"} onClick={() => setPreset("front")}>Ön</button>
          <button className={preset === "right" ? "viewerTool active" : "viewerTool"} onClick={() => setPreset("right")}>Sağ</button>
        </div>

        <div className="toolbarGroup">
          <button className="viewerTool" onClick={resetCamera}>Kamerayı Sıfırla</button>
          <button className={sectionMode ? "viewerTool active" : "viewerTool"} onClick={() => setSectionMode(v => !v)}>Kesit</button>
          <button className="viewerTool" onClick={toggleFullscreen}>{fullscreen ? "Tam Ekrandan Çık" : "Tam Ekran"}</button>
        </div>
      </div>

      <div className="viewerBody">
        <aside className="viewerSidebar">
          <div className="viewerPanelTitle">Görünürlük</div>

          <label className="viewerToggle">
            <input type="checkbox" checked={layers.walls} onChange={() => toggleLayer("walls")} />
            <span>Duvarlar</span>
            <b>{counts.walls}</b>
          </label>
          <label className="viewerToggle">
            <input type="checkbox" checked={layers.doors} onChange={() => toggleLayer("doors")} />
            <span>Kapılar</span>
            <b>{counts.doors}</b>
          </label>
          <label className="viewerToggle">
            <input type="checkbox" checked={layers.windows} onChange={() => toggleLayer("windows")} />
            <span>Pencereler</span>
            <b>{counts.windows}</b>
          </label>
          <label className="viewerToggle">
            <input type="checkbox" checked={layers.slab} onChange={() => toggleLayer("slab")} />
            <span>Zemin</span>
            <b>1</b>
          </label>
          <label className="viewerToggle">
            <input type="checkbox" checked={layers.grid} onChange={() => toggleLayer("grid")} />
            <span>Izgara</span>
            <b>—</b>
          </label>

          <div className="viewerHelp">
            <strong>Fare kullanımı</strong>
            <span>Sol tuş: döndür</span>
            <span>Sağ tuş: kaydır</span>
            <span>Tekerlek: yakınlaştır</span>
          </div>

          {data && (
            <div className="viewerMetrics">
              <strong>Model bilgisi</strong>
              <span>Tuval: {data.canvas_size[0]} × {data.canvas_size[1]}</span>
              <span>Toplam eleman: {counts.walls + counts.doors + counts.windows}</span>
            </div>
          )}
        </aside>

        <div ref={host} className="viewerCanvas" />
      </div>
    </div>
  );
}
