import { NextResponse } from "next/server";
import { analyzeDxfText, type CadSelectionRegion } from "@/lib/cad/semanticAnalyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const dxfText = String(body?.dxfText || "");
    const selection = body?.selection as CadSelectionRegion | null;

    if (!dxfText) {
      return NextResponse.json({ error: "DXF verisi bulunamadi." }, { status: 400 });
    }
    if (!selection?.polygon?.length || selection.polygon.length < 4) {
      return NextResponse.json({ error: "4 koseli plan alani secilmedi." }, { status: 400 });
    }

    const result = analyzeDxfText(dxfText, selection);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      error: "CAD analizi tamamlanamadi.",
      detail: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
