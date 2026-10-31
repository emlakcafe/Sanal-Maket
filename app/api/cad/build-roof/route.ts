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
  const work=await mkdtemp(join(tmpdir(),"emlak-cafe-roof-"));
  try{
    const body=await request.json();
    const analysis=body?.analysis;
    if(!analysis?.entities?.length){
      return NextResponse.json({error:"NO_ROOF_ANALYSIS",detail:"Çatı analizi bulunamadı."},{status:400});
    }

    const inputPath=join(work,"analysis.json");
    const outputPath=join(work,"roof.glb");
    const scriptPath=join(process.cwd(),"scripts","cad","build_roof_glb.py");
    const localPython=join(process.cwd(),".venv-cad","Scripts","python.exe");
    const python=process.env.EZDXF_PYTHON?.trim()||localPython;

    await writeFile(inputPath,JSON.stringify(analysis),"utf8");

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

    const meta=JSON.parse(String(stdout||"{}").trim()||"{}");
    if(meta?.error) return NextResponse.json(meta,{status:422});

    const bytes=await readFile(outputPath);
    return NextResponse.json({...meta,glbBase64:bytes.toString("base64")});
  }catch(error:any){
    return NextResponse.json({
      error:"ROOF_BUILD_FAILED",
      detail:String(error?.stderr||error?.message||error)
    },{status:500});
  }finally{
    await rm(work,{recursive:true,force:true}).catch(()=>undefined);
  }
}
