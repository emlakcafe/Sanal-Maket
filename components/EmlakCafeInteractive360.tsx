"use client";

import { useMemo, useState } from "react";

type UnitStatus="available"|"reserved"|"sold";
type Unit={
  id:string;
  block:string;
  floor:number;
  type:string;
  area?:number;
  price?:number;
  facade:string;
  status:UnitStatus;
};

const DEMO_UNITS:Unit[]=[
  {id:"A-01",block:"A",floor:1,type:"2+1",area:112,facade:"Güney",status:"available"},
  {id:"A-02",block:"A",floor:1,type:"3+1",area:148,facade:"Batı",status:"reserved"},
  {id:"A-11",block:"A",floor:2,type:"2+1",area:112,facade:"Güney",status:"available"},
  {id:"B-01",block:"B",floor:1,type:"1+1",area:76,facade:"Doğu",status:"sold"},
  {id:"B-12",block:"B",floor:2,type:"3+1",area:154,facade:"Kuzey",status:"available"},
  {id:"C-21",block:"C",floor:3,type:"4+1",area:196,facade:"Güney",status:"available"},
];

const statusLabel:Record<UnitStatus,string>={
  available:"Müsait",
  reserved:"Rezerve",
  sold:"Satıldı"
};

export default function EmlakCafeInteractive360(){
  const [mode,setMode]=useState<"project"|"units"|"tour"|"gallery"|"location">("project");
  const [block,setBlock]=useState("Tümü");
  const [floor,setFloor]=useState("Tümü");
  const [type,setType]=useState("Tümü");
  const [status,setStatus]=useState<"Tümü"|UnitStatus>("Tümü");
  const [selected,setSelected]=useState<Unit|null>(null);
  const [favorites,setFavorites]=useState<string[]>([]);
  const [compare,setCompare]=useState<string[]>([]);
  const [presentation,setPresentation]=useState(false);

  const units=useMemo(()=>DEMO_UNITS.filter(u=>
    (block==="Tümü"||u.block===block)&&
    (floor==="Tümü"||String(u.floor)===floor)&&
    (type==="Tümü"||u.type===type)&&
    (status==="Tümü"||u.status===status)
  ),[block,floor,type,status]);

  const blocks=[...new Set(DEMO_UNITS.map(u=>u.block))];
  const floors=[...new Set(DEMO_UNITS.map(u=>u.floor))].sort((a,b)=>a-b);
  const types=[...new Set(DEMO_UNITS.map(u=>u.type))];

  function toggleFav(id:string){
    setFavorites(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);
  }
  function toggleCompare(id:string){
    setCompare(v=>v.includes(id)?v.filter(x=>x!==id):v.length<3?[...v,id]:v);
  }

  return <main style={{
    minHeight:"100vh",
    background:"#07111e",
    color:"#eef5ff",
    fontFamily:"Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
  }}>
    <header style={{
      display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,
      padding:"16px 22px",borderBottom:"1px solid #203047",background:"#091624"
    }}>
      <div>
        <div style={{fontSize:10,letterSpacing:2.4,color:"#77dba4",fontWeight:800}}>EMLAK CAFE · INTERAKTİF PROJE SUNUMU</div>
        <h1 style={{margin:"4px 0 0",fontSize:22}}>360° Satış Deneyimi</h1>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
        <button onClick={()=>setPresentation(v=>!v)} style={topBtn(presentation)}>{presentation?"Sunum Modunu Kapat":"Canlı Sunum"}</button>
        <button style={topBtn(false)}>Paylaş</button>
        <button style={topBtn(false)}>Tam Ekran</button>
      </div>
    </header>

    <section style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 330px",minHeight:"calc(100vh - 74px)"}}>
      <section style={{minWidth:0,position:"relative"}}>
        <nav style={{
          display:"flex",gap:8,padding:"12px 16px",borderBottom:"1px solid #203047",
          overflowX:"auto",background:"#0b1827"
        }}>
          {[
            ["project","Vaziyet / 3D"],
            ["units","Daire Bul"],
            ["tour","360° Tur"],
            ["gallery","Galeri"],
            ["location","Konum"]
          ].map(([id,label])=><button key={id} onClick={()=>setMode(id as any)} style={tabBtn(mode===id)}>{label}</button>)}
        </nav>

        <div style={{padding:16}}>
          <div style={{
            minHeight:520,border:"1px solid #243954",borderRadius:16,overflow:"hidden",
            background:"linear-gradient(145deg,#101f31,#0c1724)",position:"relative"
          }}>
            {mode==="project"&&<ProjectStage onSelect={()=>setMode("units")}/>}
            {mode==="units"&&<UnitStage units={units} selected={selected} onSelect={setSelected}/>}
            {mode==="tour"&&<TourStage selected={selected}/>}
            {mode==="gallery"&&<GalleryStage/>}
            {mode==="location"&&<LocationStage/>}

            <div style={{
              position:"absolute",left:16,bottom:16,display:"flex",gap:8,flexWrap:"wrap"
            }}>
              <span style={legend("#35c977")}>Müsait</span>
              <span style={legend("#f0b34b")}>Rezerve</span>
              <span style={legend("#e45b64")}>Satıldı</span>
            </div>
          </div>
        </div>
      </section>

      <aside style={{
        borderLeft:"1px solid #203047",background:"#091522",padding:16,overflowY:"auto"
      }}>
        <div style={{fontSize:11,letterSpacing:1.5,color:"#77dba4",fontWeight:800,marginBottom:6}}>AKILLI SATIŞ PANELİ</div>
        <h2 style={{fontSize:18,margin:"0 0 14px"}}>Daireleri Filtrele</h2>

        <Filter label="Blok" value={block} onChange={setBlock} options={["Tümü",...blocks]}/>
        <Filter label="Kat" value={floor} onChange={setFloor} options={["Tümü",...floors.map(String)]}/>
        <Filter label="Daire Tipi" value={type} onChange={setType} options={["Tümü",...types]}/>
        <Filter label="Durum" value={status} onChange={v=>setStatus(v as any)} options={["Tümü","available","reserved","sold"]} labels={{available:"Müsait",reserved:"Rezerve",sold:"Satıldı"}}/>

        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,margin:"14px 0"}}>
          <Metric value={DEMO_UNITS.filter(u=>u.status==="available").length} label="Müsait"/>
          <Metric value={DEMO_UNITS.filter(u=>u.status==="reserved").length} label="Rezerve"/>
          <Metric value={DEMO_UNITS.filter(u=>u.status==="sold").length} label="Satıldı"/>
        </div>

        <div style={{borderTop:"1px solid #203047",paddingTop:14}}>
          {selected?<UnitCard unit={selected} fav={favorites.includes(selected.id)} compare={compare.includes(selected.id)} onFav={()=>toggleFav(selected.id)} onCompare={()=>toggleCompare(selected.id)} onTour={()=>setMode("tour")}/>:<div style={{padding:14,border:"1px dashed #38516d",borderRadius:12,color:"#9db0c5",fontSize:12,lineHeight:1.55}}>
            Vaziyet veya daire listesinden bir bağımsız bölüm seçin. Gerçek stok, fiyat ve plan verisi bağlandığında bu kart otomatik dolacak.
          </div>}
        </div>

        <div style={{marginTop:14,display:"grid",gap:8}}>
          <button style={cta("#176be0")}>Teklif Hazırla</button>
          <button style={cta("#1d8f5a")}>WhatsApp ile Paylaş</button>
        </div>

        <div style={{marginTop:14,padding:12,border:"1px solid #21344b",borderRadius:12,fontSize:11,color:"#8ea2b8",lineHeight:1.55}}>
          <b style={{color:"#dce8f6"}}>Not:</b> Bu ekrandaki daireler yalnız arayüz akışını göstermek için örnek kayıtlar. Emlak Cafe gerçek proje stok verisi bağlandığında demo kayıtlar kaldırılacak.
        </div>
      </aside>
    </section>
  </main>;
}

