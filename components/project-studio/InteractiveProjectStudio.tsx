"use client";

import { useMemo, useState } from "react";
import ProjectUnit3D, { StudioUnit } from "@/components/project-studio/ProjectUnit3D";
import Panorama360 from "@/components/project-studio/Panorama360";

type Mode="project"|"units"|"tour"|"gallery"|"location";
type StatusFilter="all"|"available"|"reserved"|"sold";

const DEMO_UNITS:StudioUnit[]=[
  {id:"A-101",block:"A",floor:1,type:"2+1",area:112,facade:"Güney",status:"available"},
  {id:"A-102",block:"A",floor:1,type:"3+1",area:148,facade:"Batı",status:"reserved"},
  {id:"A-201",block:"A",floor:2,type:"2+1",area:112,facade:"Güney",status:"available"},
  {id:"A-202",block:"A",floor:2,type:"3+1",area:148,facade:"Doğu",status:"available"},
  {id:"A-301",block:"A",floor:3,type:"4+1",area:188,facade:"Güney",status:"sold"},
  {id:"B-101",block:"B",floor:1,type:"1+1",area:76,facade:"Doğu",status:"sold"},
  {id:"B-102",block:"B",floor:1,type:"2+1",area:109,facade:"Batı",status:"available"},
  {id:"B-201",block:"B",floor:2,type:"3+1",area:154,facade:"Kuzey",status:"available"},
  {id:"B-202",block:"B",floor:2,type:"2+1",area:114,facade:"Güney",status:"reserved"},
  {id:"C-101",block:"C",floor:1,type:"2+1",area:118,facade:"Doğu",status:"available"},
  {id:"C-201",block:"C",floor:2,type:"3+1",area:158,facade:"Batı",status:"available"},
  {id:"C-301",block:"C",floor:3,type:"4+1",area:196,facade:"Güney",status:"available"}
];

const labels={
  available:"Müsait",
  reserved:"Rezerve",
  sold:"Satıldı"
} as const;

