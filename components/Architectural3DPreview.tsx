"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

export function ThreeFilePreview({ file }: { file: File }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const ext = useMemo(() => "." + file.name.toLowerCase().split(".").pop(), [file.name]);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f5f9);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(8, 12, 7);
    scene.add(sun);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const url = URL.createObjectURL(file);
    let root: THREE.Object3D | null = null;
    let disposed = false;

    const frameObject = (obj: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z, 1);
      controls.target.copy(center);
      camera.position.copy(center.clone().add(new THREE.Vector3(radius * 1.25, radius * 0.9, radius * 1.55)));
      camera.near = Math.max(0.01, radius / 1000);
      camera.far = radius * 100;
      camera.updateProjectionMatrix();
      controls.update();
    };

    const load = async () => {
      try {
        if (ext === ".glb" || ext === ".gltf") {
          const gltf = await new GLTFLoader().loadAsync(url);
          root = gltf.scene;
        } else if (ext === ".obj") {
          root = await new OBJLoader().loadAsync(url);
        } else if (ext === ".stl") {
          const geom = await new STLLoader().loadAsync(url);
          geom.computeVertexNormals();
          root = new THREE.Mesh(
            geom,
            new THREE.MeshStandardMaterial({ color: 0xd7dce2, roughness: 0.62, metalness: 0.04 })
          );
        }

        if (!root || disposed) return;
        root.traverse(obj => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });
        scene.add(root);
        frameObject(root);
      } catch (error) {
        host.dataset.error = error instanceof Error ? error.message : String(error);
      }
    };
    load();

    const resize = () => {
      const w = host.clientWidth;
      const h = Math.max(420, host.clientHeight);
      renderer.setSize(w, h, true);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      URL.revokeObjectURL(url);
      host.innerHTML = "";
    };
  }, [file, ext]);

  return <div ref={ref} style={{ width: "100%", height: 520, borderRadius: 12, overflow: "hidden" }} />;
}
