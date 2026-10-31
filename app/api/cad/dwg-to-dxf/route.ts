import { NextResponse } from "next/server";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { access } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const MAX_BYTES = 100 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "DWG dosyasi bulunamadi." }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".dwg")) {
    return NextResponse.json({ error: "Yalnizca .dwg dosyasi kabul edilir." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "DWG dosyasi 100 MB sinirini asiyor." }, { status: 413 });
  }

  const work = await mkdtemp(join(tmpdir(), "emlak-cafe-dwg-"));
  const input = join(work, "input.dwg");
  const output = join(work, "output.dxf");
  const configured = process.env.LIBREDWG_DWG2DXF_PATH?.trim();
  const localAppData = process.env.LOCALAPPDATA?.trim();
  const localCandidate = localAppData ? join(localAppData, "libredwg", "dwg2dxf.exe") : "";

  let command = configured || "dwg2dxf";
  if (!configured && localCandidate) {
    try {
      await access(localCandidate);
      command = localCandidate;
    } catch {
      command = "dwg2dxf";
    }
  }

  try {
    await writeFile(input, Buffer.from(await file.arrayBuffer()));
    await execFileAsync(command, ["-v0", "-y", "-o", output, input], {
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024
    });
    const dxf = await readFile(output, "utf8");
    return new NextResponse(dxf, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-emlak-cafe-converted-from": "dwg"
      }
    });
  } catch (error: any) {
    const missing = error?.code === "ENOENT";
    return NextResponse.json({
      error: missing
        ? "LibreDWG dwg2dxf bulunamadi. Uygulama PATH, LIBREDWG_DWG2DXF_PATH ve %LOCALAPPDATA%\\libredwg\\dwg2dxf.exe konumlarini kontrol etti."
        : "DWG dosyasi DXF'e donusturulemedi.",
      detail: String(error?.message || error)
    }, { status: missing ? 503 : 422 });
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}