export default function InteractiveProjectStudio(){
  const [mode,setMode]=useState<Mode>("project");
  const [selected,setSelected]=useState<StudioUnit|null>(DEMO_UNITS[0]);
  const [block,setBlock]=useState("all");
  const [floor,setFloor]=useState("all");
  const [type,setType]=useState("all");
  const [status,setStatus]=useState<StatusFilter>("all");
  const [favorites,setFavorites]=useState<string[]>([]);
  const [compare,setCompare]=useState<string[]>([]);
  const [panoUrl,setPanoUrl]=useState<string|null>(null);

  const filtered=useMemo(()=>DEMO_UNITS.filter(u=>{
    if(block!=="all"&&u.block!==block)return false;
    if(floor!=="all"&&String(u.floor)!==floor)return false;
    if(type!=="all"&&u.type!==type)return false;
    if(status!=="all"&&u.status!==status)return false;
    return true;
  }),[block,floor,type,status]);

  const visible3D=filtered.length?filtered:DEMO_UNITS;

  function choose(unit:StudioUnit){
    setSelected(unit);
  }

  function handlePanorama(file:File|null){
    if(panoUrl) URL.revokeObjectURL(panoUrl);
    setPanoUrl(file?URL.createObjectURL(file):null);
    if(file)setMode("tour");
  }

  function toggleFav(id:string){
    setFavorites(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);
  }

  function toggleCompare(id:string){
    setCompare(v=>v.includes(id)?v.filter(x=>x!==id):v.length<3?[...v,id]:v);
  }

  const nav:[Mode,string][]=[
    ["project","Vaziyet / 3D"],
    ["units","Daire Bul"],
    ["tour","360° Tur"],
    ["gallery","Galeri"],
    ["location","Konum"]
  ];

  return <main style={{minHeight:"100vh",background:"#07111d",color:"#edf5ff",fontFamily:"Arial,Helvetica,sans-serif"}}>
    <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,padding:"16px 22px",borderBottom:"1px solid #22364c",background:"#091522"}}>
      <div>
        <div style={{fontSize:10,letterSpacing:2.2,color:"#70dda2",fontWeight:900}}>EMLAK CAFE · INTERACTIVE PROJECT STUDIO</div>
        <h1 style={{fontSize:23,margin:"5px 0 0"}}>360° Proje Satış Deneyimi</h1>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button style={ghost}>Canlı Sunum</button>
        <button style={ghost}>Paylaş</button>
      </div>
    </header>

    <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 345px"}}>
      <section style={{minWidth:0}}>
        <nav style={{display:"flex",gap:8,padding:12,borderBottom:"1px solid #22364c",overflowX:"auto"}}>
          {nav.map(([id,label])=><button key={id} onClick={()=>setMode(id)} style={{...ghost,background:mode===id?"#176be0":"#0c1a29"}}>{label}</button>)}
        </nav>

        <div style={{padding:14}}>
          <div style={{border:"1px solid #263d55",borderRadius:14,overflow:"hidden",background:"#0b1623",minHeight:620}}>
            {mode==="project"&&<ProjectUnit3D units={visible3D} selectedId={selected?.id||null} onSelect={choose}/>}
            {mode==="units"&&<div style={{padding:16}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:12}}>
                <b>{filtered.length} bağımsız bölüm</b>
                <span style={{fontSize:11,color:"#8fa3b8"}}>Kart seçimi sağdaki satış panelini günceller.</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:10}}>
                {filtered.map(u=><button key={u.id} onClick={()=>choose(u)} style={{
                  textAlign:"left",padding:14,borderRadius:11,cursor:"pointer",
                  border:selected?.id===u.id?"1px solid #6f9cff":"1px solid #2a415a",
                  background:selected?.id===u.id?"#142b49":"#0d1b2b",color:"#edf5ff"
                }}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                    <b>{u.id}</b>
                    <span style={pill(u.status)}>{labels[u.status]}</span>
                  </div>
                  <div style={{fontSize:12,lineHeight:1.6,color:"#a8bacb",marginTop:8}}>
                    {u.block} Blok · {u.floor}. Kat<br/>
                    {u.type} · {u.area} m²<br/>
                    {u.facade} cephe
                  </div>
                </button>)}
              </div>
            </div>}
            {mode==="tour"&&<Panorama360 imageUrl={panoUrl}/>}
            {mode==="gallery"&&<div style={{padding:16,display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10}}>
              {["Dış Cephe","Vaziyet","Peyzaj","Salon","Mutfak","Yatak Odası"].map(x=><div key={x} style={{minHeight:210,border:"1px solid #294158",borderRadius:12,display:"grid",placeItems:"center",color:"#91a6ba",background:"#102033"}}>{x} görseli</div>)}
            </div>}
            {mode==="location"&&<div style={{minHeight:620,display:"grid",placeItems:"center",textAlign:"center",padding:24}}>
              <div><h2>Konum & Çevre</h2><p style={{color:"#9aafc2",maxWidth:560,lineHeight:1.6}}>Cesium/MapLibre katmanı, parsel, uydu görünümü, ulaşım süreleri ve çevre noktaları bu alana bağlanacak.</p></div>
            </div>}
          </div>
        </div>
      </section>

      <aside style={{borderLeft:"1px solid #22364c",padding:16,background:"#091522"}}>
        <div style={{fontSize:10,letterSpacing:1.8,color:"#70dda2",fontWeight:900}}>AKILLI SATIŞ PANELİ</div>
        <h2 style={{fontSize:18,margin:"6px 0 14px"}}>Bağımsız Bölüm Seç</h2>

        <Filter label="Blok" value={block} onChange={setBlock} options={[["all","Tümü"],["A","A Blok"],["B","B Blok"],["C","C Blok"]]}/>
        <Filter label="Kat" value={floor} onChange={setFloor} options={[["all","Tümü"],["1","1. Kat"],["2","2. Kat"],["3","3. Kat"]]}/>
        <Filter label="Daire Tipi" value={type} onChange={setType} options={[["all","Tümü"],["1+1","1+1"],["2+1","2+1"],["3+1","3+1"],["4+1","4+1"]]}/>
        <Filter label="Durum" value={status} onChange={v=>setStatus(v as StatusFilter)} options={[["all","Tümü"],["available","Müsait"],["reserved","Rezerve"],["sold","Satıldı"]]}/>

        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7,margin:"13px 0"}}>
          <Metric label="Müsait" value={DEMO_UNITS.filter(x=>x.status==="available").length}/>
          <Metric label="Rezerve" value={DEMO_UNITS.filter(x=>x.status==="reserved").length}/>
          <Metric label="Satıldı" value={DEMO_UNITS.filter(x=>x.status==="sold").length}/>
        </div>

        {selected&&<div style={{border:"1px solid #2a415a",borderRadius:12,padding:14,background:"#0d1b2b"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
            <div><div style={{fontSize:10,color:"#8fa3b8"}}>SEÇİLEN DAİRE</div><b style={{fontSize:20}}>{selected.id}</b></div>
            <span style={pill(selected.status)}>{labels[selected.status]}</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12,fontSize:12,color:"#a9bbcd"}}>
            <Info label="Blok" value={selected.block}/>
            <Info label="Kat" value={String(selected.floor)}/>
            <Info label="Tip" value={selected.type}/>
            <Info label="Alan" value={selected.area+" m²"}/>
            <Info label="Cephe" value={selected.facade}/>
            <Info label="Fiyat" value="CRM'den"/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginTop:12}}>
            <button onClick={()=>toggleFav(selected.id)} style={small}>{favorites.includes(selected.id)?"★ Favoride":"☆ Favori"}</button>
            <button onClick={()=>toggleCompare(selected.id)} style={small}>{compare.includes(selected.id)?"✓ Karşılaştır":"Karşılaştır"}</button>
          </div>
          <button onClick={()=>setMode("tour")} style={{...primary,marginTop:8,width:"100%"}}>360° Daireyi Gez</button>
        </div>}

        <label style={{display:"grid",gap:6,marginTop:12,fontSize:11,color:"#9db0c4"}}>
          360° panorama yükle
          <input type="file" accept="image/jpeg,image/png" onChange={e=>handlePanorama(e.target.files?.[0]||null)} style={{fontSize:11,color:"#c8d6e5"}}/>
        </label>

        <div style={{display:"grid",gap:8,marginTop:14}}>
          <button style={primary}>Teklif Hazırla</button>
          <button style={{...primary,background:"#1b8e59"}}>WhatsApp ile Paylaş</button>
        </div>

        <div style={{marginTop:14,padding:11,borderRadius:10,border:"1px solid #2a415a",fontSize:10,lineHeight:1.55,color:"#8fa3b8"}}>
          <b style={{color:"#dce8f5"}}>Studio v1:</b> 3D blok/kat/daire seçimi ve panorama motoru gerçek çalışır. Stok kayıtları şu an arayüz testi için örnektir; canlı proje envanteri bağlandığında bu dizi kaldırılacaktır.
        </div>
      </aside>
    </div>
  </main>;
}

