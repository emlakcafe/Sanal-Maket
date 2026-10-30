"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import styles from "./ProjectShowcase.module.css";
import { FloorPlan3D, Interior360, RenderPresentation } from "@/components/ShowcaseModes";

type BlockId = "A" | "B" | "C" | "D" | "E";
type UnitStatus = "available" | "reserved" | "sold";
type ViewMode = "render" | "site" | "satellite" | "floor" | "inside";

type Unit = {
  id: string;
  block: BlockId;
  floor: number;
  number: number;
  type: "1+1" | "2+1" | "3+1";
  gross: number;
  net: number;
  status: UnitStatus;
  price: number;
};

const statusLabel: Record<UnitStatus, string> = {
  available: "Satılık",
  reserved: "Rezerve",
  sold: "Satıldı"
};

const BLOCKS: BlockId[] = ["A", "B", "C", "D", "E"];

function buildUnits(): Unit[] {
  const units: Unit[] = [];
  let index = 0;

  for (const block of BLOCKS) {
    for (let floor = 1; floor <= 4; floor++) {
      for (let number = 1; number <= 4; number++) {
        const type = number === 1 ? "1+1" : number === 4 ? "3+1" : "2+1";
        const gross = type === "1+1" ? 74.7 : type === "2+1" ? 104.56 : 129.12;
        const status: UnitStatus = index % 9 === 2 ? "reserved" : index % 13 === 5 ? "sold" : "available";

        units.push({
          id: `${block}-${String((floor - 1) * 4 + number).padStart(2, "0")}`,
          block,
          floor,
          number,
          type,
          gross,
          net: Math.round(gross * 0.75 * 100) / 100,
          status,
          price: Math.round((gross * 63000 + floor * 120000) / 1000) * 1000
        });
        index++;
      }
    }
  }

  return units;
}

function createTree() {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.18, 1.1, 10),
    new THREE.MeshStandardMaterial({ color: 0x76523b, roughness: 1 })
  );
  trunk.position.y = 0.55;
  tree.add(trunk);

  const crown = new THREE.Mesh(
    new THREE.SphereGeometry(0.72, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0x4f7e43, roughness: 1 })
  );
  crown.position.y = 1.55;
  crown.scale.set(1, 1.2, 1);
  tree.add(crown);

  return tree;
}

