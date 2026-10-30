"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ParcelPoint, ProjectScenario } from "@/lib/planning/parcelPlanner";

type Props = {
  parcel: ParcelPoint[];
  buildable: ParcelPoint[];
  scenario: ProjectScenario;
};

type LocalPoint = { x:number; y:number };

function centroid(points: ParcelPoint[]) {
  const usable = points.length > 1 && points[0][0] === points[points.length-1][0] && points[0][1] === points[points.length-1][1]
    ? points.slice(0,-1) : points;
  const c = usable.reduce((a,[lon,lat])=>({lon:a.lon+lon,lat:a.lat+lat}),{lon:0,lat:0});
  return { lon:c.lon/usable.length, lat:c.lat/usable.length };
}

function makeProjectGeoJSON(buildable: ParcelPoint[], scenario: ProjectScenario) {
  const center = centroid(buildable);
  const lat0 = center.lat * Math.PI / 180;
  const mx = 111320 * Math.cos(lat0);
  const my = 110540;

  const local = buildable.map(([lon,lat])=>({
    x:(lon-center.lon)*mx,
    y:(lat-center.lat)*my
  }));

  let xx=0, yy=0, xy=0;
  for(const p of local){xx+=p.x*p.x;yy+=p.y*p.y;xy+=p.x*p.y;}
  const angle = 0.5*Math.atan2(2*xy,xx-yy);
  const ca=Math.cos(-angle), sa=Math.sin(-angle);
  const aligned = local.map(p=>({x:p.x*ca-p.y*sa,y:p.x*sa+p.y*ca}));
  const xs=aligned.map(p=>p.x), ys=aligned.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const width=maxX-minX, depth=maxY-minY;

  const pointInPoly=(pt:LocalPoint, poly:LocalPoint[])=>{
    let inside=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y;
      const intersect=((yi>pt.y)!==(yj>pt.y)) && (pt.x<(xj-xi)*(pt.y-yi)/((yj-yi)||1e-9)+xi);
      if(intersect)inside=!inside;
    }
    return inside;
  };

  const rotateBack=(p:LocalPoint)=>{
    const c=Math.cos(angle),s=Math.sin(angle);
    return {x:p.x*c-p.y*s,y:p.x*s+p.y*c};
  };
  const toLonLat=(p:LocalPoint):[number,number]=>[center.lon+p.x/mx,center.lat+p.y/my];

  const blocks=Math.max(1,Math.min(8,scenario.blocks));
  const targetTotal=Math.max(80,scenario.footprint*0.82);
  let blockW=Math.min(width*0.28,Math.sqrt(targetTotal/blocks)*1.35);
  let blockD=Math.min(depth*0.24,Math.max(8,(targetTotal/blocks)/Math.max(blockW,1)));
  blockW=Math.max(8,blockW); blockD=Math.max(7,blockD);

  const cols=Math.min(blocks, blocks<=3?blocks:Math.ceil(Math.sqrt(blocks)));
  const rows=Math.ceil(blocks/cols);
  const marginX=width*0.14, marginY=depth*0.16;
  const usableW=Math.max(10,width-2*marginX), usableD=Math.max(10,depth-2*marginY);

  const features:any[]=[];
  let made=0;

  for(let r=0;r<rows && made<blocks;r++){
    for(let col=0;col<cols && made<blocks;col++){
      const cx=minX+marginX+(cols===1?usableW/2:(col/(cols-1))*usableW);
      const cy=minY+marginY+(rows===1?usableD/2:(r/(rows-1))*usableD);

      let scale=1;
      let ringLocal:LocalPoint[]=[];
      for(let attempt=0;attempt<8;attempt++){
        const hw=blockW*scale/2, hd=blockD*scale/2;
        ringLocal=[
          {x:cx-hw,y:cy-hd},{x:cx+hw,y:cy-hd},
          {x:cx+hw,y:cy+hd},{x:cx-hw,y:cy+hd}
        ];
        const ok=ringLocal.every(p=>pointInPoly(p,aligned));
        if(ok)break;
        scale*=0.82;
      }
      if(!ringLocal.every(p=>pointInPoly(p,aligned))) continue;

      const ring=ringLocal.map(rotateBack).map(toLonLat);
      ring.push(ring[0]);
      features.push({
        type:"Feature",
        properties:{
          kind:"building",
          name:`Blok ${String.fromCharCode(65+made)}`,
          height:Math.max(3.2,scenario.floors*3.15),
          color:["#e8e2d6","#d8dde2","#d8c9b7","#d7e0d1"][made%4]
        },
        geometry:{type:"Polygon",coordinates:[ring]}
      });
      made++;
    }
  }

  const poolSize=Math.min(width,depth)*0.12;
  if(scenario.poolArea>0){
    const p=[
      {x:-poolSize,y:-poolSize*0.45},{x:poolSize,y:-poolSize*0.45},
      {x:poolSize,y:poolSize*0.45},{x:-poolSize,y:poolSize*0.45}
    ].map(rotateBack).map(toLonLat);
    p.push(p[0]);
    features.push({type:"Feature",properties:{kind:"pool"},geometry:{type:"Polygon",coordinates:[p]}});
  }

  return {type:"FeatureCollection",features};
}

