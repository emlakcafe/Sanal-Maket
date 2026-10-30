"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { buildScenarios, calculatePolygonAreaSqm, type ParcelPoint, type ProjectScenario, type ZoningInput } from "@/lib/planning/parcelPlanner";
import styles from "./LandDevelopmentStudio.module.css";
import { calculateEnvelopeAreaSqm, createBuildableEnvelope } from "@/lib/zoning/buildableEnvelope";

const SatelliteParcelMap = dynamic(() => import("@/components/SatelliteParcelMap"), { ssr: false });

function parseKml(text:string): ParcelPoint[] {
  const xml = new DOMParser().parseFromString(text,"application/xml");
  const raw = Array.from(xml.getElementsByTagName("coordinates")).map(n=>n.textContent||"").join(" ");
  return raw.trim().split(/\s+/).map(t=>t.split(",")).filter(p=>p.length>=2)
    .map(p=>[Number(p[0]),Number(p[1])] as ParcelPoint)
    .filter(([lon,lat])=>Number.isFinite(lon)&&Number.isFinite(lat));
}

export default function LandDevelopmentStudio() {
  const [points,setPoints]=useState<ParcelPoint[]>([]);
  const [parcelName,setParcelName]=useState("");
  const [selected,setSelected]=useState<ProjectScenario|null>(null);
  const [input,setInput]=useState<ZoningInput>({
    parcelArea:2500,taks:.30,kaks:1.20,maxFloors:4,
    frontSetback:5,sideSetback:3,rearSetback:3,
    useType:"residential",target:"auto",avgUnitGross:105
  });

  const envelope=useMemo(()=>createBuildableEnvelope(points,{
    front:input.frontSetback,side:input.sideSetback,rear:input.rearSetback
  }),[points,input.frontSetback,input.sideSetback,input.rearSetback]);
  const envelopeArea=useMemo(()=>calculateEnvelopeAreaSqm(envelope.points),[envelope.points]);
  const effectiveInput=useMemo(()=>({...input,buildableArea:envelope.valid?envelopeArea:undefined}),[input,envelope.valid,envelopeArea]);
  const scenarios=useMemo(()=>buildScenarios(effectiveInput),[effectiveInput]);

  async function importKml(file:File|null){
    if(!file)return;
    const pts=parseKml(await file.text());
    if(pts.length<3) return;
    const area=calculatePolygonAreaSqm(pts);
    setPoints(pts); setParcelName(file.name);
    setInput(v=>({...v,parcelArea:Math.round(area)}));
  }

  function run(){
    const next=buildScenarios(effectiveInput);
    setSelected(next[0]);
  }

  function toSvgPath(source:ParcelPoint[]){
    if(source.length<3)return "";
    const all=[...points,...envelope.points];
    const lons=all.map(p=>p[0]), lats=all.map(p=>p[1]);
    const minLon=Math.min(...lons), maxLon=Math.max(...lons), minLat=Math.min(...lats), maxLat=Math.max(...lats);
    const w=Math.max(1e-9,maxLon-minLon), h=Math.max(1e-9,maxLat-minLat);
    return source.map(([lon,lat],i)=>{
      const x=30+((lon-minLon)/w)*540;
      const y=390-((lat-minLat)/h)*340;
      return `${i===0?"M":"L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ")+" Z";
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><span>EMLAK CAFE AI</span><h1>Bu arsaya ne yapılabilir?</h1><p>Parsel sınırı ve imar verilerine göre konsept proje alternatifleri.</p></div>
      <a href="/proje-sunumu">Proje sunumuna dön</a>
    </header>

    <section className={styles.grid}>
      <aside className={styles.panel}>
        <h2>1. Parsel</h2>
        <label className={styles.upload}>TKGM KML / KMZ sınırı yükle<input type="file" accept=".kml" onChange={e=>importKml(e.target.files?.[0]||null)}/></label>
        <div className={styles.metric}><span>Parsel</span><b>{parcelName||"Henüz yüklenmedi"}</b></div>
        <label>Parsel alanı (m²)<input type="number" value={input.parcelArea} onChange={e=>setInput({...input,parcelArea:+e.target.value})}/></label>

        <h2>2. İmar Durumu</h2>
        <div className={styles.two}>
          <label>TAKS<input type="number" step=".01" value={input.taks} onChange={e=>setInput({...input,taks:+e.target.value})}/></label>
          <label>KAKS / Emsal<input type="number" step=".01" value={input.kaks} onChange={e=>setInput({...input,kaks:+e.target.value})}/></label>
          <label>Max kat<input type="number" value={input.maxFloors} onChange={e=>setInput({...input,maxFloors:+e.target.value})}/></label>
          <label>Ort. daire brüt m²<input type="number" value={input.avgUnitGross} onChange={e=>setInput({...input,avgUnitGross:+e.target.value})}/></label>
          <label>Ön çekme<input type="number" value={input.frontSetback} onChange={e=>setInput({...input,frontSetback:+e.target.value})}/></label>
          <label>Yan çekme<input type="number" value={input.sideSetback} onChange={e=>setInput({...input,sideSetback:+e.target.value})}/></label>
          <label>Arka çekme<input type="number" value={input.rearSetback} onChange={e=>setInput({...input,rearSetback:+e.target.value})}/></label>
          <label>Hedef
            <select value={input.target} onChange={e=>setInput({...input,target:e.target.value as ZoningInput["target"]})}>
              <option value="auto">AI karar versin</option><option value="villa">Villa</option><option value="apartment">Apartman</option><option value="site">Site</option>
            </select>
          </label>
        </div>

        <button className={styles.primary} onClick={run}>Bu arsaya ne yapılabilir?</button>
      </aside>

      <section className={styles.results}>
        <div className={styles.summary}>
          <div><span>Parsel</span><b>{input.parcelArea.toLocaleString("tr-TR")} m²</b></div>
          <div><span>Max taban</span><b>{Math.round(input.parcelArea*input.taks).toLocaleString("tr-TR")} m²</b></div>
          <div><span>Emsal alan</span><b>{Math.round(input.parcelArea*input.kaks).toLocaleString("tr-TR")} m²</b></div>
          <div><span>Kat</span><b>{input.maxFloors}</b></div>
          <div><span>Yapılaşabilir alan</span><b>{envelope.valid?Math.round(envelopeArea).toLocaleString("tr-TR")+" m²":"—"}</b></div>
        </div>

        <div className={styles.cards}>
          {scenarios.map(s=><button key={s.id} onClick={()=>setSelected(s)} className={selected?.id===s.id?styles.active:""}>
            <span>{s.score}/100</span><h3>{s.title}</h3><p>{s.description}</p>
            <div>{s.blocks} blok/yapı · {s.estimatedUnits} bağımsız bölüm · {s.parking} otopark</div>
          </button>)}
        </div>

        {points.length>2&&<div className={styles.satelliteCard}>
          <div className={styles.envelopeHead}>
            <div><span>UYDU + PARSEL</span><h3>Uydu görüntüsü üzerinde gerçek parsel</h3></div>
            <div><b>Esri</b><span>World Imagery</span></div>
          </div>
          <SatelliteParcelMap parcel={points} buildable={envelope.valid?envelope.points:[]} />
          <div className={styles.legend}>
            <span><i className={styles.redDot}/>TKGM parsel sınırı</span>
            <span><i className={styles.blueDot}/>Yapılaşabilir alan</span>
          </div>
          <p className={styles.warning}>Bu görüntü gerçek zamanlı canlı kamera değildir; uydu/hava görüntüsü sağlayıcısının mevcut görüntü katmanıdır.</p>
        </div>}

        {points.length>2&&<div className={styles.envelopeCard}>
          <div className={styles.envelopeHead}>
            <div><span>İMAR GEOMETRİSİ</span><h3>Parsel + Buildable Envelope</h3></div>
            <div><b>{envelope.setbackMeters} m</b><span>korumalı çekme</span></div>
          </div>
          <svg viewBox="0 0 600 420" className={styles.envelopeSvg}>
            <path d={toSvgPath(points)} className={styles.parcelShape}/>
            {envelope.valid&&<path d={toSvgPath(envelope.points)} className={styles.buildableShape}/>}
          </svg>
          <div className={styles.legend}>
            <span><i className={styles.redDot}/>Parsel sınırı</span>
            <span><i className={styles.blueDot}/>Yapılaşabilir alan</span>
          </div>
          {envelope.warning&&<p className={styles.warning}>{envelope.warning}</p>}
        </div>}

        <div className={styles.visual}>
          {selected ? <>
            <div className={styles.plan}>
              <div className={styles.boundary}>
                {Array.from({length:selected.blocks}).map((_,i)=><div key={i} className={styles.block} style={{
                  left:(12+(i%4)*21)+"%", top:(12+Math.floor(i/4)*30)+"%",
                  width:selected.id==="villa"?"12%":"17%", height:selected.id==="villa"?"18%":"24%"
                }}>{selected.id==="villa"?"V":"B"}{i+1}</div>)}
                {selected.poolArea>0&&<div className={styles.pool}>HAVUZ</div>}
                {selected.sportsArea>0&&<div className={styles.sports}>SPOR</div>}
                <div className={styles.road}>ARAÇ / YAYA ROTASI</div>
              </div>
            </div>
            <div className={styles.detail}>
              <h2>Emlak Cafe AI Önerisi</h2>
              <h3>{selected.title}</h3>
              <dl>
                <div><dt>Toplam inşaat</dt><dd>{Math.round(selected.grossConstruction).toLocaleString("tr-TR")} m²</dd></div>
                <div><dt>Tahmini bağımsız bölüm</dt><dd>{selected.estimatedUnits}</dd></div>
                <div><dt>Blok / yapı</dt><dd>{selected.blocks}</dd></div>
                <div><dt>Otopark</dt><dd>{selected.parking}</dd></div>
                <div><dt>Yeşil alan</dt><dd>{selected.greenArea} m²</dd></div>
                <div><dt>Sosyal alan</dt><dd>{selected.socialArea} m²</dd></div>
                <div><dt>Havuz</dt><dd>{selected.poolArea} m²</dd></div>
                <div><dt>Spor</dt><dd>{selected.sportsArea} m²</dd></div>
              </dl>
              <ul>{selected.notes.map(n=><li key={n}>{n}</li>)}</ul>
              <small>Konsept fizibilite çıktısıdır. Ruhsat/proje uygulaması için resmi imar durumu, plan notları ve yetkili mimari proje doğrulaması gerekir.</small>
            </div>
          </>:<div className={styles.empty}>Bir senaryo seçin veya “Bu arsaya ne yapılabilir?” butonuna basın.</div>}
        </div>
      </section>
    </section>
  </main>
}
