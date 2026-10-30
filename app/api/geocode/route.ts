export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  if (!q) return Response.json({ error: "q gerekli" }, { status: 400 });

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "tr");
  url.searchParams.set("q", q);

  const response = await fetch(url, {
    headers: { "User-Agent": "EmlakCafe-SanalMaket/0.6" },
    cache: "no-store"
  });

  if (!response.ok) {
    return Response.json({ error: "Konum servisine ulaşılamadı" }, { status: 502 });
  }

  const results = await response.json();
  if (!Array.isArray(results) || !results.length) {
    return Response.json({ error: "Konum bulunamadı" }, { status: 404 });
  }

  return Response.json({
    lat: Number(results[0].lat),
    lon: Number(results[0].lon),
    displayName: results[0].display_name
  });
}