function ProjectStage({onSelect}:{onSelect:()=>void}){
  return <div style={{height:"100%",minHeight:520,display:"grid",placeItems:"center",padding:28,textAlign:"center"}}>
    <div style={{maxWidth:720}}>
      <div style={{fontSize:11,letterSpacing:1.6,color:"#77dba4",fontWeight:800}}>PROJE GENEL BAKIŞ</div>
      <h2 style={{fontSize:32,margin:"10px 0 12px"}}>Projeyi yukarıdan keşfet, sonra daireye kadar in</h2>
      <p style={{color:"#a8bacd",lineHeight:1.65,margin:"0 auto 24px",maxWidth:620}}>
        Gerçek proje renderı, GLB modeli veya 360 dönen görsel seti bu alana bağlanacak. Bloklar tıklanabilir olacak ve satış durumu renkleri doğrudan model üzerinde gösterilecek.
      </p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:10,marginBottom:20}}>
        <Feature title="360° Proje" text="Orbit, zoom, yakın kamera ve rehberli tur"/>
        <Feature title="Canlı Stok" text="Müsait / rezerve / satıldı renkleri"/>
        <Feature title="Satışa Hazır" text="Teklif, paylaşım, CRM ve WhatsApp"/>
      </div>
      <button onClick={onSelect} style={{...cta("#176be0"),width:"auto",padding:"12px 20px"}}>Daireleri Keşfet</button>
    </div>
  </div>;
}

