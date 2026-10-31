"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type LayerState = { name:string; visible:boolean };
export type PlanSelection = {
  polygon: Array<{x:number;y:number}>;
  bounds: {minX:number;minY:number;maxX:number;maxY:number};
};

export default function ProfessionalDxfViewer({
  text,
  onSelection
}:{
  text:string;
  onSelection?: (selection:PlanSelection)=>void;
}) {
  const hostRef=useRef<HTMLDivElement|null>(null);
  const viewerRef=useRef<any>(null);
  const urlRef=useRef<string|null>(null);
  const selectionEnabledRef=useRef(false);
  const scenePointsRef=useRef<Array<{x:number;y:number}>>([]);
  const drawingPointsRef=useRef<Array<{x:number;y:number}>>([]);
  const onSelectionRef=useRef(onSelection);
  onSelectionRef.current=onSelection;

  const [layers,setLayers]=useState<LayerState[]>([]);
  const [status,setStatus]=useState("CAD görüntüleyici hazırlanıyor...");
  const [progress,setProgress]=useState(0);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [viewWidth,setViewWidth]=useState<number|null>(null);
  const [selectMode,setSelectMode]=useState(false);
  const [selectionText,setSelectionText]=useState("");
  const [screenPoints,setScreenPoints]=useState<Array<{x:number;y:number}>>([]);

  useEffect(()=>{
    const host=hostRef.current;
    if(!host || !text) return;

    let disposed=false;
    let viewer:any=null;
    let handlePick:any=null;
    let handleView:any=null;

    const updateScreenPolygon=()=>{
      if(!viewer) return;
      const pts=scenePointsRef.current.map(p=>viewer.SceneToCanvasCoord(p.x,p.y));
      setScreenPoints(pts.map((p:any)=>({x:Number(p.x),y:Number(p.y)})));
    };

    (async()=>{
      try{
        const mod:any=await import("dxf-viewer");
        if(disposed || !hostRef.current) return;

        const Viewer=mod.DxfViewer;
        viewer=new Viewer(hostRef.current,{
          autoResize:true,
          clearColor:new THREE.Color(0xf8fafc),
          clearAlpha:1,
          antialias:true,
          retainParsedDxf:true,
          pointerMoveEvent:true
        });
        viewerRef.current=viewer;

        const blob=new Blob([text],{type:"text/plain"});
        const url=URL.createObjectURL(blob);
        urlRef.current=url;

        setLoading(true);
        setError("");
        setProgress(2);
        setStatus("Projeniz hazırlanıyor...");

        const fonts = [
          "https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/notosans/NotoSans%5Bwdth,wght%5D.ttf",
          "https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/notosanssymbols2/NotoSansSymbols2-Regular.ttf"
        ];

        await viewer.Load({
          url,
          fonts,
          progressCbk:(phase:string,processed:number,total:number)=>{
            const phaseBase:Record<string,number>={fetch:8,parse:24,prepare:62,font:88};
            const base=phaseBase[phase] ?? 5;
            const span=phase==="fetch"?16:phase==="parse"?38:phase==="prepare"?28:8;
            const ratio=total>0?Math.max(0,Math.min(1,processed/total)):0.15;
            const pct=Math.max(2,Math.min(96,Math.round(base+span*ratio)));
            setProgress(pct);
            const label=phase==="fetch"?"Dosya okunuyor":phase==="parse"?"Mimari çizim çözümleniyor":phase==="prepare"?"CAD geometrisi hazırlanıyor":phase==="font"?"Yazılar hazırlanıyor":"Proje hazırlanıyor";
            setStatus(`${label} · %${pct}`);
          }
        });

        if(disposed) return;

        handlePick=(ev:any)=>{
          if(!selectionEnabledRef.current) return;

          const canvas=viewer.GetCanvas?.();
          const domEvent=ev?.domEvent as PointerEvent | undefined;
          if(!canvas || !domEvent) {
            setSelectionText("Koordinat alınamadı. Tekrar deneyin.");
            return;
          }

          const rect=canvas.getBoundingClientRect();
          const localX=domEvent.clientX-rect.left;
          const localY=domEvent.clientY-rect.top;

          const sceneRaw=viewer.CanvasToSceneCoord(localX,localY);
          const scenePoint={
            x:Number(sceneRaw?.x),
            y:Number(sceneRaw?.y)
          };

          if(!Number.isFinite(scenePoint.x) || !Number.isFinite(scenePoint.y)) {
            setSelectionText("Geçerli CAD koordinatı alınamadı. Tekrar deneyin.");
            return;
          }

          const origin=viewer.GetOrigin?.() || {x:0,y:0};
          const drawingPoint={
            x:scenePoint.x+Number(origin.x||0),
            y:scenePoint.y+Number(origin.y||0)
          };

          scenePointsRef.current=[...scenePointsRef.current,scenePoint];
          drawingPointsRef.current=[...drawingPointsRef.current,drawingPoint];
          updateScreenPolygon();

          const count=drawingPointsRef.current.length;
          if(count<4){
            setSelectionText(`${count}. köşe seçildi · ${4-count} köşe kaldı`);
            return;
          }

          const polygon=drawingPointsRef.current.slice(0,4);
          const xs=polygon.map(p=>p.x), ys=polygon.map(p=>p.y);
          const bounds={
            minX:Math.min(...xs),maxX:Math.max(...xs),
            minY:Math.min(...ys),maxY:Math.max(...ys)
          };

          const width=bounds.maxX-bounds.minX;
          const height=bounds.maxY-bounds.minY;
          if(width<=1e-6 || height<=1e-6){
            scenePointsRef.current=[];
            drawingPointsRef.current=[];
            setScreenPoints([]);
            setSelectionText("Seçim alanı geçersiz. 4 farklı köşeyi yeniden seçin.");
            return;
          }

          selectionEnabledRef.current=false;
          setSelectMode(false);
          setSelectionText(`4 köşe seçildi · alan: ${width.toFixed(2)} × ${height.toFixed(2)} CAD birimi`);
          onSelectionRef.current?.({polygon,bounds});
        };

        handleView=()=>updateScreenPolygon();
        viewer.Subscribe("pointerdown",handlePick);
        viewer.Subscribe("viewChanged",handleView);
        viewer.Subscribe("resized",handleView);

        const nextLayers=Array.from(viewer.GetLayers(true) as Iterable<any>).map((l:any)=>({
          name:String(l.name),
          visible:true
        }));
        setLayers(nextLayers);

        const b=viewer.GetBounds();
        if(b){
          const w=Math.max(1,b.maxX-b.minX);
          setViewWidth(w*1.1);
          viewer.FitView(b.minX,b.maxX,b.minY,b.maxY,0.06);
        }
        setProgress(100);
        setStatus("Hazır · CAD yazıları ve Türkçe karakterler yüklendi.");
        setLoading(false);
      }catch(e){
        const msg=e instanceof Error?e.message:String(e);
        setError(msg);
        setStatus(msg);
        setLoading(false);
      }
    })();

    return ()=>{
      disposed=true;
      try{
        if(viewer && handlePick) viewer.Unsubscribe?.("pointerdown",handlePick);
        if(viewer && handleView) {
          viewer.Unsubscribe?.("viewChanged",handleView);
          viewer.Unsubscribe?.("resized",handleView);
        }
      }catch{}
      try{
        if(viewerRef.current && typeof viewerRef.current.Destroy==="function"){
          viewerRef.current.Destroy();
        }
      }catch{}
      viewerRef.current=null;
      if(urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current=null;
      if(host) host.innerHTML="";
    };
  },[text]);

  function fit(){
    const v=viewerRef.current;
    const b=v?.GetBounds?.();
    if(!v || !b) return;
    v.FitView(b.minX,b.maxX,b.minY,b.maxY,0.06);
    setViewWidth(Math.max(1,b.maxX-b.minX)*1.1);
  }

  function zoom(factor:number){
    const v=viewerRef.current;
    const b=v?.GetBounds?.();
    if(!v || !b) return;
    const current=viewWidth || Math.max(1,b.maxX-b.minX)*1.1;
    const next=Math.max(current*factor,0.001);
    const center={x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2,z:0};
    v.SetView(center,next);
    setViewWidth(next);
  }

  function toggleLayer(name:string,visible:boolean){
    const v=viewerRef.current;
    if(!v) return;
    v.ShowLayer(name,visible);
    setLayers(ls=>ls.map(l=>l.name===name?{...l,visible}:l));
  }

  function startSelection(){
    scenePointsRef.current=[];
    drawingPointsRef.current=[];
    setScreenPoints([]);
    selectionEnabledRef.current=true;
    setSelectMode(true);
    setSelectionText("1/4 · Kat planının ilk köşesine tıklayın.");
  }

  const polygonPoints=screenPoints.map(p=>`${p.x},${p.y}`).join(" ");

  return <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 230px",gap:12,minHeight:620,position:"relative"}}>
    {loading&&<div style={{
      position:"absolute",inset:0,zIndex:20,display:"grid",placeItems:"center",
      background:"rgba(6,19,31,.94)",backdropFilter:"blur(4px)",borderRadius:14
    }}>
      <div style={{width:"min(520px,82%)",textAlign:"center",color:"#fff"}}>
        <div style={{fontSize:11,letterSpacing:".22em",color:"#7fb8ff",marginBottom:8}}>EMLAK CAFE AI</div>
        <div style={{fontSize:30,fontWeight:800,marginBottom:8}}>Projeniz yükleniyor</div>
        <div style={{fontSize:13,color:"#b9cce0",marginBottom:18}}>{status}</div>
        <div style={{height:12,borderRadius:99,background:"#17304a",overflow:"hidden",border:"1px solid #315b84"}}>
          <div style={{height:"100%",width:`${progress}%`,background:"linear-gradient(90deg,#1d6eea,#62b5ff)",transition:"width .2s ease"}}/>
        </div>
        <div style={{marginTop:8,fontSize:20,fontWeight:800}}>%{progress}</div>
      </div>
    </div>}

    {error&&<div style={{
      position:"absolute",left:18,right:250,top:70,zIndex:21,padding:12,borderRadius:9,
      background:"#fff1f1",border:"1px solid #e79a9a",color:"#9b1c1c",fontSize:12
    }}>CAD görüntüleyici hatası: {error}</div>}

    <section style={{minWidth:0,border:"1px solid #cbd5e1",borderRadius:12,overflow:"hidden",background:"#f8fafc"}}>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",padding:10,borderBottom:"1px solid #dbe4ee",background:"#fff"}}>
        <button type="button" onClick={()=>zoom(0.8)} style={btn}>Yakınlaştır +</button>
        <button type="button" onClick={()=>zoom(1.25)} style={btn}>Uzaklaştır −</button>
        <button type="button" onClick={fit} style={btn}>Ekrana sığdır</button>
        <button type="button" onClick={startSelection} style={{...btn,background:selectMode?"#176be0":"#fff",color:selectMode?"#fff":"#174b86"}}>4 köşe ile plan seç</button>
        <span style={{marginLeft:"auto",fontSize:11,color:selectMode?"#176be0":"#64748b"}}>{selectionText || status}</span>
      </div>

      <div style={{position:"relative"}}>
        <div ref={hostRef} style={{width:"100%",height:570,position:"relative",overflow:"hidden",cursor:selectMode?"crosshair":"default"}}/>
        {screenPoints.length>0&&<svg style={{position:"absolute",inset:0,width:"100%",height:"570px",pointerEvents:"none",zIndex:6}}>
          {screenPoints.length>=3&&<polygon points={polygonPoints} fill="rgba(23,107,224,.18)" stroke="#176be0" strokeWidth="2"/>}
          {screenPoints.length===2&&<polyline points={polygonPoints} fill="none" stroke="#176be0" strokeWidth="2"/>}
          {screenPoints.map((p,i)=><g key={i}>
            <circle cx={p.x} cy={p.y} r="7" fill="#176be0" stroke="white" strokeWidth="2"/>
            <text x={p.x+10} y={p.y-10} fontSize="13" fontWeight="800" fill="#176be0">{i+1}</text>
          </g>)}
          {screenPoints.length===4&&<polygon points={polygonPoints} fill="url(#scanFill)" stroke="#176be0" strokeWidth="3"/>}
          <defs>
            <pattern id="scanFill" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="12" height="12" fill="rgba(23,107,224,.12)"/>
              <rect width="4" height="12" fill="rgba(89,169,255,.22)"/>
            </pattern>
          </defs>
        </svg>}
      </div>
    </section>

    <aside style={{border:"1px solid #d6e0ed",borderRadius:12,padding:12,background:"#fff",minWidth:0}}>
      <b style={{fontSize:13}}>CAD Katmanları</b>
      <div style={{fontSize:10,color:"#71839c",marginTop:4}}>Katmanı kapatınca çizimden anında gizlenir.</div>
      <div style={{marginTop:10,display:"grid",gap:5,maxHeight:555,overflow:"auto"}}>
        {layers.map(l=><label key={l.name} style={{display:"flex",gap:7,alignItems:"flex-start",fontSize:11,wordBreak:"break-word",cursor:"pointer"}}>
          <input type="checkbox" checked={l.visible} onChange={e=>toggleLayer(l.name,e.target.checked)}/>
          <span>{l.name}</span>
        </label>)}
      </div>
    </aside>
  </div>;
}

const btn:React.CSSProperties={
  border:"1px solid #aebfd3",
  background:"#fff",
  color:"#174b86",
  borderRadius:7,
  padding:"8px 11px",
  fontWeight:700,
  cursor:"pointer"
};
