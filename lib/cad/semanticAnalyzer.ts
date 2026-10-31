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

export type CadSelectionBounds = { minX:number; minY:number; maxX:number; maxY:number };
export type CadSelectionRegion = {
  polygon: Array<{x:number;y:number}>;
  bounds: CadSelectionBounds;
};

export type ReconstructedWallSegment = {
  start:{x:number;y:number;z?:number};
  end:{x:number;y:number;z?:number};
  thickness:number;
  length:number;
  sourceLayers?:string[];
};

export type ReconstructedOpening = {
  kind:"door"|"window";
  wallIndex:number;
  t:number;
  x:number;
  y:number;
  width:number;
  source?:string;
  members?:number;
};

export type CadSemanticAnalysis = {
  engine?: string;
  dxfVersion?: string;
  layout?: string;
  selectionDiagnostics?: {
    polygon?: Array<{x:number;y:number}>;
    bounds?: {minX:number;minY:number;maxX:number;maxY:number};
  };
  layoutDiagnostics?: Array<{
    name:string;
    recognized:number;
    total:number;
    rawBounds?: {minX:number;minY:number;maxX:number;maxY:number;pointCount?:number} | null;
  }>;
  layers: SemanticLayer[];
  entities: SemanticEntity[];
  wallSegments?: ReconstructedWallSegment[];
  openings?: ReconstructedOpening[];
  reconstruction?: {
    rawWallEntityCount:number;
    wallSegmentCount:number;
    doorOpeningCount?:number;
    windowOpeningCount?:number;
    unitMode:string;
    unitScale:number;
  };
  counts: Record<SemanticKind, number>;
  texts: Array<{layer:string;text:string}>;
  bounds: {minX:number;minY:number;maxX:number;maxY:number} | null;
  warnings: string[];
};

type Affine = {a:number;b:number;c:number;d:number;tx:number;ty:number};

const RULES:Array<{kind:SemanticKind;tokens:string[]}> = [
  { kind:"wall", tokens:["DUVAR","WALL","A-WALL","MIM-DUVAR","MIM_DUVAR","MIMARI DUVAR"] },
  { kind:"column", tokens:["KOLON","COLUMN","COL","BETONARME KOLON"] },
  { kind:"door", tokens:["KAPI","DOOR","KAPI-PEN","KAPI_PEN"] },
  { kind:"window", tokens:["PENCERE","WINDOW","KA-PEN","KAPI-PEN","KAPI_PEN"] },
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
      const tokenLike = n.startsWith(t + "-") || n.startsWith(t + "_") || n.endsWith("-" + t) || n.endsWith("_" + t) || n.includes("-" + t + "-") || n.includes("_" + t + "_");
      if(tokenLike){
        const confidence=Math.min(.94,.68+t.length/Math.max(n.length,1)*.25);
        if(confidence>best.confidence) best={kind:r.kind,confidence};
      }
    }
  }
  return best;
}

function pointInPolygon(p:{x:number;y:number}, poly:Array<{x:number;y:number}>){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i], b=poly[j];
    const hit=((a.y>p.y)!==(b.y>p.y)) &&
      (p.x < (b.x-a.x)*(p.y-a.y)/((b.y-a.y)||1e-9)+a.x);
    if(hit) inside=!inside;
  }
  return inside;
}

function entityInsideRegion(e:SemanticEntity,region?:CadSelectionRegion|null){
  if(!region) return true;
  const pts=[...(e.vertices||[])];
  if(e.center) pts.push(e.center);
  if(!pts.length) return false;
  return pts.some(p =>
    p.x>=region.bounds.minX && p.x<=region.bounds.maxX &&
    p.y>=region.bounds.minY && p.y<=region.bounds.maxY &&
    pointInPolygon(p,region.polygon)
  );
}

function identity():Affine{
  return {a:1,b:0,c:0,d:1,tx:0,ty:0};
}

function multiply(p:Affine,q:Affine):Affine{
  return {
    a:p.a*q.a+p.c*q.b,
    b:p.b*q.a+p.d*q.b,
    c:p.a*q.c+p.c*q.d,
    d:p.b*q.c+p.d*q.d,
    tx:p.a*q.tx+p.c*q.ty+p.tx,
    ty:p.b*q.tx+p.d*q.ty+p.ty
  };
}

function apply(m:Affine,p:any){
  const x=Number(p?.x||0), y=Number(p?.y||0);
  return {x:m.a*x+m.c*y+m.tx,y:m.b*x+m.d*y+m.ty,z:Number(p?.z||0)};
}

function insertMatrix(insert:any, base:any):Affine{
  const sx=Number.isFinite(Number(insert?.xScale))?Number(insert.xScale):1;
  const sy=Number.isFinite(Number(insert?.yScale))?Number(insert.yScale):1;
  const angle=(Number(insert?.rotation||0)*Math.PI)/180;
  const cos=Math.cos(angle), sin=Math.sin(angle);
  const bx=Number(base?.x||0), by=Number(base?.y||0);
  const px=Number(insert?.position?.x||0), py=Number(insert?.position?.y||0);

  const local:Affine={
    a:cos*sx,b:sin*sx,
    c:-sin*sy,d:cos*sy,
    tx:px-(cos*sx*bx)+sin*sy*by,
    ty:py-(sin*sx*bx)-cos*sy*by
  };
  return local;
}