function UnitStage({units,selected,onSelect}:{units:Unit[];selected:Unit|null;onSelect:(u:Unit)=>void}){
  return <div style={{padding:20}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",marginBottom:14}}>
      <div><b>{units.length} sonuç</b><div style={{fontSize:11,color:"#8fa3b8"}}>Blok / kat / daire seçimi</div></div>
      <div style={{fontSize:11,color:"#8fa3b8"}}>Tıklanan daire satış paneline aktarılır</div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))",gap:10}}>
      {units.map(u=><button key={u.id} onClick={()=>onSelect(u)} style={{
        textAlign:"left",padding:14,borderRadius:12,cursor:"pointer",
        border:selected?.id===u.id?"1px solid #6f9cff":"1px solid #2a3d55",
        background:selected?.id===u.id?"#132744":"#0d1b2b",color:"#edf5ff"
      }}>
        <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
          <b>{u.id}</b><span style={statusPill(u.status)}>{statusLabel[u.status]}</span>
        </div>
        <div style={{fontSize:12,color:"#a8bbce",marginTop:10,lineHeight:1.6}}>
          Blok {u.block} · {u.floor}. Kat<br/>{u.type} · {u.area?u.area+" m²":"Alan bekleniyor"}<br/>{u.facade} cephe
        </div>
      </button>)}
    </div>
  </div>;
}

function TourStage({selected}:{selected:Unit|null}){
  return <div style={{height:"100%",minHeight:520,display:"grid",placeItems:"center",padding:24,textAlign:"center"}}>
    <div>
      <div style={{width:110,height:110,borderRadius:"50%",margin:"0 auto 18px",display:"grid",placeItems:"center",border:"1px solid #416282",fontSize:30}}>360°</div>
      <h2 style={{margin:"0 0 8px"}}>{selected?selected.id+" 360° Daire Turu":"360° Daire Turu"}</h2>
      <p style={{color:"#9db0c5",maxWidth:520,lineHeight:1.6}}>
        2:1 equirectangular panorama, Matterport/Kuula bağlantısı veya Emlak Cafe’nin kendi panorama motoru buraya bağlanacak. Oda hotspotlarıyla salon → mutfak → yatak odası → balkon geçişi yapılacak.
      </p>
    </div>
  </div>;
}

function GalleryStage(){
  return <div style={{padding:20,display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:12}}>
    {["Dış Cephe","Peyzaj","Salon","Mutfak","Yatak Odası","Sosyal Alan"].map(x=><div key={x} style={{minHeight:190,borderRadius:14,border:"1px solid #2a3d55",background:"#102033",display:"grid",placeItems:"center",color:"#93a8be"}}>{x} görseli</div>)}
  </div>;
}

function LocationStage(){
  return <div style={{height:"100%",minHeight:520,display:"grid",placeItems:"center",padding:24,textAlign:"center"}}>
    <div><h2>Konum & Çevre</h2><p style={{color:"#9db0c5",maxWidth:580,lineHeight:1.6}}>Uydu haritası, ulaşım süreleri, okul–hastane–AVM–sahil gibi POI noktaları ve drone/gerçek manzara bağlantıları bu alanda gösterilecek.</p></div>
  </div>;
}

