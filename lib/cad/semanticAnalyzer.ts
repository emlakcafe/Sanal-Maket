import DxfParser from "dxf-parser";

export type SemanticKind =
  | "wall" | "column" | "door" | "window" | "stair"
  | "axis" | "dimension" | "text" | "slab" | "roof"
  | "furniture" | "unknown";

export type SemanticLayer = {
  name: string;
  kind: SemanticKind;
  confidence: number;
  entityCount: number;
};

export type SemanticEntity = {
  type: string;
  layer: string;
  kind: SemanticKind;
  vertices?: Array<{x:number;y:number;z?:number}>;
  center?: {x:number;y:number;z?:number};
  radius?: number;
  text?: string;
};

export type CadSemanticAnalysis = {
  layers: SemanticLayer[];
  entities: SemanticEntity[];
  counts: Record<SemanticKind, number>;
  texts: Array<{layer:string;text:string}>;
  bounds: {minX:number;minY:number;maxX:number;maxY:number} | null;
  warnings: string[];
};

const RULES:Array<{kind:SemanticKind;tokens:string[]}> = [
  { kind:"wall", tokens:["DUVAR","WALL","A-WALL","MIM-DUVAR","MIM_DUVAR","MIMARI DUVAR"] },
  { kind:"column", tokens:["KOLON","COLUMN","COL","BETONARME KOLON"] },
  { kind:"door", tokens:["KAPI","DOOR","KA-","KAPI-PEN","KAPI_PEN"] },
  { kind:"window", tokens:["PENCERE","WINDOW","PEN","KA-PEN","KAPI-PEN","KAPI_PEN"] },
  { kind:"stair", tokens:["MERDIVEN","STAIR","STAIRS"] },
  { kind:"axis", tokens:["AKS","AXIS","GRID"] },
  { kind:"dimension", tokens:["OLCU","ÖLÇÜ","DIM","DIMENSION"] },
  { kind:"text", tokens:["YAZI","TEXT","TXT","ACIKLAMA","AÇIKLAMA","NOT"] },
  { kind:"slab", tokens:["DOSEME","DÖŞEME","SLAB","FLOOR"] },
  { kind:"roof", tokens:["CATI","ÇATI","ROOF"] },
  { kind:"furniture", tokens:["MOBILYA","MOBİLYA","FURN","FURNITURE","ESYA","EŞYA"] }
];

function normalize(s:string){
  return s.toUpperCase().replace(/İ/g,"I").replace(/Ş/g,"S").replace(/Ğ/g,"G").replace(/Ü/g,"U").replace(/Ö/g,"O").replace(/Ç/g,"C");
}

export function classifyLayer(name:string): {kind:SemanticKind;confidence:number} {
  const n=normalize(name);
  let best:{kind:SemanticKind;confidence:number}={kind:"unknown",confidence:0};
  for(const r of RULES){
    for(const token of r.tokens){
      const t=normalize(token);
      if(n===t) return {kind:r.kind,confidence:1};
      if(n.includes(t)){
        const confidence=Math.min(.96,.62+t.length/Math.max(n.length,1)*.35);
        if(confidence>best.confidence) best={kind:r.kind,confidence};
      }
    }
  }
  return best;
}

export function analyzeDxfText(text:string): CadSemanticAnalysis {
  const parser=new DxfParser();
  const doc:any=parser.parseSync(text);
  const layerCounts=new Map<string,number>();
  const entities:SemanticEntity[]=[];
  const texts:Array<{layer:string;text:string}>=[];
  const counts:Record<SemanticKind,number>={
    wall:0,column:0,door:0,window:0,stair:0,axis:0,dimension:0,text:0,slab:0,roof:0,furniture:0,unknown:0
  };

  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const addPt=(p:any)=>{
    const x=Number(p?.x), y=Number(p?.y);
    if(!Number.isFinite(x)||!Number.isFinite(y)) return;
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  };

  for(const e of doc?.entities||[]){
    const layer=String(e.layer||"0");
    layerCounts.set(layer,(layerCounts.get(layer)||0)+1);
    let {kind}=classifyLayer(layer);

    const type=String(e.type||"");
    if((type==="TEXT"||type==="MTEXT") && kind==="unknown") kind="text";
    if(type==="DIMENSION" && kind==="unknown") kind="dimension";

    const se:SemanticEntity={type,layer,kind};
    if(Array.isArray(e.vertices)){
      se.vertices=e.vertices.map((v:any)=>({x:Number(v.x||0),y:Number(v.y||0),z:Number(v.z||0)}));
      se.vertices.forEach(addPt);
    }
    if(e.start && e.end){
      se.vertices=[{x:Number(e.start.x||0),y:Number(e.start.y||0)},{x:Number(e.end.x||0),y:Number(e.end.y||0)}];
      se.vertices.forEach(addPt);
    }
    if(e.center){
      se.center={x:Number(e.center.x||0),y:Number(e.center.y||0),z:Number(e.center.z||0)};
      addPt(e.center);
    }
    if(Number.isFinite(Number(e.radius))) se.radius=Number(e.radius);

    const rawText=String(e.text ?? e.string ?? e.textValue ?? "").trim();
    if(rawText){
      se.text=rawText;
      texts.push({layer,text:rawText});
    }

    counts[kind]++;
    entities.push(se);
  }

  const layers=[...layerCounts.entries()].map(([name,entityCount])=>{
    const c=classifyLayer(name);
    return {name,kind:c.kind,confidence:c.confidence,entityCount};
  }).sort((a,b)=>b.confidence-a.confidence || b.entityCount-a.entityCount);

  const warnings:string[]=[];
  if(!layers.some(l=>l.kind==="wall")) warnings.push("Duvar katmanı otomatik olarak kesin tespit edilemedi.");
  if(!layers.some(l=>l.kind==="door")) warnings.push("Kapı katmanı otomatik olarak kesin tespit edilemedi.");
  if(!layers.some(l=>l.kind==="window")) warnings.push("Pencere katmanı otomatik olarak kesin tespit edilemedi.");
  if(layers.filter(l=>l.kind==="unknown").length>0) warnings.push("Bazı katmanlar eşleştirilmedi; 3D üretimde bu katmanlar uydurulmayacak.");

  return {
    layers,entities,counts,texts:texts.slice(0,5000),
    bounds:Number.isFinite(minX)?{minX,minY,maxX,maxY}:null,
    warnings
  };
}