function Filter({label,value,onChange,options}:{label:string;value:string;onChange:(v:string)=>void;options:[string,string][]}){
  return <label style={{display:"grid",gap:5,fontSize:11,color:"#8fa3b8",marginBottom:9}}>
    {label}
    <select value={value} onChange={e=>onChange(e.target.value)} style={{padding:9,borderRadius:8,border:"1px solid #2a415a",background:"#0d1b2b",color:"#edf5ff"}}>
      {options.map(([v,l])=><option key={v} value={v}>{l}</option>)}
    </select>
  </label>;
}
function Metric({label,value}:{label:string;value:number}){
  return <div style={{padding:9,border:"1px solid #263c53",borderRadius:9,textAlign:"center",background:"#0d1b2b"}}><b>{value}</b><div style={{fontSize:9,color:"#8fa3b8"}}>{label}</div></div>;
}
function Info({label,value}:{label:string;value:string}){
  return <div>{label}<br/><b style={{color:"#fff"}}>{value}</b></div>;
}
function pill(status:StudioUnit["status"]){
  const map={available:["#123e29","#69d999"],reserved:["#493415","#f0bf67"],sold:["#492126","#ef7a83"]} as const;
  return {fontSize:10,padding:"4px 7px",borderRadius:999,background:map[status][0],color:map[status][1],fontWeight:900} as const;
}
const ghost={padding:"9px 11px",borderRadius:8,border:"1px solid #2b435c",background:"#0d1b2b",color:"#edf5ff",cursor:"pointer",fontWeight:800,fontSize:12} as const;
const primary={padding:"11px 13px",border:0,borderRadius:8,background:"#176be0",color:"#fff",cursor:"pointer",fontWeight:900} as const;
const small={padding:"8px",borderRadius:8,border:"1px solid #314a63",background:"#0b1725",color:"#edf5ff",cursor:"pointer",fontWeight:700,fontSize:11} as const;
