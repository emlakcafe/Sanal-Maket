import { NextResponse } from "next/server";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const execFileAsync=promisify(execFile);

export async function POST(request:Request){
  const work=await mkdtemp(join(tmpdir(),"emlak-cafe-ifc-"));
  try{
    const body=await request.json();
    const analysis=body?.analysis;
    const floorHeight=Number(body?.floorHeight||3);

    if(!analysis?.wallSegments?.length){
      return NextResponse.json({
        error:"NO_RECONSTRUCTED_WALLS",
        detail:"IFC üretimi için yeniden oluşturulmuş duvar verisi bulunamadı."
      },{status:400});
    }

    const inputPath=join(work,"analysis.json");
    const outputPath=join(work,"ground-floor.ifc");
    const scriptPath=join(process.cwd(),"scripts","cad","build_ifc.py");
    const localPython=join(process.cwd(),".venv-cad","Scripts","python.exe");
    const python=process.env.EZDXF_PYTHON?.trim()||localPython;

    await writeFile(inputPath,JSON.stringify({...analysis,floorHeight}),"utf8");

    const {stdout}=await execFileAsync(
      python,[scriptPath,inputPath,outputPath],
      {
        windowsHide:true,
        timeout:180000,
        maxBuffer:16*1024*1024,
        encoding:"utf8",
        env:{...process.env,PYTHONIOENCODING:"utf-8"}
      }
    );

    const raw=String(stdout||"").trim();
    const meta=raw?JSON.parse(raw):{};
    if(meta?.error) return NextResponse.json(meta,{status:422});

    const bytes=await readFile(outputPath);
    return NextResponse.json({
      ...meta,
      ifcBase64:bytes.toString("base64")
    });
  }catch(error:any){
    return NextResponse.json({
      error:"IFC_BUILD_FAILED",
      detail:String(error?.stderr||error?.message||error)
    },{status:500});
  }finally{
    await rm(work,{recursive:true,force:true}).catch(()=>undefined);
  }
}
