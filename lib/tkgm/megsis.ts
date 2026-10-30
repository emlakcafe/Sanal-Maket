export type ParcelLookup = {
  city: string;
  district: string;
  neighborhood: string;
  block: string;
  parcel: string;
};

export type GeoJsonGeometry = {
  type: string;
  coordinates: any;
};

export type ParcelResult = {
  geometry: GeoJsonGeometry;
  properties: Record<string, unknown>;
  centroid: { lat: number; lon: number };
};

function escapeCql(value: string) {
  return value.replace(/'/g, "''");
}

function numericPoints(coords: any): [number, number][] {
  const out: [number, number][] = [];
  const walk = (value: any) => {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      out.push([value[0], value[1]]);
      return;
    }
    if (Array.isArray(value)) value.forEach(walk);
  };
  walk(coords);
  return out;
}

function centroidOfGeometry(geometry: GeoJsonGeometry) {
  const pts = numericPoints(geometry.coordinates);
  if (!pts.length) throw new Error("MEGSIS geometrisi koordinat içermiyor.");
  const sum = pts.reduce(
    (acc, [lon, lat]) => ({ lon: acc.lon + lon, lat: acc.lat + lat }),
    { lon: 0, lat: 0 }
  );
  return { lon: sum.lon / pts.length, lat: sum.lat / pts.length };
}

export function megsisConfigured() {
  return Boolean(process.env.TKGM_MEGSIS_WFS_URL && process.env.TKGM_MEGSIS_TYPENAME);
}

export async function lookupMegsisParcel(input: ParcelLookup): Promise<ParcelResult> {
  const baseUrl = process.env.TKGM_MEGSIS_WFS_URL;
  const typeName = process.env.TKGM_MEGSIS_TYPENAME;
  if (!baseUrl || !typeName) {
    throw new Error("TKGM/MEGSIS servis erişimi henüz yapılandırılmadı.");
  }

  const fields = {
    city: process.env.TKGM_FIELD_CITY || "il",
    district: process.env.TKGM_FIELD_DISTRICT || "ilce",
    neighborhood: process.env.TKGM_FIELD_NEIGHBORHOOD || "mahalle",
    block: process.env.TKGM_FIELD_BLOCK || "ada",
    parcel: process.env.TKGM_FIELD_PARCEL || "parsel"
  };

  const clauses = [
    `${fields.city}='${escapeCql(input.city)}'`,
    `${fields.district}='${escapeCql(input.district)}'`,
    `${fields.neighborhood}='${escapeCql(input.neighborhood)}'`,
    `${fields.block}='${escapeCql(input.block)}'`,
    `${fields.parcel}='${escapeCql(input.parcel)}'`
  ];

  const url = new URL(baseUrl);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", process.env.TKGM_MEGSIS_WFS_VERSION || "2.0.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typeNames", typeName);
  url.searchParams.set("outputFormat", process.env.TKGM_MEGSIS_OUTPUT_FORMAT || "application/json");
  url.searchParams.set("srsName", "EPSG:4326");
  url.searchParams.set("count", "2");
  url.searchParams.set("CQL_FILTER", clauses.join(" AND "));

  const headers: Record<string, string> = { Accept: "application/json" };
  const bearer = process.env.TKGM_MEGSIS_BEARER_TOKEN;
  const user = process.env.TKGM_MEGSIS_USERNAME;
  const pass = process.env.TKGM_MEGSIS_PASSWORD;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  else if (user && pass) {
    headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  }

  const response = await fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`MEGSIS servisi HTTP ${response.status} döndürdü: ${raw.slice(0, 240)}`);
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("MEGSIS yanıtı GeoJSON/JSON değil. Servisin outputFormat ayarını kontrol edin.");
  }

  const feature = payload?.features?.[0];
  if (!feature?.geometry) {
    throw new Error("Bu bilgilerle MEGSIS üzerinde parsel bulunamadı.");
  }

  return {
    geometry: feature.geometry,
    properties: feature.properties || {},
    centroid: centroidOfGeometry(feature.geometry)
  };
}
