import { NextResponse } from "next/server";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { CadSelectionRegion } from "@/lib/cad/semanticAnalyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

export async function POST(request: Request) {
  const work = await mkdtemp(join(tmpdir(), "emlak-cafe-ezdxf-"));

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

    const dxfPath = join(work, "input.dxf");
    const selectionPath = join(work, "selection.json");
    const scriptPath = join(process.cwd(), "scripts", "cad", "analyze_ezdxf.py");
    const configuredPython = process.env.EZDXF_PYTHON?.trim();
    const localPython = join(process.cwd(), ".venv-cad", "Scripts", "python.exe");
    let python = configuredPython || localPython;

    if (!configuredPython) {
      try {
        await import("fs/promises").then(fs => fs.access(localPython));
      } catch {
        python = "python";
      }
    }

    await writeFile(dxfPath, dxfText, "utf8");
    await writeFile(selectionPath, JSON.stringify(selection), "utf8");

    try {
      const { stdout, stderr } = await execFileAsync(
        python,
        [scriptPath, dxfPath, selectionPath],
        {
          windowsHide: true,
          timeout: 180000,
          maxBuffer: 64 * 1024 * 1024,
          encoding: "utf8"
        }
      );

      const raw = String(stdout || "").trim();
      if (!raw) {
        return NextResponse.json({
          error: "EZDXF_EMPTY_RESULT",
          detail: String(stderr || "ezdxf motoru sonuc dondurmedi.")
        }, { status: 500 });
      }

      const result = JSON.parse(raw);
      if (result?.error) {
        const status = result.error === "EZDXF_NOT_INSTALLED" ? 503 : 422;
        return NextResponse.json(result, { status });
      }

      return NextResponse.json(result);
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        return NextResponse.json({
          error: "EZDXF_PYTHON_NOT_FOUND",
          detail: "Python bulunamadi. EZDXF_PYTHON ayarlanabilir veya Python PATH'e eklenebilir."
        }, { status: 503 });
      }

      const stdout = String(error?.stdout || "").trim();
      if (stdout) {
        try {
          const parsed = JSON.parse(stdout);
          return NextResponse.json(parsed, {
            status: parsed?.error === "EZDXF_NOT_INSTALLED" ? 503 : 422
          });
        } catch {}
      }

      return NextResponse.json({
        error: "EZDXF_ANALYSIS_FAILED",
        detail: String(error?.stderr || error?.message || error)
      }, { status: 500 });
    }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}
