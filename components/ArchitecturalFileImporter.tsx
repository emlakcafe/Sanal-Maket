"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ACCEPTED_ARCHITECTURAL_EXTENSIONS, CAD_FORMATS, getCadFormat } from "@/lib/cad/formats";

const ThreeFilePreview = dynamic(
  () => import("@/components/Architectural3DPreview").then(m => m.ThreeFilePreview),
  { ssr: false }
);

type Pt = { x:number; y:number };
type DxfShape =
  | { kind:"line"; a:Pt; b:Pt; layer:string }
  | { kind:"poly"; pts:Pt[]; closed:boolean; layer:string }
  | { kind:"circle"; c:Pt; r:number; layer:string };

function colorForLayer(layer:string) {
  let hash = 0;
  for (let i=0;i<layer.length;i++) hash=(hash*31+layer.charCodeAt(i))>>>0;
  const hue = hash % 360;
  return `hsl(${hue} 55% 42%)`;
}

async function parseDxf(text:string) {
  const mod = await import("dxf-parser");
  const Parser:any = (mod as any).default || (mod as any).DxfParser || mod;
  const parser = new Parser();
  const doc:any = parser.parseSync(text);
  const shapes:DxfShape[] = [];
  const layers = new Set<string>();

  const vertex=(v:any):Pt=>({x:Number(v?.x||0),y:Number(v?.y||0)});
  for(const e of doc?.entities || []) {
    const layer=String(e.layer || "0");
    layers.add(layer);
    if(e.type==="LINE") {
      const vs=e.vertices || [];
      if(vs.length>=2) shapes.push({kind:"line",a:vertex(vs[0]),b:vertex(vs[1]),layer});
    } else if(e.type==="LWPOLYLINE" || e.type==="POLYLINE") {
      const pts=(e.vertices||[]).map(vertex);
      if(pts.length>=2) shapes.push({kind:"poly",pts,closed:Boolean(e.shape||e.closed),layer});
    } else if(e.type==="CIRCLE") {
      shapes.push({kind:"circle",c:vertex(e.center),r:Number(e.radius||0),layer});
    } else if(e.type==="ARC") {
      const start=Number(e.startAngle||0), end=Number(e.endAngle||0);
      const center=vertex(e.center), r=Number(e.radius||0);
      const pts:Pt[]=[];
      const delta=((end-start) || Math.PI*2);
      const n=32;
      for(let i=0;i<=n;i++){
        const a=start+delta*(i/n);
        pts.push({x:center.x+Math.cos(a)*r,y:center.y+Math.sin(a)*r});
      }
      shapes.push({kind:"poly",pts,closed:false,layer});
    }
  }
  return {shapes,layers:[...layers].sort()};
}

