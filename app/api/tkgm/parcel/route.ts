import { NextRequest, NextResponse } from "next/server";
import { lookupMegsisParcel, megsisConfigured } from "@/lib/tkgm/megsis";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const input = {
    city: (p.get("city") || "").trim(),
    district: (p.get("district") || "").trim(),
    neighborhood: (p.get("neighborhood") || "").trim(),
    block: (p.get("block") || "").trim(),
    parcel: (p.get("parcel") || "").trim()
  };

  if (Object.values(input).some(v => !v)) {
    return NextResponse.json(
      { error: "İl, ilçe, mahalle/köy, ada ve parsel zorunludur." },
      { status: 400 }
    );
  }

  if (!megsisConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        error: "TKGM/MEGSİS yetkili servis erişimi henüz yapılandırılmadı."
      },
      { status: 503 }
    );
  }

  try {
    const result = await lookupMegsisParcel(input);
    return NextResponse.json({ configured: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 502 }
    );
  }
}
