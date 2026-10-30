"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function Viewer3D({ ready }: { ready: boolean }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;

    const el = host.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);

    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 100);
    camera.position.set(5.8, 4.4, 7.2);
    camera.lookAt(0, 1, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(4, 8, 5);
    scene.add(key);

    const grid = new THREE.GridHelper(14, 28, 0x37506e, 0x1c2a3c);
    scene.add(grid);

    const group = new THREE.Group();

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(4.8, 0.28, 3.6),
      new THREE.MeshStandardMaterial({ color: 0xb7bdc8, roughness: 0.85 })
    );
    base.position.y = 0.14;
    group.add(base);

    const building = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, ready ? 2.8 : 1.3, 3.0),
      new THREE.MeshStandardMaterial({
        color: ready ? 0xe6e8ec : 0x5d6c7e,
        roughness: ready ? 0.55 : 1
      })
    );
    building.position.y = ready ? 1.68 : 0.92;
    group.add(building);

    if (ready) {
      const windowMaterial = new THREE.MeshStandardMaterial({
        color: 0x7fc8ff,
        metalness: 0.15,
        roughness: 0.2
      });
      for (const y of [1.1, 2.05]) {
        for (const x of [-1.2, 0, 1.2]) {
          const w = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.05), windowMaterial);
          w.position.set(x, y, 1.525);
          group.add(w);
        }
      }

      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(3.2, 1.1, 4),
        new THREE.MeshStandardMaterial({ color: 0x323b46, roughness: 0.8 })
      );
      roof.rotation.y = Math.PI / 4;
      roof.scale.z = 0.72;
      roof.position.y = 3.62;
      group.add(roof);
    }

    scene.add(group);

    let dragging = false;
    let lastX = 0;
    renderer.domElement.addEventListener("pointerdown", e => {
      dragging = true;
      lastX = e.clientX;
    });
    window.addEventListener("pointerup", () => dragging = false);
    window.addEventListener("pointermove", e => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      group.rotation.y += dx * 0.01;
    });

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
      if (!dragging) group.rotation.y += 0.002;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, [ready]);

  return <div ref={host} className="viewerCanvas" />;
}