function DxfPreview({ shapes, layers }:{shapes:DxfShape[];layers:string[]}) {
  const allPts:Pt[]=[];
  const MAX_PREVIEW_SHAPES = 120000;
  const previewShapes = shapes.length > MAX_PREVIEW_SHAPES
    ? shapes.filter((_, i) => i % Math.ceil(shapes.length / MAX_PREVIEW_SHAPES) === 0)
    : shapes;

  for(const s of previewShapes){
    if(s.kind==="line") allPts.push(s.a,s.b);
    if(s.kind==="poly") allPts.push(...s.pts);
    if(s.kind==="circle") allPts.push({x:s.c.x-s.r,y:s.c.y-s.r},{x:s.c.x+s.r,y:s.c.y+s.r});
  }
  if(!allPts.length) return <div style={{padding:24}}>DXF içinde desteklenen çizim elemanı bulunamadı.</div>;

  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
  for (const p of allPts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w=Math.max(1,maxX-minX), h=Math.max(1,maxY-minY);
  const pad=Math.max(w,h)*0.04;
  const view=`${minX-pad} ${-maxY-pad} ${w+pad*2} ${h+pad*2}`;

  return <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 180px",gap:12}}>
    <div style={{background:"#f8fafc",border:"1px solid #cbd5e1",borderRadius:12,overflow:"hidden",minHeight:520}}>
      {shapes.length > previewShapes.length && (
        <div style={{padding:"8px 10px",fontSize:11,color:"#64748b",borderBottom:"1px solid #e2e8f0"}}>
          Büyük DXF: performans için {previewShapes.length.toLocaleString("tr-TR")} / {shapes.length.toLocaleString("tr-TR")} çizim elemanı önizleniyor.
        </div>
      )}
      <svg viewBox={view} style={{width:"100%",height:520}}>
        <g transform="scale(1,-1)">
          {previewShapes.map((s,i)=>{
            const stroke=colorForLayer(s.layer);
            if(s.kind==="line") return <line key={i} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} stroke={stroke} strokeWidth={Math.max(w,h)/900}/>;
            if(s.kind==="poly") return <polyline key={i} points={s.pts.map(p=>`${p.x},${p.y}`).join(" ")} fill="none" stroke={stroke} strokeWidth={Math.max(w,h)/900} />;
            return <circle key={i} cx={s.c.x} cy={s.c.y} r={s.r} fill="none" stroke={stroke} strokeWidth={Math.max(w,h)/900}/>;
          })}
        </g>
      </svg>
    </div>
    <aside style={{border:"1px solid #d6e0ed",borderRadius:12,padding:12,background:"#fff"}}>
      <b style={{fontSize:13}}>Katmanlar</b>
      <div style={{marginTop:10,display:"grid",gap:6,maxHeight:480,overflow:"auto"}}>
        {layers.map(l=><div key={l} style={{display:"flex",alignItems:"center",gap:7,fontSize:11,wordBreak:"break-word"}}>
          <span style={{width:10,height:10,borderRadius:99,background:colorForLayer(l),flex:"0 0 auto"}}/>
          {l}
        </div>)}
      </div>
    </aside>
  </div>;
}

