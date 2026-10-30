export const runtime = "nodejs";

const ENGINE_URL = process.env.FLOORPLAN_ENGINE_URL || "http://127.0.0.1:8000";

export async function GET() {
  try {
    const response = await fetch(`${ENGINE_URL}/healthz`, { cache: "no-store" });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "application/json" }
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: "floorplan_engine_unreachable",
        detail: error instanceof Error ? error.message : String(error)
      },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  const incoming = await request.formData();
  const file = incoming.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "Kat planı dosyası bulunamadı." }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".svg")) {
    return Response.json(
      { error: "İlk gerçek geometri motoru sürümü SVG kat planı kabul ediyor." },
      { status: 415 }
    );
  }

  const outgoing = new FormData();
  outgoing.append("svg", file, file.name);

  try {
    const response = await fetch(`${ENGINE_URL}/extract`, {
      method: "POST",
      body: outgoing,
      cache: "no-store"
    });

    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "application/json" }
    });
  } catch (error) {
    return Response.json(
      {
        error: "Geometri motoruna ulaşılamadı.",
        detail: error instanceof Error ? error.message : String(error)
      },
      { status: 503 }
    );
  }
}