function ProjectScene({
  selectedId,
  units,
  onSelect,
  focusNonce
}: {
  selectedId: string;
  units: Unit[];
  onSelect: (id: string) => void;
  focusNonce: number;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdbe9f2);
    scene.fog = new THREE.Fog(0xdbe9f2, 42, 85);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    camera.position.set(17, 10.5, 20);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    mount.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    const beauty = new RenderPass(scene, camera);
    const gtao = new GTAOPass(scene, camera, 1, 1);
    gtao.updateGtaoMaterial({ radius: 2.0, thickness: 1.1, distanceExponent: 1.5, distanceFallOff: 0.8, scale: 1, samples: 8 });
    gtao.updatePdMaterial({ radius: 5, samples: 8 });
    gtao.blendIntensity = 0.7;
    composer.addPass(beauty);
    composer.addPass(gtao);
    composer.addPass(new OutputPass());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 4.2, 0);
    controls.minDistance = 8;
    controls.maxDistance = 48;
    controls.maxPolarAngle = Math.PI / 2.06;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x72816c, 2.1));

    const sun = new THREE.DirectionalLight(0xffffff, 3.8);
    sun.position.set(18, 28, 13);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    scene.add(sun);

    const site = new THREE.Mesh(
      new THREE.BoxGeometry(48, 0.4, 34),
      new THREE.MeshStandardMaterial({ color: 0x5e7f52, roughness: 1 })
    );
    site.position.y = -0.28;
    site.receiveShadow = true;
    scene.add(site);

    const pathMaterial = new THREE.MeshStandardMaterial({ color: 0xc2bdb1, roughness: 0.95 });
    const centralPath = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.12, 27), pathMaterial);
    centralPath.position.y = 0;
    centralPath.receiveShadow = true;
    scene.add(centralPath);

    const crossPath = new THREE.Mesh(new THREE.BoxGeometry(31, 0.12, 3.4), pathMaterial);
    crossPath.position.set(0, 0.01, -3.8);
    crossPath.receiveShadow = true;
    scene.add(crossPath);

    const poolShell = new THREE.Mesh(
      new THREE.BoxGeometry(8.8, 0.2, 5.4),
      new THREE.MeshStandardMaterial({ color: 0xd6d2c8, roughness: 0.9 })
    );
    poolShell.position.set(0, 0.08, -8.2);
    scene.add(poolShell);

    const pool = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.1, 4.6),
      new THREE.MeshPhysicalMaterial({
        color: 0x54b9e8,
        roughness: 0.15,
        metalness: 0.05,
        transparent: true,
        opacity: 0.92
      })
    );
    pool.position.set(0, 0.2, -8.2);
    scene.add(pool);

    const court = new THREE.Mesh(
      new THREE.BoxGeometry(9.2, 0.08, 5.8),
      new THREE.MeshStandardMaterial({ color: 0xb56b48, roughness: 0.9 })
    );
    court.position.set(0, 0.15, 5.8);
    scene.add(court);

    const courtLines = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(8.7, 0.04, 5.3)),
      new THREE.LineBasicMaterial({ color: 0xf4eee4 })
    );
    courtLines.position.set(0, 0.22, 5.8);
    scene.add(courtLines);

    const blockPositions: Record<BlockId, THREE.Vector3> = {
      A: new THREE.Vector3(-11.5, 0, 6.8),
      B: new THREE.Vector3(11.5, 0, 6.8),
      C: new THREE.Vector3(-11.5, 0, -7.0),
      D: new THREE.Vector3(11.5, 0, -7.0),
      E: new THREE.Vector3(0, 0, -13.8)
    };

    // Her blok ana cephesini ortak avluya çevirir.
    const blockFacing: Record<BlockId, number> = {
      A: 2.05,
      B: -2.05,
      C: 1.02,
      D: -1.02,
      E: 0
    };

    const clickable: THREE.Mesh[] = [];
    const unitMesh = new Map<string, THREE.Mesh>();
    const worldUnitPosition = new Map<string, THREE.Vector3>();

    const facadeMaterial = new THREE.MeshStandardMaterial({ color: 0xe8e1d3, roughness: 0.72 });
    const slabMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d2c6, roughness: 0.88 });
    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xa7c8d4,
      transparent: true,
      opacity: 0.75,
      roughness: 0.17,
      metalness: 0.08
    });
    const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x8e6748, roughness: 0.78 });
    const balconyMaterial = new THREE.MeshStandardMaterial({ color: 0xe1ded7, roughness: 0.82 });

    for (const block of BLOCKS) {
      const origin = blockPositions[block];
      const root = new THREE.Group();
      root.position.copy(origin);
      root.rotation.y = blockFacing[block];
      scene.add(root);

      const core = new THREE.Mesh(new THREE.BoxGeometry(8.9, 11.3, 5.6), facadeMaterial);
      core.position.y = 5.65;
      core.castShadow = true;
      core.receiveShadow = true;
      root.add(core);

      const penthouseCap = new THREE.Mesh(new THREE.BoxGeometry(8.1, 0.35, 5), slabMaterial);
      penthouseCap.position.y = 11.45;
      root.add(penthouseCap);

      // Kör cepheyi kırmak için yan cephe pencere bantları.
      for (const side of [-1, 1]) {
        for (let floor = 1; floor <= 4; floor++) {
          const sideWindow = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 1.45, 1.15),
            glassMaterial
          );
          sideWindow.position.set(side * 4.34, (floor - 1) * 2.75 + 1.45, 0.15);
          root.add(sideWindow);
        }
      }

      for (let floor = 1; floor <= 4; floor++) {
        const y = (floor - 1) * 2.75 + 1.45;

        const slab = new THREE.Mesh(new THREE.BoxGeometry(9.1, 0.14, 5.8), slabMaterial);
        slab.position.y = y - 1.35;
        slab.receiveShadow = true;
        root.add(slab);

        const balcony = new THREE.Mesh(new THREE.BoxGeometry(9.15, 0.16, 1.05), balconyMaterial);
        balcony.position.set(0, y - 0.88, 3.2);
        balcony.castShadow = true;
        balcony.receiveShadow = true;
        root.add(balcony);

        const balconyRail = new THREE.Mesh(
          new THREE.BoxGeometry(8.95, 0.72, 0.07),
          new THREE.MeshPhysicalMaterial({ color: 0xc9d7da, transparent: true, opacity: 0.42, roughness: 0.18, metalness: 0.05 })
        );
        balconyRail.position.set(0, y - 0.48, 3.69);
        root.add(balconyRail);

        for (let col = 0; col < 4; col++) {
          const unit = units.find(u => u.block === block && u.floor === floor && u.number === col + 1);
          if (!unit) continue;

          const x = -3.05 + col * 2.05;
          const z = 2.73;

          const panel = new THREE.Mesh(
            new THREE.BoxGeometry(1.78, 2.16, 0.18),
            new THREE.MeshStandardMaterial({
              color: unit.status === "sold" ? 0xc5cbd2 : unit.status === "reserved" ? 0xe9b64d : 0xf7f9fb,
              emissive: 0x000000,
              roughness: 0.42,
              transparent: true,
              opacity: unit.status === "available" ? 0.88 : 0.96
            })
          );
          panel.position.set(x, y, z);
          panel.userData.unitId = unit.id;
          root.add(panel);
          clickable.push(panel);
          unitMesh.set(unit.id, panel);

          const world = new THREE.Vector3();
          panel.getWorldPosition(world);
          worldUnitPosition.set(unit.id, world);

          const glass = new THREE.Mesh(new THREE.BoxGeometry(1.46, 1.62, 0.13), glassMaterial);
          glass.position.set(x, y, z + 0.13);
          root.add(glass);

          const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.12, 0.2), slabMaterial);
          lintel.position.set(x, y + 0.92, z + 0.12);
          root.add(lintel);

          const finLeft = new THREE.Mesh(new THREE.BoxGeometry(0.11, 2.3, 0.45), woodMaterial);
          finLeft.position.set(x - 0.9, y, z + 0.18);
          root.add(finLeft);

          const finRight = finLeft.clone();
          finRight.position.x = x + 0.9;
          root.add(finRight);
        }
      }
    }

    for (const [x, z] of [
      [-5, 10], [5, 10], [-5, 2], [5, 2], [-6, -2], [6, -2],
      [-7, -11], [7, -11], [-18, 0], [18, 0], [-18, -12], [18, -12]
    ] as [number, number][]) {
      const tree = createTree();
      tree.position.set(x, 0, z);
      scene.add(tree);
    }

    const updateHighlight = () => {
      for (const [id, mesh] of unitMesh) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (id === selectedId) {
          mat.color.set(0xef4444);
          mat.emissive.set(0x5a0b0b);
          mat.opacity = 1;
        } else {
          const unit = units.find(u => u.id === id)!;
          mat.emissive.set(0x000000);
          mat.color.set(unit.status === "sold" ? 0xc5cbd2 : unit.status === "reserved" ? 0xe9b64d : 0xf7f9fb);
          mat.opacity = unit.status === "available" ? 0.88 : 0.96;
        }
      }
    };
    updateHighlight();

    const focusSelected = () => {
      const target = worldUnitPosition.get(selectedId);
      if (!target) return;
      const block = selectedId.slice(0, 1) as BlockId;
      const frontDir = new THREE.Vector3(Math.sin(blockFacing[block]), 0, Math.cos(blockFacing[block]));
      const offset = frontDir.multiplyScalar(8.5).add(new THREE.Vector3(0, 4.4, 0));
      controls.target.copy(target);
      camera.position.copy(target.clone().add(offset));
      controls.update();
    };

    if (focusNonce > 0) focusSelected();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const onClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(clickable, false)[0];
      if (hit?.object.userData.unitId) onSelect(hit.object.userData.unitId);
    };
    renderer.domElement.addEventListener("click", onClick);

    const onResize = () => {
      const w = mount.clientWidth;
      const h = Math.max(420, mount.clientHeight);
      renderer.setSize(w, h, true);
      composer.setSize(w, h);
      gtao.setSize(Math.max(1, Math.round(w * 0.8)), Math.max(1, Math.round(h * 0.8)));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    onResize();

    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(mount);

    let frame = 0;
    const render = () => {
      controls.update();
      composer.render();
      frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      beauty.dispose();
      gtao.dispose();
      composer.dispose();
      renderer.dispose();
      mount.innerHTML = "";
    };
  }, [selectedId, units, onSelect, focusNonce]);

  return <div ref={mountRef} className={styles.scene} />;
}

