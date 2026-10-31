"use client";

import { useEffect, useRef, useState } from "react";

type LayerState = { name:string; visible:boolean };

export default function ProfessionalDxfViewer({ text }:{ text:string }) {
  const hostRef=useRef<HTMLDivElement|null>(null);
  const viewerRef=useRef<any>(null);
  const urlRef=useRef<string|null>(null);
  const [layers,setLayers]=useState<LayerState[]>([]);
  const [status,setStatus]=useState("CAD görüntüleyici hazırlanıyor...");
  const [viewWidth,setViewWidth]=useState<number|null>(null);

  useEffect(()=>{
    const host=hostRef.current;
    if(!host || !text) return;

    let disposed=false;

    (async()=>{
      try{
        const mod:any=await import("dxf-viewer");
        if(disposed || !hostRef.current) return;

        const Viewer=mod.DxfViewer;
        const viewer=new Viewer(hostRef.current,{
          autoResize:true,
          clearColor:0xf8fafc,
          clearAlpha:1,
          antialias:true,
          retainParsedDxf:true,
          pointerMoveEvent:true
        });
        viewerRef.current=viewer;

        const blob=new Blob([text],{type:"text/plain"});
        const url=URL.createObjectURL(blob);
        urlRef.current=url;

        setStatus("DXF çizimi hazırlanıyor...");
        await viewer.Load({
          url,
          fonts:[],
          progressCbk:(phase:string,processed:number,total:number)=>{
            if(total>0){
              setStatus(`${phase}: %${Math.min(100,Math.round(processed/total*100))}`);
            }else{
              setStatus(phase);
            }
          }
        });

        if(disposed) return;

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
        setStatus("Hazır · tekerlek ile yakınlaştır, sürükleyerek gez.");
      }catch(e){
        setStatus(e instanceof Error?e.message:String(e));
      }
    })();

    return ()=>{
      disposed=true;
      try{ viewerRef.current?.Destroy?.(); }catch{}
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

  return <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 230px",gap:12,minHeight:620}}>
    <section style={{minWidth:0,border:"1px solid #cbd5e1",borderRadius:12,overflow:"hidden",background:"#f8fafc"}}>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",padding:10,borderBottom:"1px solid #dbe4ee",background:"#fff"}}>
        <button type="button" onClick={()=>zoom(0.8)} style={btn}>Yakınlaştır +</button>
        <button type="button" onClick={()=>zoom(1.25)} style={btn}>Uzaklaştır −</button>
        <button type="button" onClick={fit} style={btn}>Ekrana sığdır</button>
        <span style={{marginLeft:"auto",fontSize:11,color:"#64748b"}}>{status}</span>
      </div>
      <div ref={hostRef} style={{width:"100%",height:570,position:"relative",overflow:"hidden"}}/>
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
