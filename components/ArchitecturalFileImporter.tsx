"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ACCEPTED_ARCHITECTURAL_EXTENSIONS, CAD_FORMATS, getCadFormat } from "@/lib/cad/formats";
import { type CadSemanticAnalysis, type CadSelectionRegion } from "@/lib/cad/semanticAnalyzer";

const ThreeFilePreview = dynamic(
  () => import("@/components/Architectural3DPreview").then(m => m.ThreeFilePreview),
  { ssr: false }
);
const ProfessionalDxfViewer = dynamic(() => import("@/components/ProfessionalDxfViewer"), { ssr: false });
const CadSemantic3DPreview = dynamic(() => import("@/components/CadSemantic3DPreview"), { ssr: false });
const CadGlbPreview = dynamic(() => import("@/components/CadGlbPreview"), { ssr: false });

type Pt = { x:number; y:number };
type BuiltFloor = {
  name:string;
  analysis:CadSemanticAnalysis;
  elevation:number;
  height:number;
  glbBase64?:string;
  glbMeta?:{
    bytes?:number;
    wallPolygons?:number;
    doors?:number;
    windows?:number;
    glassPanels?:number;
    columns?:number;
    bounds?:number[][];
  };
};

type BuildStep = "ground-select" | "ground-built" | "upper-select" | "upper-built" | "roof-select" | "facade-select" | "complete";

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
  const [dxfText,setDxfText]=useState<string>("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [objectUrl,setObjectUrl]=useState<string|null>(null);
  const [analysis,setAnalysis]=useState<CadSemanticAnalysis|null>(null);
  const [analysisBusy,setAnalysisBusy]=useState(false);
  const [analysisProgress,setAnalysisProgress]=useState(0);
  const [floorHeight,setFloorHeight]=useState(3.0);
  const [wallThickness,setWallThickness]=useState(0.20);
  const [selection,setSelection]=useState<CadSelectionRegion|null>(null);
  const [generationStage,setGenerationStage]=useState("Hazır");
  const [unitMode,setUnitMode]=useState<"mm"|"cm"|"m">("mm");
  const [builtFloors,setBuiltFloors]=useState<BuiltFloor[]>([]);
  const [buildStep,setBuildStep]=useState<BuildStep>("ground-select");
  const [nextFloorIndex,setNextFloorIndex]=useState(1);
  const previewAnchorRef=useRef<HTMLDivElement|null>(null);

  const fmt=useMemo(()=>file?getCadFormat(file.name):null,[file]);
  const displayedAnalysis=analysis ?? (builtFloors.length ? builtFloors[builtFloors.length-1].analysis : null);

  async function loadFile(next:File|null){
    if(objectUrl) URL.revokeObjectURL(objectUrl);
    setObjectUrl(null); setDxf(null); setDxfText(""); setAnalysis(null); setSelection(null); setBuiltFloors([]); setBuildStep("ground-select"); setNextFloorIndex(1); setMessage(""); setFile(next);
    if(!next)return;
    const info=getCadFormat(next.name);
    if(!info){setMessage("Bu dosya uzantisi henuz desteklenmiyor.");return;}

    setBusy(true);
    try{
      if(info.ext===".dxf"){
        const text=await next.text();
        setDxfText(text);
        setDxf(await parseDxf(text));
        setMessage("DXF profesyonel WebGL goruntuleyicide acildi.");
      } else if(info.ext===".dwg"){
        const body=new FormData(); body.append("file",next);
        const res=await fetch("/api/cad/dwg-to-dxf",{method:"POST",body});
        if(!res.ok){
          const err=await res.json().catch(()=>({error:"DWG donusumu basarisiz."}));
          throw new Error(err.error || "DWG donusumu basarisiz.");
        }
        const text=await res.text();
        setDxfText(text);
        setDxf(await parseDxf(text));
        setMessage("DWG LibreDWG ile DXF'e cevrildi ve profesyonel CAD goruntuleyicide acildi.");
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

  async function createCurrentFloor(){
    if(!dxfText) return;
    if(!selection){
      setMessage(buildStep==="ground-select"
        ? "Önce zemin kat planını sürükleyerek seçin."
        : "Önce eklemek istediğiniz üst kat planını sürükleyerek seçin.");
      return;
    }

    setAnalysisBusy(true);
    setAnalysis(null);
    setAnalysisProgress(8);
    setGenerationStage(buildStep==="ground-select" ? "Zemin kat planı okunuyor" : `${nextFloorIndex}. kat planı okunuyor`);

    let timer: ReturnType<typeof setInterval> | null = null;
    try{
      timer=setInterval(()=>{
        setAnalysisProgress(prev=>Math.min(88,prev+4));
      },180);

      const res=await fetch("/api/cad/analyze",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({dxfText,selection,unitMode})
      });
      if(!res.ok){
        const err=await res.json().catch(()=>({error:"CAD analizi basarisiz."}));
        throw new Error(err.detail || err.error || "CAD analizi basarisiz.");
      }

      const result=await res.json() as CadSemanticAnalysis;
      if(timer){clearInterval(timer);timer=null;}

      setAnalysisProgress(90);
      setGenerationStage(buildStep==="ground-select"
        ? "Zemin kat GLB modeli oluşturuluyor"
        : `${nextFloorIndex}. kat GLB modeli oluşturuluyor`);

      const glbRes=await fetch("/api/cad/build-glb",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({analysis:result,floorHeight})
      });
      if(!glbRes.ok){
        const err=await glbRes.json().catch(()=>({error:"GLB üretimi başarısız."}));
        throw new Error(err.detail || err.error || "GLB üretimi başarısız.");
      }
      const glb=await glbRes.json();

      setAnalysisProgress(97);
      setGenerationStage("GLB önizleme hazırlanıyor");

      const elevation=builtFloors.reduce((sum,f)=>sum+f.height+0.18,0);
      const name=buildStep==="ground-select" ? "Zemin Kat" : `${nextFloorIndex}. Kat`;
      const floor:BuiltFloor={
        name,
        analysis:result,
        elevation,
        height:floorHeight,
        glbBase64:glb.glbBase64,
        glbMeta:{
          bytes:glb.bytes,
          wallPolygons:glb.wallPolygons,
          doors:glb.doors,
          windows:glb.windows,
          glassPanels:glb.glassPanels,
          columns:glb.columns,
          bounds:glb.bounds
        }
      };

      await new Promise(r=>setTimeout(r,120));
      setBuiltFloors(prev=>[...prev,floor]);
      setAnalysis(result);
      setAnalysisProgress(100);
      setGenerationStage(`${name} tamamlandı`);
      setSelection(null);

      setTimeout(()=>previewAnchorRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),60);

      if(buildStep==="ground-select"){
        setBuildStep("ground-built");
        setMessage("Zemin kat tamamlandı. 3D önizlemeyi kontrol edin; doğruysa Üst Kat Planını Seç ile devam edin.");
      }else{
        setBuildStep("upper-built");
        setMessage(`${name} tamamlandı ve alt katların üzerine eklendi. Sonraki katı ekleyebilir veya katları tamamlayabilirsiniz.`);
        setNextFloorIndex(v=>v+1);
      }
    }catch(e){
      if(timer){clearInterval(timer);timer=null;}
      setMessage(e instanceof Error?e.message:String(e));
    }finally{
      setAnalysisBusy(false);
    }
  }

  function requestUpperFloor(){
    setSelection(null);
    setAnalysis(null);
    setBuildStep("upper-select");
    setMessage(`${nextFloorIndex}. kat planını CAD üzerinde sürükleyerek seçin, sonra Katı Oluştur butonuna basın.`);
    window.scrollTo({top:0,behavior:"smooth"});
  }

  function finishFloors(){
    setSelection(null);
    setAnalysis(null);
    setBuildStep("roof-select");
    setMessage("Kat modellemesi tamamlandı. Şimdi çatı planını sürükleyerek seçme aşamasına geçiyoruz.");
    window.scrollTo({top:0,behavior:"smooth"});
  }

  return <main style={{minHeight:"100vh",background:"#eef5ff",padding:24,color:"#10396d",fontFamily:"Inter,Arial,sans-serif",position:"relative"}}>
    {analysisBusy&&<div style={{
      position:"fixed",inset:0,zIndex:9999,display:"grid",placeItems:"center",
      background:"rgba(5,17,30,.96)",backdropFilter:"blur(5px)"
    }}>
      <div style={{width:"min(560px,84vw)",textAlign:"center",color:"#fff"}}>
        <div style={{fontSize:12,letterSpacing:".22em",color:"#79b6ff",marginBottom:10}}>EMLAK CAFE AI</div>
        <div style={{fontSize:34,fontWeight:900,marginBottom:8}}>3D model hazırlanıyor</div>
        <div style={{fontSize:13,color:"#b7cbe0",marginBottom:18}}>{generationStage}</div>
        <div style={{height:13,borderRadius:99,overflow:"hidden",background:"#18334f",border:"1px solid #315d88"}}>
          <div style={{height:"100%",width:`${analysisProgress}%`,background:"linear-gradient(90deg,#1268e8,#65b8ff)",transition:"width .2s ease"}}/>
        </div>
        <div style={{fontSize:24,fontWeight:900,marginTop:9}}>%{analysisProgress}</div>
        <div style={{marginTop:16,padding:"10px 12px",border:"1px solid #2e567c",borderRadius:9,background:"#0d2944",fontSize:11,color:"#c2d6e8"}}>
          Bu aşama bitmeden sonraki kata geçilmez. Her kat ayrı plan seçiminden sonra mevcut 3D yapının üzerine eklenir.
        </div>
                <div style={{fontSize:11,color:"#7e9ab6",marginTop:14}}>Projede bulunmayan kat, çatı veya cephe bilgisi uydurulmaz; eksik olarak işaretlenir.</div>
      </div>
    </div>}
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
        {dxfText&&<div style={{marginTop:14,padding:12,border:"1px solid #b8cce6",borderRadius:10,background:"#f8fbff"}}>
          <b style={{display:"block",fontSize:13,marginBottom:9}}>3D Model Ayarları</b>
          <label style={{display:"grid",gap:5,fontSize:11,marginBottom:8}}>Kat yüksekliği (m)
            <input type="number" step=".05" min="2" max="8" value={floorHeight} onChange={e=>setFloorHeight(Number(e.target.value)||3)} style={{padding:8,border:"1px solid #c6d5e7",borderRadius:7}}/>
          </label>
          <label style={{display:"grid",gap:5,fontSize:11,marginBottom:8}}>Duvar kalınlığı (m)
            <input type="number" step=".01" min=".08" max="1" value={wallThickness} onChange={e=>setWallThickness(Number(e.target.value)||.2)} style={{padding:8,border:"1px solid #c6d5e7",borderRadius:7}}/>
          </label>
          <label style={{display:"grid",gap:5,fontSize:11,marginBottom:10}}>CAD birimi
            <select value={unitMode} onChange={e=>setUnitMode(e.target.value as "mm"|"cm"|"m")} style={{padding:8,border:"1px solid #c6d5e7",borderRadius:7}}>
              <option value="mm">Milimetre (mm)</option>
              <option value="cm">Santimetre (cm)</option>
              <option value="m">Metre (m)</option>
            </select>
          </label>
          <div style={{fontSize:10,padding:8,borderRadius:7,background:selection?"#eaf7ef":"#fff3df",color:selection?"#28653b":"#8a5a13",marginBottom:10}}>
            {selection
              ? (buildStep==="ground-select" ? "Zemin kat planı seçildi." : "Üst kat planı seçildi.")
              : (buildStep==="ground-select" ? "Zemin kat planını sürükleyerek seçin." : buildStep==="upper-select" ? `${nextFloorIndex}. kat planını sürükleyerek seçin.` : "Mevcut kat modellemesi tamamlandı.")}
          </div>

          {(buildStep==="ground-select"||buildStep==="upper-select")&&<button type="button" onClick={createCurrentFloor} disabled={analysisBusy||!selection} style={{
            width:"100%",padding:"12px 10px",border:0,borderRadius:9,background:selection?"#176be0":"#9db6d5",color:"#fff",fontWeight:800,cursor:selection?"pointer":"not-allowed"
          }}>{analysisBusy?`Emlak Cafe AI işliyor · %${analysisProgress}`:buildStep==="ground-select"?"Zemin Kat 3D Modelini Oluştur":`${nextFloorIndex}. Katı Oluştur`}</button>}

          {(buildStep==="ground-built"||buildStep==="upper-built")&&<div style={{display:"grid",gap:8}}>
            <button type="button" onClick={requestUpperFloor} style={{
              width:"100%",padding:"12px 10px",border:0,borderRadius:9,background:"#176be0",color:"#fff",fontWeight:800,cursor:"pointer"
            }}>Üst Kat Planını Seç</button>
            <button type="button" onClick={finishFloors} style={{
              width:"100%",padding:"10px",border:"1px solid #9eb7d6",borderRadius:9,background:"#fff",color:"#174b86",fontWeight:800,cursor:"pointer"
            }}>Katları Tamamla → Çatı Aşaması</button>
          </div>}

          {buildStep==="roof-select"&&<div style={{padding:10,borderRadius:9,background:"#fff3df",fontSize:11,color:"#7c5514"}}>
            Katlar tamamlandı. Sonraki geliştirmede çatı planı seçimi bu aşamadan başlayacak.
          </div>}

          <div style={{fontSize:10,color:"#7187a3",marginTop:8,lineHeight:1.4}}>Her kat ayrı ayrı tamamlanır; sonraki kat ancak kullanıcı seçtikten sonra eklenir.</div>
        </div>}

        <h3 style={{fontSize:14,marginTop:20}}>Desteklenen formatlar</h3>
        <div style={{display:"grid",gap:7}}>
          {CAD_FORMATS.map(f=><div key={f.ext} style={{padding:"8px 9px",border:"1px solid #d7e2ef",borderRadius:8,fontSize:11}}>
            <b>{f.ext.toUpperCase()}</b> · {f.label}<br/><span style={{color:"#7187a3"}}>{f.description}</span>
          </div>)}
        </div>
      </aside>

      <section style={{background:"#fff",border:"1px solid #bfd1ea",borderRadius:14,padding:14,minWidth:0}}>
        {!file&&<div style={{minHeight:560,display:"grid",placeItems:"center",color:"#7a8da7"}}>DWG, DXF, IFC veya 3B proje dosyanızı seçin.</div>}
        {dxfText&&<ProfessionalDxfViewer text={dxfText} onSelection={region=>{
          if(buildStep==="roof-select"){
            setMessage("Çatı planı seçildi. Çatı modelleme motoru sonraki aşamada bu seçimi kullanacak.");
            return;
          }
          setSelection(region);
          setAnalysis(null);
          setMessage(buildStep==="ground-select"
            ? "Zemin kat planı seçildi. Şimdi Zemin Kat 3D Modelini Oluştur butonuna basın."
            : `${nextFloorIndex}. kat planı seçildi. Şimdi Katı Oluştur butonuna basın.`);
        }}/>}
        {builtFloors.length>0&&<div ref={previewAnchorRef} style={{marginTop:16,scrollMarginTop:18}}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
            {displayedAnalysis?.engine&&<div style={{padding:"8px 10px",borderRadius:8,background:"#e9f8ef",border:"1px solid #abd5b8",fontSize:11,color:"#245d35"}}>
              <b>CAD Motoru:</b> {displayedAnalysis.engine}{displayedAnalysis.dxfVersion?` · ${displayedAnalysis.dxfVersion}`:""}{displayedAnalysis.layout?` · ${displayedAnalysis.layout}`:""}
            </div>}
            {displayedAnalysis?.reconstruction&&<div style={{padding:"8px 10px",borderRadius:8,background:"#eef6ff",border:"1px solid #b7cde8",fontSize:11,color:"#244f7b"}}>
              <b>Duvar Rekonstrüksiyonu:</b> Ham {displayedAnalysis.reconstruction.rawWallEntityCount} → Gerçek {displayedAnalysis.reconstruction.wallSegmentCount}
              <br/><span>Kapı açıklığı: {displayedAnalysis.reconstruction.doorOpeningCount??0} · Pencere açıklığı: {displayedAnalysis.reconstruction.windowOpeningCount??0}</span>
            </div>}
            {builtFloors.map((f,i)=><div key={f.name} style={{padding:"8px 10px",borderRadius:8,background:"#eaf4ff",border:"1px solid #b9d2ef",fontSize:11}}>
              <b>{f.name}</b><br/>Kot: {f.elevation.toFixed(2)} m · Yükseklik: {f.height.toFixed(2)} m
              {f.glbMeta&&<><br/><span style={{color:"#58718e"}}>GLB: {Math.round((f.glbMeta.bytes||0)/1024)} KB · Duvar mesh: {f.glbMeta.wallPolygons||0} · Kapı: {f.glbMeta.doors||0} · Pencere: {f.glbMeta.windows||0} · Cam: {f.glbMeta.glassPanels||0}</span></>}
            </div>)}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:8,marginBottom:12}}>
            {[
              ["Duvar",displayedAnalysis?.counts.wall??0],["Kolon",displayedAnalysis?.counts.column??0],["Kapı",displayedAnalysis?.counts.door??0],["Pencere",displayedAnalysis?.counts.window??0],
              ["Merdiven",displayedAnalysis?.counts.stair??0],["Aks",displayedAnalysis?.counts.axis??0],["Ölçü",displayedAnalysis?.counts.dimension??0],["Metin",displayedAnalysis?.counts.text??0]
            ].map(([label,value])=><div key={String(label)} style={{padding:10,border:"1px solid #d6e2ef",borderRadius:9,background:"#f8fbff"}}>
              <span style={{display:"block",fontSize:10,color:"#7187a3"}}>{label}</span><b style={{fontSize:18}}>{value}</b>
            </div>)}
          </div>
          {displayedAnalysis?.selectionDiagnostics&&<div style={{padding:10,border:"1px solid #b8cce6",background:"#f7fbff",borderRadius:9,fontSize:11,lineHeight:1.5,marginBottom:12}}>
            <b>Koordinat Teşhisi</b>
            <div>Seçim bounds: {JSON.stringify(displayedAnalysis.selectionDiagnostics.bounds)}</div>
            <div style={{marginTop:6}}>
              {displayedAnalysis.layoutDiagnostics?.map(d=><div key={d.name}>
                <b>{d.name}</b> · recognized: {d.recognized} · total: {d.total} · bounds: {JSON.stringify(d.rawBounds)}
              </div>)}
            </div>
          </div>}
          {displayedAnalysis&&displayedAnalysis.warnings.length>0&&<div style={{padding:10,border:"1px solid #e9c77d",background:"#fff8e9",borderRadius:9,fontSize:11,lineHeight:1.5,marginBottom:12}}>
            {displayedAnalysis.warnings.map(w=><div key={w}>• {w}</div>)}
          </div>}
          <h2 style={{fontSize:20,margin:"10px 0"}}>Oluşturulan Katlar · GLB Önizleme</h2>
          {builtFloors[builtFloors.length-1]?.glbBase64
            ? <CadGlbPreview base64={builtFloors[builtFloors.length-1].glbBase64!}/>
            : <CadSemantic3DPreview floors={builtFloors} wallThickness={wallThickness} unitScale={unitMode==="mm"?.001:unitMode==="cm"?.01:1}/>}

        </div>}
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
