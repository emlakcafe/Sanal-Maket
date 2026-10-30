"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { ExtractedPolygon, FloorplanExtraction } from "@/lib/geometry/types";

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

export default function Viewer3D({ data }: { data: FloorplanExtraction | null }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;

    const el = host.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);

    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 200);
    camera.position.set(10, 9, 12);
    camera.lookAt(0, 1.2, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x203047, 2.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(7, 12, 8);
    key.castShadow = true;
    scene.add(key);

    const grid = new THREE.GridHelper(20, 40, 0x37506e, 0x1c2a3c);
    scene.add(grid);

    const group = new THREE.Group();

    if (data) {
      const [canvasW, canvasH] = data.canvas_size;
      const rect = data.content_rect || [0, 0, canvasW, canvasH];
      const [, , contentW, contentH] = rect;
      const cx = rect[0] + contentW / 2;
      const cy = rect[1] + contentH / 2;
      const scale = 10 / Math.max(contentW, contentH);

      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(contentW * scale + 0.3, 0.12, contentH * scale + 0.3),
        new THREE.MeshStandardMaterial({ color: 0x6c7787, roughness: 0.95 })
      );
      slab.position.y = 0.06;
      slab.receiveShadow = true;
      group.add(slab);

      const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xe8edf3, roughness: 0.78 });
      const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x9a6944, roughness: 0.72 });
      const windowMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x78c8ff,
        roughness: 0.18,
        transmission: 0.18,
        transparent: true,
        opacity: 0.82
      });

      for (const polygon of data.polygons.wall || []) {
        addExtrudedPolygon(group, polygon, { cx, cy, scale, height: 2.8, baseY: 0.12, material: wallMaterial });
      }
      for (const polygon of data.polygons.door || []) {
        addExtrudedPolygon(group, polygon, { cx, cy, scale, height: 2.1, baseY: 0.12, material: doorMaterial });
      }
      for (const polygon of data.polygons.window || []) {
        addExtrudedPolygon(group, polygon, { cx, cy, scale, height: 1.25, baseY: 0.95, material: windowMaterial });
      }
    } else {
      const guide = new THREE.Mesh(
        new THREE.BoxGeometry(7, 0.12, 5),
        new THREE.MeshStandardMaterial({ color: 0x26364b, roughness: 1 })
      );
      guide.position.y = 0.06;
      group.add(guide);
    }

    scene.add(group);

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const pointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.domElement.setPointerCapture?.(e.pointerId);
    };
    const pointerUp = () => { dragging = false; };
    const pointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      group.rotation.y += dx * 0.009;
      camera.position.y = THREE.MathUtils.clamp(camera.position.y + dy * 0.015, 3, 18);
      camera.lookAt(0, 1.2, 0);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      camera.position.addScaledVector(direction, e.deltaY * 0.008);
      const distance = camera.position.length();
      if (distance < 5) camera.position.setLength(5);
      if (distance > 30) camera.position.setLength(30);
    };

    renderer.domElement.addEventListener("pointerdown", pointerDown);
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointermove", pointerMove);
    renderer.domElement.addEventListener("wheel", wheel, { passive: false });

    const resize = () => {
      if (!host.current) return;
      camera.aspect = host.current.clientWidth / host.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.current.clientWidth, host.current.clientHeight);
    };
    window.addEventListener("resize", resize);

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointermove", pointerMove);
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("wheel", wheel);
      renderer.dispose();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => material.dispose());
        }
      });
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, [data]);

  return <div ref={host} className="viewerCanvas" />;
}
