"use client";

import { useMemo, useState } from "react";
import Viewer3D from "@/components/Viewer3D";
import ParcelPanel, { type ParcelForm } from "@/components/ParcelPanel";
import ProjectSettings, { type ProjectSettingsValue } from "@/components/ProjectSettings";
import type { FloorplanExtraction } from "@/lib/geometry/types";

type AssetKind = "floorplan" | "facade" | "interior" | "siteplan" | "other";
type AssetItem = { id: string; file: File; kind: AssetKind };
type RoomMetric = { id: number; area: number };

const labels: Record<AssetKind, string> = {
  floorplan: "Kat Planı", facade: "Cephe", interior: "İç Mekan", siteplan: "Vaziyet Planı", other: "Diğer"
};

export default function HomePage() {
  const [projectName, setProjectName] = useState("Yeni Proje");
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Dosyaları yükleyin");
  const [error, setError] = useState("");
  const [modelData, setModelData] = useState<FloorplanExtraction | null>(null);
  const [rooms, setRooms] = useState<RoomMetric[]>([]);
  const [settings, setSettings] = useState<ProjectSettingsValue>({
    longSideMeters: 12,
    floorHeight: 2.8,
    roofType: "gable",
    roofPitch: 28,
    eyeHeight: 1.65
  });
  const [parcel, setParcel] = useState<ParcelForm>({
    city: "", district: "", neighborhood: "", block: "", parcel: ""
  });

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
    const incoming = Array.from(list).map(file => ({ id: crypto.randomUUID(), file, kind: inferKind(file) }));
    setAssets(prev => [...prev, ...incoming]);
    setProgress(0); setModelData(null); setRooms([]); setError("");
    setStatusText("Gerçek geometri üretimi için SVG kat planını seçin");
  }

  async function runPipeline() {
    if (!svgFloorplan || running) return;
    setRunning(true); setError(""); setModelData(null); setRooms([]);
    try {
      setProgress(10); setStatusText("Kat planı geometri motoruna gönderiliyor");
      const formData = new FormData(); formData.append("file", svgFloorplan.file);
      setProgress(30); setStatusText("AI duvar, kapı, pencere ve zemin alanlarını ayırıyor");
      const response = await fetch("/api/geometry/extract", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail || payload?.error || "Geometri üretilemedi.");
      setProgress(75); setStatusText("Ölçek, çatı ve mimari elemanlar oluşturuluyor");
      setModelData(payload as FloorplanExtraction);
      await new Promise(resolve => setTimeout(resolve, 250));
      setProgress(100); setStatusText("Gezilebilir mimari model hazır");
    } catch (err) {
      setProgress(0); setStatusText("İşlem durdu");
      setError(err instanceof Error ? err.message : String(err));
    } finally { setRunning(false); }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">EMLAK CAFE</span>
          <h1>AI Sanal Maket Stüdyosu</h1>
          <p>Parselden mimari modele; ölçülü, gezilebilir ve sunuma hazır proje stüdyosu.</p>
        </div>
        <div className="statusBadge">v0.6 • Proje + Parsel + Walk</div>
      </header>

      <section className="workspaceGrid">
        <div className="leftStack">
          <section className="panel formPanel">
            <label className="fieldLabel">Proje adı</label>
            <input value={projectName} onChange={e => setProjectName(e.target.value)} className="input" />

            <label className="dropzone">
              <input type="file" multiple accept=".svg,.png,.jpg,.jpeg,.webp,.pdf,.dwg,.dxf,.glb,.gltf,.obj" onChange={e => addFiles(e.target.files)} />
              <strong>Dosyaları buraya yükle</strong>
              <span>Kat planı, vaziyet planı, cephe ve iç mekan renderları</span>
            </label>

            <div className="stats">
              <div><b>{stats.floorplan}</b><span>Kat planı</span></div>
              <div><b>{stats.facade}</b><span>Cephe</span></div>
              <div><b>{stats.interior}</b><span>İç mekan</span></div>
            </div>

            <div className="assetList">
              {assets.map(asset => (
                <div className="assetRow" key={asset.id}>
                  <div className="assetName"><strong>{asset.file.name}</strong><span>{Math.round(asset.file.size / 1024)} KB</span></div>
                  <select value={asset.kind} onChange={e => {
                    const kind = e.target.value as AssetKind;
                    setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, kind } : a));
                  }}>
                    {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <button className="ghostButton" onClick={() => setAssets(prev => prev.filter(a => a.id !== asset.id))}>Sil</button>
                </div>
              ))}
            </div>

            {!svgFloorplan && assets.length > 0 && <div className="notice">Gerçek geometri motorunun bu sürümünde ana kat planı için <b>SVG</b> gerekiyor.</div>}
            {error && <div className="errorBox">{error}</div>}

            <button className="primaryButton" disabled={!svgFloorplan || running} onClick={runPipeline}>
              {running ? "Proje hazırlanıyor..." : "Proje Modelini Oluştur"}
            </button>

            <div className="pipeline">
              <div className="progressTrack"><div className="progressFill" style={{ width: progress + "%" }} /></div>
              <div className="pipelineText"><strong>{progress}%</strong><span>{statusText}</span></div>
            </div>
          </section>

          <ProjectSettings value={settings} onChange={setSettings} />

          <section className="roomPanel">
            <div className="sectionHeading"><div><span className="eyebrow">ODA ANALİZİ</span><h3>Yaklaşık Oda m²</h3></div></div>
            {rooms.length ? (
              <div className="roomGrid">
                {rooms.map(room => <div key={room.id} className="roomCard"><strong>Alan {room.id}</strong><b>{room.area.toFixed(1)} m²</b></div>)}
              </div>
            ) : <div className="emptyState">Zemin segmentasyonu bulunan planlarda oda/alan m² değerleri burada listelenir.</div>}
          </section>

          <ParcelPanel value={parcel} onChange={setParcel} />
        </div>

        <div className="panel viewerPanel">
          <div className="viewerHeader">
            <div><span className="eyebrow">3B PROJE STÜDYOSU</span><h2>{projectName || "Proje"}</h2></div>
            <span className={modelData ? "ready" : "waiting"}>{modelData ? "Gezilebilir model" : "Plan bekleniyor"}</span>
          </div>
          <Viewer3D data={modelData} settings={settings} onRoomMetrics={setRooms} />
        </div>
      </section>

      <section className="engineStrip">
        <div><span>01</span><strong>Parsel + Konum</strong><p>İl/ilçe/mahalle/ada/parsel ve uydu görünümü; TKGM adaptörü hazır.</p></div>
        <div><span>02</span><strong>Ölçülü Mimari Model</strong><p>Kat yüksekliği, çatı, kapı/pencere, gerçek ölçek ve yaklaşık m² analizi.</p></div>
        <div><span>03</span><strong>Walk Mode</strong><p>Modelin içine girin; fare ile bakın, W A S D ile odalar arasında gezin.</p></div>
      </section>
    </main>
  );
}