function UnitCard({unit,fav,compare,onFav,onCompare,onTour}:{unit:Unit;fav:boolean;compare:boolean;onFav:()=>void;onCompare:()=>void;onTour:()=>void}){
  return <div style={{border:"1px solid #2a3d55",borderRadius:12,padding:14,background:"#0d1b2b"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
      <div><div style={{fontSize:11,color:"#8fa3b8"}}>SEÇİLEN DAİRE</div><b style={{fontSize:20}}>{unit.id}</b></div>
      <span style={statusPill(unit.status)}>{statusLabel[unit.status]}</span>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12,fontSize:12,color:"#b4c4d5"}}>
      <div>Blok<br/><b style={{color:"#fff"}}>{unit.block}</b></div>
      <div>Kat<br/><b style={{color:"#fff"}}>{unit.floor}</b></div>
      <div>Tip<br/><b style={{color:"#fff"}}>{unit.type}</b></div>
      <div>Alan<br/><b style={{color:"#fff"}}>{unit.area?unit.area+" m²":"—"}</b></div>
      <div>Cephe<br/><b style={{color:"#fff"}}>{unit.facade}</b></div>
      <div>Fiyat<br/><b style={{color:"#fff"}}>{unit.price?unit.price.toLocaleString("tr-TR")+" ₺":"CRM'den"}</b></div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginTop:12}}>
      <button onClick={onFav} style={smallBtn(fav)}>{fav?"★ Favoride":"☆ Favori"}</button>
      <button onClick={onCompare} style={smallBtn(compare)}>{compare?"✓ Karşılaştır":"Karşılaştır"}</button>
    </div>
    <button onClick={onTour} style={{...cta("#176be0"),marginTop:8}}>360° Daireyi Gez</button>
  </div>;
}

function Filter({label,value,onChange,options,labels}:{label:string;value:string;onChange:(v:string)=>void;options:string[];labels?:Record<string,string>}){
  return <label style={{display:"grid",gap:5,fontSize:11,color:"#8fa3b8",marginBottom:10}}>
    {label}
    <select value={value} onChange={e=>onChange(e.target.value)} style={{padding:10,borderRadius:8,border:"1px solid #2b415b",background:"#0d1b2b",color:"#edf5ff"}}>
      {options.map(o=><option key={o} value={o}>{labels?.[o]||o}</option>)}
    </select>
  </label>;
}

function Metric({value,label}:{value:number;label:string}){
  return <div style={{padding:10,border:"1px solid #263a52",borderRadius:10,background:"#0d1b2b",textAlign:"center"}}><b style={{fontSize:18}}>{value}</b><div style={{fontSize:10,color:"#8fa3b8"}}>{label}</div></div>;
}

function Feature({title,text}:{title:string;text:string}){
  return <div style={{padding:14,border:"1px solid #2a3d55",borderRadius:12,background:"#0c1a29"}}><b>{title}</b><div style={{fontSize:11,color:"#91a5bb",marginTop:6,lineHeight:1.5}}>{text}</div></div>;
}

function topBtn(active:boolean){
  return {padding:"9px 12px",borderRadius:9,border:"1px solid #2a435d",background:active?"#176be0":"#0d1b2b",color:"#eef5ff",cursor:"pointer",fontWeight:700,fontSize:12} as const;
}
function tabBtn(active:boolean){
  return {padding:"9px 13px",borderRadius:9,border:active?"1px solid #4a83c5":"1px solid #263b53",background:active?"#15365a":"#0d1b2b",color:"#eef5ff",cursor:"pointer",fontWeight:800,fontSize:12,whiteSpace:"nowrap"} as const;
}
function cta(background:string){
  return {width:"100%",padding:"11px 12px",border:0,borderRadius:9,background,color:"#fff",fontWeight:900,cursor:"pointer"} as const;
}
function smallBtn(active:boolean){
  return {padding:"9px 7px",borderRadius:8,border:active?"1px solid #6f9cff":"1px solid #30455e",background:active?"#14335a":"#0b1725",color:"#eef5ff",cursor:"pointer",fontWeight:700,fontSize:11} as const;
}
function legend(color:string){
  return {display:"inline-flex",alignItems:"center",gap:6,padding:"7px 9px",borderRadius:999,background:"#091624cc",border:"1px solid #263a52",fontSize:10,color:"#dbe8f5",boxShadow:`inset 10px 0 0 ${color}`} as const;
}
function statusPill(status:UnitStatus){
  const colors={available:["#123f2a","#69d99a"],reserved:["#4a3516","#f3c36b"],sold:["#4a2026","#f27c83"]} as const;
  return {fontSize:10,padding:"4px 7px",borderRadius:999,background:colors[status][0],color:colors[status][1],fontWeight:800} as const;
}
