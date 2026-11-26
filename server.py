from __future__ import annotations
import asyncio, math, re, time, unicodedata, urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit
import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

app=FastAPI(title="Emlak Cafe AI mobil test")
ADDR="https://api.turkiyeapi.dev/v2"
TKGM="https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api"
REMAX="https://remax.com.tr"
UA="EmlakCafeResearch/1.0"
cache={}
gate=asyncio.Semaphore(2)
names="Adana|Adıyaman|Afyonkarahisar|Ağrı|Amasya|Ankara|Antalya|Artvin|Aydın|Balıkesir|Bilecik|Bingöl|Bitlis|Bolu|Burdur|Bursa|Çanakkale|Çankırı|Çorum|Denizli|Diyarbakır|Edirne|Elazığ|Erzincan|Erzurum|Eskişehir|Gaziantep|Giresun|Gümüşhane|Hakkâri|Hatay|Isparta|Mersin|İstanbul|İzmir|Kars|Kastamonu|Kayseri|Kırklareli|Kırşehir|Kocaeli|Konya|Kütahya|Malatya|Manisa|Kahramanmaraş|Mardin|Muğla|Muş|Nevşehir|Niğde|Ordu|Rize|Sakarya|Samsun|Siirt|Sinop|Sivas|Tekirdağ|Tokat|Trabzon|Tunceli|Şanlıurfa|Uşak|Van|Yozgat|Zonguldak|Aksaray|Bayburt|Karaman|Kırıkkale|Batman|Şırnak|Bartın|Ardahan|Iğdır|Yalova|Karabük|Kilis|Osmaniye|Düzce".split("|")
def norm(s):
    s=str(s or "").replace("ı","i").replace("İ","I")
    s="".join(c for c in unicodedata.normalize("NFKD",s) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+"," ",s.lower()).strip()
def local(s):
    return " ".join(x for x in norm(s).split() if x not in {"mah","mahalle","mahallesi","koy","koyu"})
def slug(s):return norm(s).replace(" ","-")
def num(s):
    if isinstance(s,(int,float)):return float(s)
    s=str(s).strip().replace(" ","")
    if not re.fullmatch(r"\d+(?:[.,]\d+)*",s):return None
    if "," in s:s=s.replace(".","").replace(",",".")
    elif re.fullmatch(r"\d{1,3}(?:\.\d{3})+",s):s=s.replace(".","")
    try:return float(s)
    except ValueError:return None
async def getjson(client,url,ttl=3600):
    old=cache.get(url)
    if old and time.monotonic()-old[0]<ttl:return old[1]
    r=await client.get(url);r.raise_for_status();v=r.json()
    if len(cache)>3000:cache.clear()
    cache[url]=(time.monotonic(),v)
    return v
def client():return httpx.AsyncClient(timeout=httpx.Timeout(10.0),headers={"User-Agent":UA,"Accept":"application/json, text/html;q=0.9"},follow_redirects=False)
async def all_addresses(c,path):
    rows=[];offset=0
    for _ in range(12):
        j=await getjson(c,ADDR+path+("?"+f"limit=1000&offset={offset}&fields=id,name"))
        d=j.get("data")
        if not isinstance(d,list):raise ValueError("Adres servisi biçimi geçersiz")
        rows+=d
        offset+=len(d)
        if not d or offset>=j.get("meta",{}).get("total",offset):break
    return [{"id":x["id"],"name":x["name"]} for x in rows if isinstance(x.get("id"),int) and isinstance(x.get("name"),str)]
@app.get("/",response_class=HTMLResponse)
async def home():return Path(__file__).with_name("index.html").read_text(encoding="utf-8")
@app.get("/health")
async def health():return {"status":"ok","mode":"isolated-mobile-test","data":"live-only","sources":["TurkiyeAPI","TKGM","RE/MAX"]}
@app.get("/api/provinces")
async def provinces():return sorted([{"id":i+1,"name":n} for i,n in enumerate(names)],key=lambda x:norm(x["name"]))
@app.get("/api/districts/{province_id}")
async def districts(province_id:int):
    if not 1<=province_id<=81:raise HTTPException(400,"Geçersiz il")
    try:
        async with client() as c:return sorted(await all_addresses(c,f"/provinces/{province_id}/districts"),key=lambda x:norm(x["name"]))
    except Exception:raise HTTPException(503,"İlçe servisine erişilemedi. Yeniden deneyin.")
@app.get("/api/places/{district_id}")
async def places(district_id:int):
    if not 1<=district_id<=99999999:raise HTTPException(400,"Geçersiz ilçe")
    try:
        async with client() as c:
            n,v=await asyncio.gather(all_addresses(c,f"/districts/{district_id}/neighborhoods"),all_addresses(c,f"/districts/{district_id}/villages"))
        return sorted([dict(x,kind="mahalle") for x in n]+[dict(x,kind="köy") for x in v],key=lambda x:norm(x["name"]))
    except Exception:raise HTTPException(503,"Mahalle/köy servisine erişilemedi. Yeniden deneyin.")
class Req(BaseModel):
    province:str=Field(min_length=1,max_length=80)
    district:str=Field(min_length=1,max_length=80)
    place:str=Field(min_length=1,max_length=120)
    block:str=Field(pattern=r"^\d{1,9}$")
    parcel:str=Field(pattern=r"^[1-9]\d{0,8}$")
    zoning:str=Field(default="unknown",pattern=r"^(unknown|residential|field)$")
def properties(data):
    if isinstance(data,dict) and isinstance(data.get("features"),list):return [x.get("properties",{}) for x in data["features"] if isinstance(x,dict)]
    return []
def match(rows,name):
    exact=[r for r in rows if local(r.get("text") or r.get("name"))==local(name) and r.get("id") is not None]
    if len(exact)!=1:raise ValueError("TKGM adresi tekil olarak eşleşmedi: "+name)
    return str(exact[0]["id"])
async def locality(c,req):
    p=match(properties(await getjson(c,TKGM+"/idariYapi/ilListe")),req.province)
    d=match(properties(await getjson(c,TKGM+"/idariYapi/ilceListe/"+p)),req.district)
    return match(properties(await getjson(c,TKGM+"/idariYapi/mahalleListe/"+d)),req.place)
def coords(v):
    if isinstance(v,list):
        if len(v)>=2 and all(isinstance(x,(int,float)) for x in v[:2]):return [(float(v[0]),float(v[1]))]
        return [p for a in v for p in coords(a)]
    return []
def center(g):
    pts=coords(g.get("coordinates"))
    if g.get("type") not in {"Polygon","MultiPolygon"} or len(pts)<4 or any(not(25<=x<=46 and 35<=y<=43) for x,y in pts):raise ValueError("Geçerli WGS84 parsel geometrisi alınamadı")
    return [(min(y for x,y in pts)+max(y for x,y in pts))/2,(min(x for x,y in pts)+max(x for x,y in pts))/2]
async def parcel_data(c,loc,block,parcel):
    if not str(loc).isdigit():raise ValueError("TKGM adres kimliği geçersiz")
    j=await getjson(c,TKGM+f"/parsel/{loc}/{int(block)}/{int(parcel)}",900)
    if j.get("type")=="FeatureCollection":
        fs=j.get("features",[])
        if len(fs)!=1:raise ValueError("Tekil parsel bulunamadı")
        j=fs[0]
    p=j.get("properties") or {};g=j.get("geometry") or {}
    if str(p.get("adaNo",block))!=str(int(block)) or str(p.get("parselNo",parcel))!=str(int(parcel)):raise ValueError("Ada/parsel yanıtı uyuşmuyor")
    return {"block":block,"parcel":parcel,"area":num(p.get("alan")),"nature":p.get("nitelik"),"geometry":g,"center":center(g),"source":"TKGM MEGSİS"}
def distance(a,b):
    la,lb=map(math.radians,[a[0],b[0]])
    h=math.sin((lb-la)/2)**2+math.cos(la)*math.cos(lb)*math.sin(math.radians(b[1]-a[1])/2)**2
    return 12742000*math.asin(min(1,math.sqrt(h)))
def field(tokens,keys):
    for i,t in enumerate(tokens[:-1]):
        if norm(t) in keys:return tokens[i+1].strip()
    return ""
def listing_type(s):
    n=norm(s)
    if "satilik" not in n:return "unknown"
    if any(x in n for x in ("tarla","tarim arazisi","bag bahce","bag ve bahce")):return "field"
    if "konut imarli" in n or "villa" in n:return "residential"
    return "unknown"
async def search_remax(c,req):
    url=REMAX+"/tr/arsa-arazi/satilik/"+slug(req.province)+"/"+slug(req.district)
    robots=await c.get(REMAX+"/robots.txt")
    if robots.status_code!=200:raise ValueError("RE/MAX erişim kuralları doğrulanamadı")
    rp=urllib.robotparser.RobotFileParser();rp.parse(robots.text.splitlines())
    if not rp.can_fetch(UA,url):raise ValueError("RE/MAX otomatik erişime izin vermiyor")
    resp=await c.get(url);resp.raise_for_status()
    soup=BeautifulSoup(resp.text,"html.parser")
    urls=[]
    for a in soup.select("a[href]"):
        u=urljoin(url,a.get("href",""));p=urlsplit(u)
        if p.scheme=="https" and p.hostname=="remax.com.tr" and re.fullmatch(r"/tr/portfoy/P\d+/?",p.path,re.I):
            u=REMAX+p.path.rstrip("/")
            if u not in urls and rp.can_fetch(UA,u):urls.append(u)
    if not urls:raise ValueError("RE/MAX sayfasında okunabilir ilan bağlantısı bulunamadı")
    out=[];sem=asyncio.Semaphore(2)
    async def detail(u):
        async with sem:
            try:
                r=await c.get(u);r.raise_for_status()
                s=BeautifulSoup(r.text,"html.parser")
                for tag in s(["script","style","noscript","footer"]):tag.decompose()
                tokens=list(s.stripped_strings)
                title=s.find("h1")
                title=title.get_text(" ",strip=True) if title else ""
                # Do not assume a listing's location from the requested search.
                location_text=" ".join(tokens[:120])
                if not re.search(r"\b"+re.escape(local(req.place))+r"\b",norm(location_text)):return
                if norm(req.district) not in norm(location_text):return
                typ=field(tokens,{"emlak tipi","gayrimenkul tipi"})
                kind=listing_type(typ)
                if kind=="unknown":return
                area=num(field(tokens,{"m2","m 2","metrekare"}))
                price=None
                for t in tokens[:120]:
                    m=re.fullmatch(r"\s*([\d., ]+)\s*(?:₺|TL)\s*",t,re.I)
                    if m:
                        price=num(m.group(1));break
                b=field(tokens,{"ada","ada no","ada numarasi"}).replace(".","")
                p=field(tokens,{"parsel","parsel no","parsel numarasi"}).replace(".","")
                if not title or not area or not price or area<=0 or price<=0:return
                out.append({"title":title[:200],"url":u,"price":price,"area":area,"unit":price/area,"kind":kind,"type":typ,"block":b if b.isdigit() else None,"parcel":p if p.isdigit() else None,"center":None,"distance":None,"source":"RE/MAX"})
            except Exception:return
    await asyncio.gather(*(detail(u) for u in urls[:18]))
    return out
def quantile(a,q):
    a=sorted(a);i=(len(a)-1)*q;k=int(i)
    return a[k]+(a[min(k+1,len(a)-1)]-a[k])*(i-k)
@app.post("/api/analyze")
async def analyze(req:Req):
    if gate.locked():raise HTTPException(429,"Test sunucusu meşgul. Biraz sonra deneyin.")
    async with gate:
        subject=None;loc=None;items=[];warnings=[]
        async with client() as c:
            async def get_subject():
                nonlocal subject,loc
                try:
                    loc=await locality(c,req);subject=await parcel_data(c,loc,req.block,req.parcel)
                except Exception as e:warnings.append("TKGM: "+(str(e)[:180] or "Bağlantı zaman aşımı"))
            async def get_items():
                nonlocal items
                try:items=await search_remax(c,req)
                except Exception as e:warnings.append("RE/MAX: "+(str(e)[:180] or "Bağlantı zaman aşımı"))
            try:await asyncio.wait_for(asyncio.gather(get_subject(),get_items()),55)
            except TimeoutError:warnings.append("Kaynak sorgusu zaman aşımına uğradı.")
            if subject and loc:
                sem=asyncio.Semaphore(2)
                async def locate(item):
                    if not item["block"] or not item["parcel"]:return
                    if int(item["block"])==int(req.block) and int(item["parcel"])==int(req.parcel):
                        item["same_parcel"]=True;return
                    async with sem:
                        try:
                            g=await parcel_data(c,loc,item["block"],item["parcel"])
                            # The advertised area must be consistent with the parcel.
                            if g["area"] and abs(item["area"]-g["area"])/g["area"]>0.08:return
                            item["center"]=g["center"];item["distance"]=round(distance(subject["center"],g["center"]))
                        except Exception:return
                try:await asyncio.wait_for(asyncio.gather(*(locate(i) for i in items[:12])),25)
                except TimeoutError:warnings.append("Bazı emsal konumları zaman aşımına uğradı.")
        unique={}
        for i in items:
            if i.get("same_parcel"):continue
            key=(i["block"],i["parcel"]) if i["block"] and i["parcel"] else (i["url"],)
            if key not in unique or i["price"]<unique[key]["price"]:unique[key]=i
        items=sorted(unique.values(),key=lambda x:(x["distance"] is None,x["distance"] or 0,x["price"]))
        nearby=[i for i in items if i["distance"] is not None and i["distance"]<=1000]
        suitable=[i for i in nearby if subject and subject["area"] and req.zoning!="unknown" and i["kind"]==req.zoning and .5*subject["area"]<=i["area"]<=2*subject["area"]]
        estimate=None
        if len(suitable)>=3:
            units=[i["unit"] for i in suitable]
            estimate={"low":round(quantile(units,.25)*subject["area"]),"high":round(quantile(units,.75)*subject["area"]),"median":round(quantile(units,.5)*subject["area"]),"count":len(units)}
        if not estimate:warnings.append("Fiyat için doğrulanmış parsel alanı, benzer imar türü ve 1 km içinde en az üç farklı uygun emsal gerekir.")
        return {"subject":subject,"items":items,"nearby_count":len(nearby),"estimate":estimate,"warnings":warnings,"checked_at":datetime.now(timezone.utc).isoformat(),"coverage":"İlk test: yalnızca erişilebilir RE/MAX ilanları. Mesafe parsel merkezleri arasındadır; imar bilgisi kullanıcı beyanıdır."}