export default function ArchitecturalFileImporter(){
  const [file,setFile]=useState<File|null>(null);
  const [dxf,setDxf]=useState<{shapes:DxfShape[];layers:string[]}|null>(null);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [objectUrl,setObjectUrl]=useState<string|null>(null);

  const fmt=useMemo(()=>file?getCadFormat(file.name):null,[file]);

  async function loadFile(next:File|null){
    if(objectUrl) URL.revokeObjectURL(objectUrl);
    setObjectUrl(null); setDxf(null); setMessage(""); setFile(next);
    if(!next)return;
    const info=getCadFormat(next.name);
    if(!info){setMessage("Bu dosya uzantisi henuz desteklenmiyor.");return;}

    setBusy(true);
    try{
      if(info.ext===".dxf"){
        setDxf(await parseDxf(await next.text()));
        setMessage("DXF basariyla okundu.");
      } else if(info.ext===".dwg"){
        const body=new FormData(); body.append("file",next);
        const res=await fetch("/api/cad/dwg-to-dxf",{method:"POST",body});
        if(!res.ok){
          const err=await res.json().catch(()=>({error:"DWG donusumu basarisiz."}));
          throw new Error(err.error || "DWG donusumu basarisiz.");
        }
        setDxf(await parseDxf(await res.text()));
        setMessage("DWG LibreDWG ile DXF'e cevrildi ve acildi.");
      } else if([".svg",".pdf"].includes(info.ext)){
        setObjectUrl(URL.createObjectURL(next));
        setMessage(info.ext.toUpperCase()+" onizleme hazir.");
      } else if([".glb",".gltf",".obj",".stl"].includes(info.ext)){
        setMessage("3B model goruntuleyici hazir.");
      } else if(info.ext===".ifc"){
        setMessage("IFC BIM formati tanindi. Geometri goruntuleyici bir sonraki BIM fazinda etkinlestirilecek.");
      } else {
        setMessage(info.description);
      }
    }catch(e){
      setMessage(e instanceof Error?e.message:String(e));
    }finally{
      setBusy(false);
    }
  }

  return <main style={{minHeight:"100vh",background:"#eef5ff",padding:24,color:"#10396d",fontFamily:"Inter,Arial,sans-serif"}}>
    <header style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-end",marginBottom:18}}>
      <div><div style={{fontSize:11,letterSpacing:".16em",color:"#607b9d"}}>EMLAK CAFE AI · CAD / BIM</div><h1 style={{margin:"6px 0",fontSize:34}}>Mimari Proje İçe Aktar</h1><p style={{margin:0,color:"#6b82a0"}}>Mimar ve mühendislerin kullandığı proje dosyalarını tek çalışma alanında açın.</p></div>
      <a href="/arsa-gelistirme" style={{padding:"10px 14px",border:"1px solid #a9c0de",borderRadius:8,background:"#fff",color:"#194f8c",textDecoration:"none"}}>Arsa geliştirmeye dön</a>
    </header>

    <section style={{display:"grid",gridTemplateColumns:"330px minmax(0,1fr)",gap:16}}>
      <aside style={{background:"#fff",border:"1px solid #bfd1ea",borderRadius:14,padding:16}}>
        <label style={{display:"grid",gap:8,padding:16,border:"1px dashed #8baed8",borderRadius:10,fontSize:12}}>
          Proje dosyası seç
          <input type="file" accept={ACCEPTED_ARCHITECTURAL_EXTENSIONS} onChange={e=>loadFile(e.target.files?.[0]||null)}/>
        </label>
        {file&&<div style={{marginTop:12,padding:10,background:"#f3f7fc",borderRadius:9,fontSize:12}}>
          <b>{file.name}</b><div>{(file.size/1024/1024).toFixed(2)} MB</div>{fmt&&<div>{fmt.label} · {fmt.category}</div>}
        </div>}
        {message&&<div style={{marginTop:12,padding:10,borderRadius:9,background:"#edf5ff",fontSize:12,lineHeight:1.45}}>{busy?"İşleniyor…":message}</div>}

        <h3 style={{fontSize:14,marginTop:20}}>Desteklenen formatlar</h3>
        <div style={{display:"grid",gap:7}}>
          {CAD_FORMATS.map(f=><div key={f.ext} style={{padding:"8px 9px",border:"1px solid #d7e2ef",borderRadius:8,fontSize:11}}>
            <b>{f.ext.toUpperCase()}</b> · {f.label}<br/><span style={{color:"#7187a3"}}>{f.description}</span>
          </div>)}
        </div>
      </aside>

      <section style={{background:"#fff",border:"1px solid #bfd1ea",borderRadius:14,padding:14,minWidth:0}}>
        {!file&&<div style={{minHeight:560,display:"grid",placeItems:"center",color:"#7a8da7"}}>DWG, DXF, IFC veya 3B proje dosyanızı seçin.</div>}
        {dxf&&<DxfPreview shapes={dxf.shapes} layers={dxf.layers}/>}
        {file && [".glb",".gltf",".obj",".stl"].includes(fmt?.ext||"") && <ThreeFilePreview file={file}/>}
        {objectUrl && fmt?.ext===".svg" && <img src={objectUrl} alt="SVG mimari plan önizlemesi" style={{maxWidth:"100%",maxHeight:720,display:"block",margin:"auto"}}/>}
        {objectUrl && fmt?.ext===".pdf" && <iframe title="PDF plan önizlemesi" src={objectUrl} style={{width:"100%",height:720,border:0,borderRadius:10}}/>}
        {file && fmt?.ext===".ifc" && <div style={{minHeight:560,display:"grid",placeItems:"center",textAlign:"center",padding:24}}>
          <div><h2>IFC BIM dosyası tanındı</h2><p>web-ifc geometri okuyucusu BIM fazında bu alana bağlanacak.</p></div>
        </div>}
      </section>
    </section>
  </main>;
}