export default function ProjectShowcase() {
  const units = useMemo(() => buildUnits(), []);
  const [selectedId, setSelectedId] = useState("B-11");
  const [mode, setMode] = useState<ViewMode>("site");
  const [blockFilter, setBlockFilter] = useState<"ALL" | BlockId>("ALL");
  const [focusNonce, setFocusNonce] = useState(0);

  const selectUnit = useCallback((id: string) => setSelectedId(id), []);
  const selected = units.find(u => u.id === selectedId) || units[0];
  const visibleUnits = blockFilter === "ALL" ? units : units.filter(u => u.block === blockFilter);

  const stats = units.reduce(
    (acc, unit) => {
      acc[unit.status]++;
      return acc;
    },
    { available: 0, reserved: 0, sold: 0 } as Record<UnitStatus, number>
  );

  function focusSelectedUnit() {
    setMode("site");
    setFocusNonce(v => v + 1);
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}><span>ec.</span><b>emlak cafe</b></div>
        <div className={styles.kicker}>INTERAKTİF 360° PROJE TANITIMI</div>
        <button className={styles.outlineButton} onClick={() => location.href = "/"}>Proje stüdyosuna dön</button>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>YALOVA · AKKÖY · KURUMSAL PROJE</p>
          <h1>Emlak Cafe <span>Residence</span></h1>
          <p className={styles.subtitle}>Havuz, spor alanı, peyzaj ve seçilebilir dairelerle interaktif proje deneyimi.</p>
        </div>
        <div className={styles.heroStats}>
          <div><b>05</b><span>Blok</span></div>
          <div><b>{units.length}</b><span>Daire</span></div>
          <div><b>20</b><span>Dükkan</span></div>
        </div>
      </section>

      <section className={styles.viewerGrid}>
        <div className={styles.viewerCard}>
          <div className={styles.modeTabs}>
            {[
              ["render", "Render"],
              ["site", "3D Site"],
              ["satellite", "Uydu + 3D"],
              ["floor", "3D Kat planı"],
              ["inside", "Daire içi"]
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setMode(key as ViewMode)}
                className={mode === key ? styles.activeTab : ""}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={styles.viewerStage}>
            {mode === "site" && (
              <ProjectScene
                selectedId={selected.id}
                units={units}
                onSelect={selectUnit}
                focusNonce={focusNonce}
              />
            )}
            {mode === "render" && <RenderPresentation unitId={selected.id} type={selected.type} />}
            {mode === "floor" && <FloorPlan3D type={selected.type} />}
            {mode === "inside" && <Interior360 unitId={selected.id} type={selected.type} />}
            {mode === "satellite" && (
              <div className={styles.placeholder}>
                <b>Uydu + 3D</b>
                <span>TKGM/MEGSİS parsel geometrisi ve gerçek uydu katmanı bu sekmeye bağlanacak.</span>
              </div>
            )}
          </div>

          <div className={styles.viewerTools}>
            <button onClick={() => setMode("site")}>360° proje çevresinde gezin</button>
            <button onClick={focusSelectedUnit}>Seçili daireye yaklaş</button>
            <button onClick={focusSelectedUnit}>Seçili daire: {selected.id}</button>
          </div>
        </div>

        <aside className={styles.unitPanel}>
          <div className={styles.unitPanelTop}>
            <div>
              <span>YAŞAM ALANI</span>
              <h2>{selected.id}</h2>
              <p>{selected.block} Blok · {selected.floor}. Kat · {selected.type}</p>
            </div>
            <span className={`${styles.status} ${styles[selected.status]}`}>{statusLabel[selected.status]}</span>
          </div>

          <div className={styles.areaMetric}><b>{selected.gross.toFixed(2)}</b><span>m² brüt</span></div>

          <dl className={styles.details}>
            <div><dt>Daire tipi</dt><dd>{selected.type}</dd></div>
            <div><dt>Net alan</dt><dd>{selected.net.toFixed(2)} m²</dd></div>
            <div><dt>Cephe</dt><dd>Kuzey · Batı</dd></div>
            <div><dt>Bulunduğu kat</dt><dd>{selected.floor} / 4</dd></div>
          </dl>

          <div className={styles.price}>
            <span>Anahtar teslim satış fiyatı</span>
            <b>₺{selected.price.toLocaleString("tr-TR")}</b>
          </div>

          <div className={styles.ctaRow}>
            <button>Teklif ver</button>
            <button className={styles.secondary}>Rezerve et</button>
          </div>

          <button className={styles.whatsapp}>WhatsApp & sorumlu telefonu bekleniyor</button>
          <button className={styles.linkButton} onClick={focusSelectedUnit}>Daireyi 3D modelde göster</button>
          <button className={styles.linkButton} onClick={() => setMode("inside")}>Daire içine geç</button>
        </aside>
      </section>

      <section className={styles.locationStrip}>
        <div><span>PROJENİN KONUMU</span><b>Altınova / Yalova</b></div>
        <div><span>Ada / Parsel</span><b>382 / 1</b></div>
        <div><span>Tapu alanı</span><b>19.095,17 m²</b></div>
        <div><span>Pafta</span><b>G22c07c2a</b></div>
        <button className={styles.outlineButton} onClick={() => setMode("satellite")}>Uydu görünümüne geç</button>
      </section>

      <section className={styles.inventory}>
        <div className={styles.inventoryHead}>
          <div>
            <span className={styles.eyebrow}>SATIŞA UYGUN YAŞAM BÖLÜMÜ</span>
            <h3>Daireleri keşfedin</h3>
          </div>

          <div className={styles.inventoryStats}>
            <div><b>{stats.available}</b><span>Satılık</span></div>
            <div><b>{stats.reserved}</b><span>Rezerve</span></div>
            <div><b>{stats.sold}</b><span>Satılmış</span></div>
          </div>
        </div>

        <div className={styles.filterRow}>
          {(["ALL", ...BLOCKS] as const).map(block => (
            <button
              key={block}
              onClick={() => setBlockFilter(block)}
              className={blockFilter === block ? styles.filterActive : ""}
            >
              {block === "ALL" ? "Tüm bloklar" : `${block} Blok`}
            </button>
          ))}
        </div>

        <div className={styles.unitGrid}>
          {visibleUnits.map(unit => (
            <button
              key={unit.id}
              onClick={() => setSelectedId(unit.id)}
              className={`${styles.unitCard} ${styles[unit.status]} ${selected.id === unit.id ? styles.selectedCard : ""}`}
            >
              <strong>{unit.id}</strong>
              <span>{unit.type}</span>
              <small>{unit.floor}. Kat · {unit.gross.toFixed(2)} m²</small>
              <em>{statusLabel[unit.status]}</em>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