export default function Satellite3DProjectMap({parcel,buildable,scenario}:Props){
  const hostRef=useRef<HTMLDivElement|null>(null);
  const mapRef=useRef<any>(null);
  const rafRef=useRef<number|undefined>(undefined);
  const [tour,setTour]=useState(false);

  const geojson=useMemo(()=>makeProjectGeoJSON(buildable,scenario),[buildable,scenario]);

  useEffect(()=>{
    const host=hostRef.current;
    if(!host || parcel.length<3 || buildable.length<3)return;
    let disposed=false;

    (async()=>{
      const ml=await import("maplibre-gl");
      if(disposed || !hostRef.current)return;
      const maplibre=(ml as any).default ?? ml;

      const map=new maplibre.Map({
        container:hostRef.current,
        style:{
          version:8,
          sources:{
            satellite:{
              type:"raster",
              tiles:["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
              tileSize:256,
              attribution:"Tiles © Esri"
            }
          },
          layers:[{id:"satellite",type:"raster",source:"satellite"}]
        },
        center:[parcel[0][0],parcel[0][1]],
        zoom:18,
        pitch:58,
        bearing:-25,
        antialias:true
      });
      mapRef.current=map;

      map.addControl(new maplibre.NavigationControl({visualizePitch:true}),"top-right");

      map.on("load",()=>{
        map.addSource("project",{type:"geojson",data:geojson as any});
        map.addLayer({
          id:"project-buildings",
          type:"fill-extrusion",
          source:"project",
          filter:["==",["get","kind"],"building"],
          paint:{
            "fill-extrusion-color":["get","color"],
            "fill-extrusion-height":["get","height"],
            "fill-extrusion-base":0,
            "fill-extrusion-opacity":0.92
          }
        });
        map.addLayer({
          id:"project-pool",
          type:"fill",
          source:"project",
          filter:["==",["get","kind"],"pool"],
          paint:{"fill-color":"#4bc3ef","fill-opacity":0.8}
        });

        const bounds=new maplibre.LngLatBounds();
        parcel.forEach(([lon,lat])=>bounds.extend([lon,lat]));
        map.fitBounds(bounds,{padding:70,maxZoom:19,duration:0});
        map.setPitch(58);
      });
    })();

    return ()=>{
      disposed=true;
      if(rafRef.current)cancelAnimationFrame(rafRef.current);
      mapRef.current?.remove();
      mapRef.current=null;
    };
  },[parcel,buildable,geojson]);

  useEffect(()=>{
    if(!tour){
      if(rafRef.current)cancelAnimationFrame(rafRef.current);
      return;
    }
    let last=performance.now();
    const spin=(now:number)=>{
      const map=mapRef.current;
      if(!map)return;
      const dt=(now-last)/1000; last=now;
      map.rotateTo(map.getBearing()+dt*8,{duration:0});
      rafRef.current=requestAnimationFrame(spin);
    };
    rafRef.current=requestAnimationFrame(spin);
    return ()=>{if(rafRef.current)cancelAnimationFrame(rafRef.current);};
  },[tour]);

  return <div style={{position:"relative"}}>
    <div ref={hostRef} style={{width:"100%",height:560,borderRadius:14,overflow:"hidden",background:"#0b1720"}}/>
    <div style={{position:"absolute",left:14,bottom:14,display:"flex",gap:8,zIndex:5}}>
      <button type="button" onClick={()=>setTour(v=>!v)} style={{padding:"10px 14px",borderRadius:8,border:"1px solid #ffffff66",background:"#0b2f66e8",color:"#fff",fontWeight:700,cursor:"pointer"}}>
        {tour?"360° Turu Durdur":"360° Proje Turunu Başlat"}
      </button>
      <button type="button" onClick={()=>{mapRef.current?.easeTo({bearing:0,pitch:58,duration:700});}} style={{padding:"10px 14px",borderRadius:8,border:"1px solid #ffffff66",background:"#ffffffdd",color:"#123a70",fontWeight:700,cursor:"pointer"}}>
        Kuzeye Dön
      </button>
    </div>
  </div>;
}