function convertEntity(e:any, layerOverride:string|undefined, matrix:Affine):SemanticEntity|null{
  const ownLayer=String(e?.layer||"0");
  const layer=ownLayer==="0" && layerOverride ? layerOverride : ownLayer;
  let {kind}=classifyLayer(layer);
  const type=String(e?.type||"");

  if((type==="TEXT"||type==="MTEXT") && kind==="unknown") kind="text";
  if(type==="DIMENSION" && kind==="unknown") kind="dimension";

  const se:SemanticEntity={type,layer,kind};

  if(Array.isArray(e?.vertices)){
    se.vertices=e.vertices.map((v:any)=>apply(matrix,v));
  }else if(e?.start && e?.end){
    se.vertices=[apply(matrix,e.start),apply(matrix,e.end)];
  }

  if(e?.center){
    se.center=apply(matrix,e.center);
  }else if((type==="TEXT"||type==="MTEXT") && e?.position){
    se.center=apply(matrix,e.position);
  }

  if(Number.isFinite(Number(e?.radius))){
    const sx=Math.hypot(matrix.a,matrix.b);
    const sy=Math.hypot(matrix.c,matrix.d);
    se.radius=Number(e.radius)*((sx+sy)/2);
  }

  const rawText=String(e?.text ?? e?.string ?? e?.textValue ?? "").trim();
  if(rawText) se.text=rawText;

  return se;
}

function expandEntities(doc:any){
  const out:Array<{entity:any;layerOverride?:string;matrix:Affine}>=[];
  const blocks=doc?.blocks||{};

  const walk=(items:any[],parentMatrix:Affine,parentLayer?:string,depth=0)=>{
    if(depth>12) return;
    for(const e of items||[]){
      if(String(e?.type||"")==="INSERT"){
        const block=blocks?.[e.name];
        if(!block?.entities?.length) continue;
        const ownLayer=String(e.layer||"0");
        const effectiveLayer=ownLayer==="0" ? parentLayer : ownLayer;
        const m=multiply(parentMatrix,insertMatrix(e,block.position));
        walk(block.entities,m,effectiveLayer,depth+1);
      }else{
        out.push({entity:e,layerOverride:parentLayer,matrix:parentMatrix});
      }
    }
  };

  walk(doc?.entities||[],identity(),undefined,0);
  return out;
}

export function analyzeDxfText(text:string, selection?:CadSelectionRegion|null): CadSemanticAnalysis {
  const parser=new DxfParser();
  const doc:any=parser.parseSync(text);
  const layerCounts=new Map<string,number>();
  const entities:SemanticEntity[]=[];
  const texts:Array<{layer:string;text:string}>=[];
  const counts:Record<SemanticKind,number>={
    wall:0,column:0,door:0,window:0,stair:0,axis:0,dimension:0,text:0,slab:0,roof:0,furniture:0,unknown:0
  };

  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const addSelectedPoint=(p:any)=>{
    const x=Number(p?.x), y=Number(p?.y);
    if(!Number.isFinite(x)||!Number.isFinite(y)) return;
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  };

  const expanded=expandEntities(doc);

  for(const item of expanded){
    const se=convertEntity(item.entity,item.layerOverride,item.matrix);
    if(!se) continue;

    layerCounts.set(se.layer,(layerCounts.get(se.layer)||0)+1);

    if(!entityInsideRegion(se,selection)) continue;

    counts[se.kind]++;
    entities.push(se);
    se.vertices?.forEach(addSelectedPoint);
    if(se.center) addSelectedPoint(se.center);
    if(se.text) texts.push({layer:se.layer,text:se.text});
  }

  const layers=[...layerCounts.entries()].map(([name,entityCount])=>{
    const c=classifyLayer(name);
    return {name,kind:c.kind,confidence:c.confidence,entityCount};
  }).sort((a,b)=>b.confidence-a.confidence || b.entityCount-a.entityCount);

  const warnings:string[]=[];
  if(entities.length===0){
    warnings.push("Seçilen alanda modellenebilir CAD geometrisi bulunamadı.");
  }
  if(counts.wall===0) warnings.push("Seçilen planda duvar geometrisi bulunamadı.");
  if(counts.column===0) warnings.push("Seçilen planda kolon geometrisi bulunamadı veya farklı katmandadır.");
  if(counts.door===0) warnings.push("Seçilen planda kapı geometrisi bulunamadı veya farklı katmandadır.");
  if(counts.window===0) warnings.push("Seçilen planda pencere geometrisi bulunamadı veya farklı katmandadır.");
  if(layers.filter(l=>l.kind==="unknown").length>0) warnings.push("Bazı katmanlar eşleştirilmedi; 3D üretimde uydurulmayacak.");

  return {
    layers,
    entities,
    counts,
    texts:texts.slice(0,5000),
    bounds:Number.isFinite(minX)?{minX,minY,maxX,maxY}:null,
    warnings
  };
}
