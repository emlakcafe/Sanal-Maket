import buffer from "@turf/buffer";
import { polygon } from "@turf/helpers";
import type { ParcelPoint } from "@/lib/planning/parcelPlanner";

export type BuildableEnvelopeResult = {
  points: ParcelPoint[];
  setbackMeters: number;
  valid: boolean;
  warning?: string;
};

function closeRing(points: ParcelPoint[]) {
  if (!points.length) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
}

function polygonAreaSqm(points: ParcelPoint[]) {
  if (points.length < 3) return 0;
  const lat0 = points.reduce((s, p) => s + p[1], 0) / points.length;
  const mx = 111320 * Math.cos(lat0 * Math.PI / 180);
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

export function createBuildableEnvelope(
  points: ParcelPoint[],
  setbacks: { front: number; side: number; rear: number }
): BuildableEnvelopeResult {
  if (points.length < 3) {
    return { points: [], setbackMeters: 0, valid: false, warning: "Parsel geometrisi yok." };
  }

  const conservative = Math.max(0, setbacks.front, setbacks.side, setbacks.rear);
  if (conservative === 0) {
    return { points, setbackMeters: 0, valid: true };
  }

  try {
    const ring = closeRing(points);
    const source = polygon([ring]);
    const result = buffer(source, -conservative / 1000, { units: "kilometers", steps: 16 });

    if (!result) {
      return {
        points: [],
        setbackMeters: conservative,
        valid: false,
        warning: "Çekme mesafeleri bu parselde yapılaşabilir alan bırakmıyor."
      };
    }

    let candidate: ParcelPoint[] = [];

    if (result.geometry.type === "Polygon") {
      candidate = result.geometry.coordinates[0].map(([lon, lat]) => [lon, lat] as ParcelPoint);
    } else if (result.geometry.type === "MultiPolygon") {
      const rings = result.geometry.coordinates.map(poly => poly[0].map(([lon, lat]) => [lon, lat] as ParcelPoint));
      candidate = rings.sort((a, b) => polygonAreaSqm(b) - polygonAreaSqm(a))[0] || [];
    }

    if (candidate.length < 3 || polygonAreaSqm(candidate) < 1) {
      return {
        points: [],
        setbackMeters: conservative,
        valid: false,
        warning: "İmar çekmeleri sonrası kullanılabilir yapılaşma alanı oluşmadı."
      };
    }

    return {
      points: candidate,
      setbackMeters: conservative,
      valid: true,
      warning: "Yol cephesi sınıflandırılana kadar en büyük çekme mesafesi tüm kenarlara uygulanmıştır."
    };
  } catch (error) {
    return {
      points: [],
      setbackMeters: conservative,
      valid: false,
      warning: error instanceof Error ? error.message : "Buildable envelope hesaplanamadı."
    };
  }
}

export function calculateEnvelopeAreaSqm(points: ParcelPoint[]) {
  return polygonAreaSqm(points);
}
