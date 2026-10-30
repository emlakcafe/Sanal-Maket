"use client";

import { useMemo, useState } from "react";
import Viewer3D from "@/components/Viewer3D";
import type { FloorplanExtraction } from "@/lib/geometry/types";

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

export default function HomePage() {
  const [projectName, setProjectName] = useState("Yeni Proje");
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Dosyaları yükleyin");
  const [error, setError] = useState("");
  const [modelData, setModelData] = useState<FloorplanExtraction | null>(null);

  const stats = useMemo(() => ({
    floorplan: assets.filter(a => a.kind === "floorplan").length,
    facade: assets.filter(a => a.kind === "facade").length,
    interior: assets.filter(a => a.kind === "interior").length
  }), [assets]);

  const svgFloorplan = useMemo(
    () => assets.find(a => a.kind === "floorplan" && a.file.name.toLowerCase().endsWith(".svg")),
    [assets]
  );

  function inferKind(file: File): AssetKind {
    const n = file.name.toLocaleLowerCase("tr");
    if (n.endsWith(".svg") || /(kat|plan|floor|zemin|bodrum|çatı|cati)/.test(n)) return "floorplan";
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
    setProgress(0);
    setModelData(null);
    setError("");
    setStatusText("Gerçek geometri üretimi için SVG kat planını seçin");
  }

  async function runPipeline() {
    if (!svgFloorplan || running) return;

    setRunning(true);
    setError("");
    setModelData(null);

    try {
      setProgress(10);
      setStatusText("Kat planı geometri motoruna gönderiliyor");

      const formData = new FormData();
      formData.append("file", svgFloorplan.file);

      setProgress(30);
      setStatusText("AI duvar, kapı ve pencereleri ayırıyor");

      const response = await fetch("/api/geometry/extract", {
        method: "POST",
        body: formData
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.detail || payload?.error || "Geometri üretilemedi.");
      }

      setProgress(75);
      setStatusText("Poligonlar gerçek 3B geometriye dönüştürülüyor");
      setModelData(payload as FloorplanExtraction);

      await new Promise(resolve => setTimeout(resolve, 300));
      setProgress(100);
      setStatusText("Gerçek kat planı 3B önizlemesi hazır");
    } catch (err) {
      setProgress(0);
      setStatusText("İşlem durdu");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">EMLAK CAFE</span>
          <h1>AI Sanal Maket Stüdyosu</h1>
          <p>Kat planı, cephe ve iç mekan renderlarını tek projede birleştirin.</p>
        </div>
        <div className="statusBadge">v0.4 • Mimari Sunum Modu</div>
      </header>

      <section className="grid">
        <div className="panel formPanel">
          <label className="fieldLabel">Proje adı</label>
          <input value={projectName} onChange={e => setProjectName(e.target.value)} className="input" />

          <label className="dropzone">
            <input
              type="file"
              multiple
              accept=".svg,.png,.jpg,.jpeg,.webp,.pdf,.dwg,.dxf,.glb,.gltf,.obj"
              onChange={e => addFiles(e.target.files)}
            />
            <strong>Dosyaları buraya yükle</strong>
            <span>Gerçek geometri testi için önce SVG kat planı yükleyin</span>
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
                <button className="ghostButton" onClick={() => setAssets(prev => prev.filter(a => a.id !== asset.id))}>
                  Sil
                </button>
              </div>
            ))}
          </div>

          {!svgFloorplan && assets.length > 0 && (
            <div className="notice">
              Gerçek motorun bu ilk sürümü için bir <b>SVG kat planı</b> gerekiyor. PNG/PDF desteğini sıradaki aşamada ekleyeceğiz.
            </div>
          )}

          {error && <div className="errorBox">{error}</div>}

          <button className="primaryButton" disabled={!svgFloorplan || running} onClick={runPipeline}>
            {running ? "Gerçek model hazırlanıyor..." : "Gerçek Kat Planından 3B Oluştur"}
          </button>

          <div className="pipeline">
            <div className="progressTrack">
              <div className="progressFill" style={{ width: progress + "%" }} />
            </div>
            <div className="pipelineText">
              <strong>{progress}%</strong>
              <span>{statusText}</span>
            </div>
          </div>
        </div>

        <div className="panel viewerPanel">
          <div className="viewerHeader">
            <div>
              <span className="eyebrow">3B ÖNİZLEME</span>
              <h2>{projectName || "Proje"}</h2>
            </div>
            <span className={modelData ? "ready" : "waiting"}>
              {modelData ? "Gerçek model" : "Plan bekleniyor"}
            </span>
          </div>
          <Viewer3D data={modelData} />
        </div>
      </section>

      <section className="engineStrip">
        <div>
          <span>01</span>
          <strong>ResNet-UNet Geometri</strong>
          <p>SVG plandan duvar, kapı ve pencere poligonlarını çıkarır.</p>
        </div>
        <div>
          <span>02</span>
          <strong>Mimari Sunum Motoru</strong>
          <p>Sunum/teknik görünüm, iyileştirilmiş ışık, malzeme ve sahne kalitesi.</p>
        </div>
        <div>
          <span>03</span>
          <strong>Sıradaki Aşama</strong>
          <p>PNG/PDF dönüştürme, cephe referansı ve PBR malzeme.</p>
        </div>
      </section>
    </main>
  );
}
