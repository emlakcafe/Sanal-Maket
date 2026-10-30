export type ParcelPoint = [number, number];

export type ZoningInput = {
  parcelArea: number;
  taks: number;
  kaks: number;
  maxFloors: number;
  frontSetback: number;
  sideSetback: number;
  rearSetback: number;
  useType: "residential" | "mixed" | "tourism";
  target: "auto" | "villa" | "apartment" | "site";
  avgUnitGross: number;
  buildableArea?: number;
};

export type ProjectScenario = {
  id: "villa" | "apartment" | "site";
  title: string;
  description: string;
  score: number;
  footprint: number;
  grossConstruction: number;
  floors: number;
  blocks: number;
  estimatedUnits: number;
  parking: number;
  greenArea: number;
  socialArea: number;
  poolArea: number;
  sportsArea: number;
  notes: string[];
};

export function calculatePolygonAreaSqm(points: ParcelPoint[]) {
  if (points.length < 3) return 0;
  const lat0 = points.reduce((s, p) => s + p[1], 0) / points.length;
  const rad = Math.PI / 180;
  const mx = 111320 * Math.cos(lat0 * rad);
  const my = 110540;
  const x0 = points[0][0];
  const y0 = points[0][1];
  const local = points.map(([lon, lat]) => [(lon - x0) * mx, (lat - y0) * my] as [number, number]);
  let a = 0;
  for (let i = 0; i < local.length; i++) {
    const [x1, y1] = local[i];
    const [x2, y2] = local[(i + 1) % local.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function clamp(v:number,min:number,max:number){ return Math.max(min,Math.min(max,v)); }

export function buildScenarios(input: ZoningInput): ProjectScenario[] {
  const area = Math.max(1, input.parcelArea);
  const zoningFootprint = Math.max(1, area * input.taks);
  const maxFootprint = Math.max(1, Math.min(zoningFootprint, input.buildableArea || zoningFootprint));
  const maxGross = Math.max(maxFootprint, area * input.kaks);
  const floors = clamp(Math.ceil(maxGross / maxFootprint), 1, input.maxFloors);
  const buildableGross = Math.min(maxGross, maxFootprint * floors);
  const openArea = Math.max(0, area - maxFootprint);

  const villaUnits = Math.max(1, Math.floor(buildableGross / Math.max(180, input.avgUnitGross * 1.8)));
  const aptUnits = Math.max(1, Math.floor(buildableGross / Math.max(80, input.avgUnitGross)));
  const siteUnits = Math.max(4, Math.floor(buildableGross / Math.max(75, input.avgUnitGross * .92)));

  const villa: ProjectScenario = {
    id:"villa",
    title:"Villa / Müstakil Yaşam",
    description:"Düşük yoğunluklu, bahçe ve özel kullanım alanı güçlü konsept.",
    score: clamp(Math.round(92 - Math.max(0, villaUnits - 14) * 2), 58, 96),
    footprint: Math.min(maxFootprint, area * .28),
    grossConstruction: Math.min(buildableGross, villaUnits * 220),
    floors: Math.min(2, input.maxFloors),
    blocks: villaUnits,
    estimatedUnits: villaUnits,
    parking: villaUnits * 2,
    greenArea: Math.round(openArea * .72),
    socialArea: Math.round(openArea * .10),
    poolArea: area > 1800 ? Math.round(Math.min(180, openArea * .08)) : 0,
    sportsArea: area > 3500 ? Math.round(Math.min(280, openArea * .10)) : 0,
    notes:["Özel bahçe odaklı yerleşim","Araç erişimi ring veya cep yol ile çözülebilir","Parsel geometrisine göre villa aksları optimize edilir"]
  };

  const apartmentBlocks = area < 1200 ? 1 : area < 3500 ? 2 : Math.min(5, Math.max(2, Math.round(area / 2200)));
  const apartment: ProjectScenario = {
    id:"apartment",
    title:"Apartman / Butik Konut",
    description:"Parsel verimliliği ve satış hızını dengeleyen orta yoğunluklu çözüm.",
    score: clamp(Math.round(78 + Math.min(16, input.kaks * 8)), 62, 95),
    footprint: Math.min(maxFootprint, area * .34),
    grossConstruction: buildableGross,
    floors,
    blocks: apartmentBlocks,
    estimatedUnits: aptUnits,
    parking: Math.ceil(aptUnits * 1.15),
    greenArea: Math.round(openArea * .52),
    socialArea: Math.round(openArea * .14),
    poolArea: area > 2400 ? Math.round(Math.min(220, openArea * .10)) : 0,
    sportsArea: area > 4200 ? Math.round(Math.min(320, openArea * .10)) : 0,
    notes:["1+1 / 2+1 / 3+1 dağılımı ayrıca optimize edilebilir","Zemin katta ticari birim opsiyonu eklenebilir","Cephe ve gün ışığı yönlenmesi ikinci aşamada puanlanır"]
  };

  const siteBlocks = area < 2500 ? 2 : area < 6000 ? 3 : Math.min(8, Math.max(3, Math.round(area / 1800)));
  const site: ProjectScenario = {
    id:"site",
    title:"Site / Büyük Proje",
    description:"Bloklar, sosyal tesisler, otopark ve dolaşım sistemini birlikte kurgulayan proje.",
    score: clamp(Math.round(72 + Math.min(22, area / 450) + Math.min(10, input.kaks * 4)), 60, 97),
    footprint: Math.min(maxFootprint, area * .32),
    grossConstruction: buildableGross,
    floors,
    blocks: siteBlocks,
    estimatedUnits: siteUnits,
    parking: Math.ceil(siteUnits * 1.2),
    greenArea: Math.round(openArea * .46),
    socialArea: Math.round(openArea * .18),
    poolArea: area > 2800 ? Math.round(Math.min(360, openArea * .12)) : 0,
    sportsArea: area > 3800 ? Math.round(Math.min(500, openArea * .12)) : 0,
    notes:["Merkezi sosyal alan + blok çevresi yeşil doku","Yaya ve araç sirkülasyonu ayrıştırılabilir","Açık/kapalı otopark alternatifi üretilebilir"]
  };

  const all = [villa, apartment, site];
  if (input.target === "auto") return all.sort((a,b)=>b.score-a.score);
  return all.sort((a,b)=>a.id === input.target ? -1 : b.id === input.target ? 1 : b.score-a.score);
}
