"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import styles from "./ProjectShowcase.module.css";

type UnitStatus = "available" | "reserved" | "sold";
type Unit = {
  id: string;
  block: "A" | "B" | "C" | "D";
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

function buildUnits(): Unit[] {
  const blocks = ["A", "B", "C", "D"] as const;
  const units: Unit[] = [];
  let index = 0;
  for (const block of blocks) {
    for (let floor = 1; floor <= 5; floor++) {
      for (let number = 1; number <= 4; number++) {
        const type = number === 1 ? "1+1" : number === 4 ? "3+1" : "2+1";
        const gross = type === "1+1" ? 74.7 : type === "2+1" ? 104.56 : 129.12;
        const status: UnitStatus = index % 8 === 2 ? "reserved" : index % 11 === 5 ? "sold" : "available";
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

function ProjectScene({
  selectedId,
  units,
  onSelect
}: {
  selectedId: string;
  units: Unit[];
  onSelect: (id: string) => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdce8ef);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    camera.position.set(22, 15, 28);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 4.5, 0);
    controls.minDistance = 12;
    controls.maxDistance = 55;
    controls.maxPolarAngle = Math.PI / 2.05;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x6a7a63, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 3.2);
    sun.position.set(15, 24, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(38, 0.35, 26),
      new THREE.MeshStandardMaterial({ color: 0x466542, roughness: 1 })
    );
    ground.position.y = -0.25;
    ground.receiveShadow = true;
    scene.add(ground);

    const pathMaterial = new THREE.MeshStandardMaterial({ color: 0xb7b3aa, roughness: 0.95 });
    const path = new THREE.Mesh(new THREE.BoxGeometry(9, 0.12, 23), pathMaterial);
    path.position.set(0, 0, 0);
    path.receiveShadow = true;
    scene.add(path);

    const pool = new THREE.Mesh(
      new THREE.BoxGeometry(7.6, 0.12, 4.6),
      new THREE.MeshPhysicalMaterial({ color: 0x60bfe8, roughness: 0.18, metalness: 0.05 })
    );
    pool.position.set(0, 0.08, -4.4);
    scene.add(pool);

    const blockPositions: Record<string, THREE.Vector3> = {
      A: new THREE.Vector3(-11, 0, 5),
      B: new THREE.Vector3(11, 0, 5),
      C: new THREE.Vector3(-11, 0, -7),
      D: new THREE.Vector3(11, 0, -7)
    };

    const clickable: THREE.Mesh[] = [];
    const unitMesh = new Map<string, THREE.Mesh>();

    const facadeMaterial = new THREE.MeshStandardMaterial({ color: 0xe8e1d3, roughness: 0.76 });
    const slabMaterial = new THREE.MeshStandardMaterial({ color: 0xd6d1c8, roughness: 0.9 });
    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xa9c9d4,
      transparent: true,
      opacity: 0.76,
      roughness: 0.2,
      metalness: 0.08
    });
    const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x8c694c, roughness: 0.8 });

    for (const block of ["A", "B", "C", "D"] as const) {
      const origin = blockPositions[block];
      const root = new THREE.Group();
      root.position.copy(origin);
      scene.add(root);

      const core = new THREE.Mesh(new THREE.BoxGeometry(8.4, 14.1, 5.3), facadeMaterial);
      core.position.y = 7.05;
      core.castShadow = true;
      core.receiveShadow = true;
      root.add(core);

      for (let floor = 1; floor <= 5; floor++) {
        const y = (floor - 1) * 2.75 + 1.45;
        const slab = new THREE.Mesh(new THREE.BoxGeometry(8.9, 0.14, 5.7), slabMaterial);
        slab.position.y = y - 1.35;
        root.add(slab);

        for (let col = 0; col < 4; col++) {
          const unit = units.find(u => u.block === block && u.floor === floor && u.number === col + 1);
          if (!unit) continue;
          const x = -3.05 + col * 2.05;
          const z = block === "A" || block === "B" ? 2.73 : -2.73;

          const highlight = new THREE.Mesh(
            new THREE.BoxGeometry(1.78, 2.18, 0.16),
            new THREE.MeshStandardMaterial({
              color: unit.status === "sold" ? 0xc5cbd2 : unit.status === "reserved" ? 0xe9b64d : 0xf7f9fb,
              emissive: 0x000000,
              roughness: 0.45,
              transparent: true,
              opacity: unit.status === "available" ? 0.88 : 0.95
            })
          );
          highlight.position.set(x, y, z);
          highlight.userData.unitId = unit.id;
          root.add(highlight);
          clickable.push(highlight);
          unitMesh.set(unit.id, highlight);

          const glass = new THREE.Mesh(new THREE.BoxGeometry(1.42, 1.6, 0.12), glassMaterial);
          glass.position.set(x, y, z + (z > 0 ? 0.11 : -0.11));
          root.add(glass);

          const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.28, 0.34), woodMaterial);
          fin.position.set(x - 0.9, y, z + (z > 0 ? 0.18 : -0.18));
          root.add(fin);
        }
      }
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
          mat.opacity = unit.status === "available" ? 0.88 : 0.95;
        }
      }
    };
    updateHighlight();

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
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    onResize();

    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    let frame = 0;
    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      renderer.dispose();
      mount.innerHTML = "";
    };
  }, [selectedId, units, onSelect]);

  return <div ref={mountRef} className={styles.scene} />;
}

