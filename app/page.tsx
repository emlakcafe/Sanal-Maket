"use client";

import { useMemo, useState } from "react";
import Viewer3D from "@/components/Viewer3D";

type AssetKind = "floorplan" | "facade" | "interior" | "siteplan" | "other";

type AssetItem = {
  id: string;
  file: File;
  kind: AssetKind;
};

const labels: Record<AssetKind, string> = {
  floorplan: "Kat Planı",
  facade: "Cephe",
  interior: "İç Mekan",
  siteplan: "Vaziyet Planı",
  other: "Diğer"
};

const steps = [
  "Dosyalar analiz ediliyor",
  "Kat planı geometrisi çıkarılıyor",
  "Cepheler eşleştiriliyor",
  "Malzemeler hazırlanıyor",
  "3B model birleştiriliyor",
  "Kalite kontrolü yapılıyor"
];

export default function HomePage() {
  const [projectName, setProjectName] = useState("Yeni Proje");
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeStep, setActiveStep] = useState(0);

  const stats = useMemo(() => ({
    floorplan: assets.filter(a => a.kind === "floorplan").length,
    facade: assets.filter(a => a.kind === "facade").length,
    interior: assets.filter(a => a.kind === "interior").length
  }), [assets]);

  function inferKind(file: File): AssetKind {
    const n = file.name.toLocaleLowerCase("tr");
    if (/(kat|plan|floor|zemin|bodrum|çatı|cati)/.test(n)) return "floorplan";
    if (/(cephe|facade|ön|on|arka|sağ|sag|sol)/.test(n)) return "facade";
    if (/(iç|ic|interior|salon|mutfak|yatak|banyo)/.test(n)) return "interior";
    if (/(vaziyet|site)/.test(n)) return "siteplan";
    return "other";
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list).map(file => ({
      id: crypto.randomUUID(),
      file,
      kind: inferKind(file)
    }));
    setAssets(prev => [...prev, ...incoming]);
  }

  async function runPipeline() {
    if (!assets.length || running) return;
    setRunning(true);
    setProgress(0);
    for (let i = 0; i < steps.length; i++) {
      setActiveStep(i);
      await new Promise(resolve => setTimeout(resolve, 650));
      setProgress(Math.round(((i + 1) / steps.length) * 100));
    }
    setRunning(false);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">EMLAK CAFE</span>
          <h1>AI Sanal Maket Stüdyosu</h1>
          <p>Kat planı, cephe ve iç mekan renderlarını tek projede birleştirin.</p>
        </div>
        <div className="statusBadge">v0.1 • Hibrit 3B Motor</div>
      </header>

      <section className="grid">
        <div className="panel formPanel">
          <label className="fieldLabel">Proje adı</label>
          <input value={projectName} onChange={e => setProjectName(e.target.value)} className="input" />

          <label className="dropzone">
            <input
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.webp,.pdf,.dwg,.dxf,.glb,.gltf,.obj"
              onChange={e => addFiles(e.target.files)}
            />
            <strong>Dosyaları buraya yükle</strong>
            <span>Kat planı, vaziyet planı, dış cephe ve iç mekan renderları</span>
          </label>

          <div className="stats">
            <div><b>{stats.floorplan}</b><span>Kat planı</span></div>
            <div><b>{stats.facade}</b><span>Cephe</span></div>
            <div><b>{stats.interior}</b><span>İç mekan</span></div>
          </div>

          <div className="assetList">
            {assets.map(asset => (
              <div className="assetRow" key={asset.id}>
                <div className="assetName">
                  <strong>{asset.file.name}</strong>
                  <span>{Math.round(asset.file.size / 1024)} KB</span>
                </div>
                <select
                  value={asset.kind}
                  onChange={e => {
                    const kind = e.target.value as AssetKind;
                    setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, kind } : a));
                  }}
                >
                  {Object.entries(labels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <button
                  className="ghostButton"
                  onClick={() => setAssets(prev => prev.filter(a => a.id !== asset.id))}
                >
                  Sil
                </button>
              </div>
            ))}
          </div>

          <button className="primaryButton" disabled={!assets.length || running} onClick={runPipeline}>
            {running ? "Sanal maket hazırlanıyor..." : "AI ile Sanal Maket Oluştur"}
          </button>

          <div className="pipeline">
            <div className="progressTrack">
              <div className="progressFill" style={{ width: progress + "%" }} />
            </div>
            <div className="pipelineText">
              <strong>{progress}%</strong>
              <span>{running ? steps[activeStep] : progress === 100 ? "Önizleme hazır" : "Dosyaları yükleyin"}</span>
            </div>
          </div>
        </div>

        <div className="panel viewerPanel">
          <div className="viewerHeader">
            <div>
              <span className="eyebrow">3B ÖNİZLEME</span>
              <h2>{projectName || "Proje"}</h2>
            </div>
            <span className={progress === 100 ? "ready" : "waiting"}>
              {progress === 100 ? "Hazır" : "Taslak"}
            </span>
          </div>
          <Viewer3D ready={progress === 100} />
        </div>
      </section>

      <section className="engineStrip">
        <div>
          <span>01</span>
          <strong>Geometri Motoru</strong>
          <p>Kat planı → duvar, kapı, pencere ve kat hacmi.</p>
        </div>
        <div>
          <span>02</span>
          <strong>Referans Motoru</strong>
          <p>Cephe ve iç mekan görsellerini mimari modele bağlar.</p>
        </div>
        <div>
          <span>03</span>
          <strong>Kalite Kontrol</strong>
          <p>Plan, cephe ve ölçek tutarlılığını doğrular.</p>
        </div>
      </section>
    </main>
  );
}
