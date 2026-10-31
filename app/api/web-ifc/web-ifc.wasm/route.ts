import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { createRequire } from "module";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const require=createRequire(import.meta.url);

export async function GET(){
  try{
    const pkgPath=require.resolve("web-ifc/package.json");
    const pkgDir=dirname(pkgPath);
    const candidates=[
      join(pkgDir,"web-ifc.wasm"),
      join(pkgDir,"dist","web-ifc.wasm"),
      join(pkgDir,"wasm","web-ifc.wasm")
    ];

    for(const candidate of candidates){
      try{
        const bytes=await readFile(candidate);
        return new NextResponse(bytes,{
          status:200,
          headers:{
            "content-type":"application/wasm",
            "cache-control":"no-store"
          }
        });
      }catch{}
    }

    return NextResponse.json({
      error:"WEB_IFC_WASM_NOT_FOUND",
      candidates
    },{status:500});
  }catch(error:any){
    return NextResponse.json({
      error:"WEB_IFC_WASM_RESOLVE_FAILED",
      detail:String(error?.message||error)
    },{status:500});
  }
}
