import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(){
  try{
    const path=join(process.cwd(),"node_modules","web-ifc","web-ifc.wasm");
    const bytes=await readFile(path);
    return new NextResponse(bytes,{
      status:200,
      headers:{
        "content-type":"application/wasm",
        "cache-control":"public, max-age=31536000, immutable"
      }
    });
  }catch(error:any){
    return NextResponse.json({
      error:"WEB_IFC_WASM_NOT_FOUND",
      detail:String(error?.message||error)
    },{status:500});
  }
}