export default function ProjectShowcase() {
  const units = useMemo(() => buildUnits(), []);
  const [selectedId, setSelectedId] = useState("A-06");
  const [mode, setMode] = useState<"render" | "site" | "satellite" | "floor" | "inside">("site");
  const [blockFilter, setBlockFilter] = useState<"ALL" | "A" | "B" | "C" | "D">("ALL");
  const selected = units.find(u => u.id === selectedId) || units[0];
  const visibleUnits = blockFilter === "ALL" ? units : units.filter(u => u.block === blockFilter);

  const stats = units.reduce(
    (acc, u) => {
      acc[u.status]++;
      return acc;
    },
    { available: 0, reserved: 0, sold: 0 } as Record<UnitStatus, number>
  );

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}><span>ec.</span><b>emlak cafe</b></div>
        <div className={styles.kicker}>INTERAKTİF 360° PROJE TANITIMI</div>
        <button className={styles.outlineButton}>Proje stüdyosuna dön</button>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>YALOVA · AKKÖY · KURUMSAL PROJE</p>
          <h1>Emlak Cafe <span>Residence</span></h1>
          <p className={styles.subtitle}>Bağ bahçe, havuz başında bir yaşam. Site içi 3B gezinti, daire seçimi ve sunum ekranı.</p>
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
              <button key={key} onClick={() => setMode(key as typeof mode)} className={mode === key ? styles.activeTab : ""}>{label}</button>
            ))}
          </div>

          <div className={styles.viewerStage}>
            {mode === "site" ? (
              <ProjectScene selectedId={selected.id} units={units} onSelect={setSelectedId} />
            ) : (
              <div className={styles.placeholder}>
                <b>{mode === "render" ? "Mimari Render" : mode === "satellite" ? "Uydu + 3D" : mode === "floor" ? "3D Kat Planı" : "Daire İçi 360"}</b>
                <span>Bu sekmenin veri bağlantısı bir sonraki aşamada aktif edilecek.</span>
              </div>
            )}
          </div>

          <div className={styles.viewerTools}>
            <button>360° çevresinde sürükle</button>
            <button>Yakınlaştır / uzaklaştır</button>
            <button>Seçili daire: {selected.id}</button>
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
            <div><dt>Bulunduğu kat</dt><dd>{selected.floor} / 5</dd></div>
          </dl>

          <div className={styles.price}><span>Anahtar teslim satış fiyatı</span><b>₺{selected.price.toLocaleString("tr-TR")}</b></div>
          <div className={styles.ctaRow}><button>Teklif ver</button><button className={styles.secondary}>Rezerve et</button></div>
          <button className={styles.whatsapp}>WhatsApp & sorumlu telefonu bekleniyor</button>
          <button className={styles.linkButton}>Daireyi 3D modelde göster</button>
          <button className={styles.linkButton}>Daireye git</button>
        </aside>
      </section>

      <section className={styles.locationStrip}>
        <div><span>PROJENİN KONUMU</span><b>Altınova / Yalova</b></div>
        <div><span>Ada / Parsel</span><b>382 / 1</b></div>
        <div><span>Tapu alanı</span><b>19.095,17 m²</b></div>
        <div><span>Pafta</span><b>G22c07c2a</b></div>
        <button className={styles.outlineButton}>Uydu görünümüne geç</button>
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
          {(["ALL", "A", "B", "C", "D"] as const).map(block => (
            <button key={block} onClick={() => setBlockFilter(block)} className={blockFilter === block ? styles.filterActive : ""}>
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
