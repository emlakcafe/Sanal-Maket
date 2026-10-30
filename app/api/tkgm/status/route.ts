import { NextResponse } from "next/server";
import { megsisConfigured } from "@/lib/tkgm/megsis";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    configured: megsisConfigured(),
    provider: "TKGM/MEGSIS WFS",
    message: megsisConfigured()
      ? "Yetkili TKGM/MEGSIS servis erişimi yapılandırılmış."
      : "TKGM/MEGSIS servis URL ve typeName bilgileri eksik."
  });
}
