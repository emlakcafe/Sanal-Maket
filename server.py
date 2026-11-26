from __future__ import annotations
import asyncio, math, re, time, unicodedata, urllib.robotparser
import licensed_sources as feeds
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit
import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, field_validator

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
async def health():return {"status":"ok","version":"v14","mode":"isolated-mobile-test","sources":["TurkiyeAPI","TKGM",*feeds.LISTING_SOURCES,*feeds.VALUATION_SOURCES],"coverage":"dynamic-national"}
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
def normalize_block(value):
    if value is None:return "0"
    value=str(value).strip()
    if value in {"", "-"}:return "0"
    if not re.fullmatch(r"[0-9]{1,9}",value):raise ValueError("Ada numarası geçersiz")
    return str(int(value))
class Req(BaseModel):
    province:str=Field(min_length=1,max_length=80)
    district:str=Field(min_length=1,max_length=80)
    place:str=Field(min_length=1,max_length=120)
    block:str=Field(default="0",pattern=r"^[0-9]{1,9}$")
    @field_validator("block",mode="before")
    @classmethod
    def clean_block(cls,value):
        if value == "-":raise ValueError("Ada numarası boş veya sayısal olmalıdır")
        return normalize_block(value)
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
def response_number(value,block=False):
    s=str(value).strip().lower() if value is not None else ""
    if block and s in {"","-","–","—","none","null","yok","-1","-1.0"}:return "0"
    if re.fullmatch(r"[0-9]{1,9}(?:[.,]0+)?",s):return str(int(re.split(r"[.,]",s)[0]))
    return None
async def parcel_data(c,loc,block,parcel):
    if not str(loc).isdigit():raise ValueError("TKGM adres kimliği geçersiz")
    block=normalize_block(block)
    j=await getjson(c,TKGM+f"/parsel/{loc}/{int(block)}/{int(parcel)}",900)
    if j.get("type")=="FeatureCollection":
        fs=j.get("features",[])
        if len(fs)!=1:raise ValueError("Tekil parsel bulunamadı")
        j=fs[0]
    p=j.get("properties") or {};g=j.get("geometry") or {}
    if response_number(p.get("adaNo"),True)!=block or response_number(p.get("parselNo"))!=str(int(parcel)):
        raise ValueError(f"Ada/parsel eşleşmedi: istenen {block}/{parcel}; gelen {str(p.get('adaNo'))[:24]}/{str(p.get('parselNo'))[:24]}")
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
    if any(x in n for x in ("tarla","tarim arazisi","bag bahce","bag ve bahce")):return "field"
    if any(x in n for x in ("konut imarli","villa imarli","villa","residential zoned")):return "residential"
    return "unknown"

SOURCES={"RE/MAX":"https://remax.com.tr","Emlakjet":"https://www.emlakjet.com"}
def item_record(title,url,area,price,kind,block=None,parcel=None,source="RE/MAX",live=True,**extra):
    if not area or not price or area<=0 or price<=0:return None
    return {"title":title[:220],"url":url,"area":area,"price":price,"unit":price/area,"kind":kind,"type":kind,"block":block,"parcel":parcel,"center":None,"distance":None,"source":source,"live":live,**extra}
def integer_text(s):
    t=str(s or "").strip().replace(".","")
    return t if t.isdigit() else None
def value_num(s):
    m=re.search(r"\d+(?:[.,]\d+)*",str(s or ""))
    return num(m.group()) if m else None
def locality_in(text,req):
    n=norm(text)
    place=local(req.place)
    return bool(place and re.search(r"\b"+re.escape(place)+r"\b",n) and re.search(r"\b"+re.escape(norm(req.district))+r"\b",n))
def price_from(s):
    return next((num(m.group(1)) for m in re.finditer(r"(?<![\d.,])([\d.,]+)\s*(?:₺|TL)(?!\s*/)",s,re.I) if (num(m.group(1)) or 0)>=10000),None)
def parse_card(a,url,req,source,sale_context=False):
    for el in [a,*list(a.parents)[:5]]:
        if not el:continue
        t=el.get_text(" ",strip=True)
        if len(t)>1300 or not locality_in(t,req) or ("satilik" not in norm(t) and not sale_context) or ("kiralik" in norm(t) and "satilik" not in norm(t)):continue
        links={urlsplit(urljoin(url,x.get("href",""))).path for x in el.select("a[href]") if re.search(r"/(?:ilan/[^/]+-\d+|(?:tr/portfoy|en/property)/P\d+)/?$",urlsplit(urljoin(url,x.get("href",""))).path,re.I)}
        if len(links)>1:continue
        m=re.search(r"(?<![\d.,/])([\d.,]+)\s*m[²2]\b",t,re.I)
        # superscript 2 can be adjacent to punctuation; accept explicit area.
        if not m:m=re.search(r"([\d.,]+)\s*m²",t,re.I)
        area=num(m.group(1)) if m else None
        price=price_from(t)
        if area and price:
            h=el.find(["h2","h3","h4"])
            title=h.get_text(" ",strip=True) if h else req.place+" satılık arsa"
            return item_record(title,url,area,price,listing_type(t),source=source,live=True,detail_verified=False)
    return None
def parse_detail(html,url,req,source):
    soup=BeautifulSoup(html,"html.parser")
    for tag in soup(["script","style","noscript","footer","nav"]):tag.decompose()
    tokens=list(soup.stripped_strings)
    title=soup.find("h1")
    title=title.get_text(" ",strip=True) if title else ""
    if not title:return None
    # Only the listing's own heading and attributes, not recommendations.
    start=next((i for i,t in enumerate(tokens) if norm(t)==norm(title)),0)
    section=tokens[start:start+180]
    for i,t in enumerate(section):
        if norm(t) in {"benzer ilanlar","bu ilana bakanlar bunlara da bakti","diger ilanlari","ilan aciklamasi","aciklama"} and i>30:
            section=section[:i];break
    top=" ".join(section)
    if not locality_in(top,req):return None
    if not re.search(r"\b"+re.escape(norm(req.province))+r"\b",norm(top)):return None
    typ=field(section,{"emlak tipi","gayrimenkul tipi","kategori","arsa tipi","imar durumu"})
    if "satilik" not in norm(typ+" "+top):return None
    kind=listing_type(typ)
    if kind=="unknown":kind=listing_type(title+" "+typ)
    area=value_num(field(section,{"m2","m 2","metrekare","alan","metrekare m2"}))
    if not area:
        m=re.search(r"([\d.,]+)\s*m²",top)
        area=num(m.group(1)) if m else None
    price=None
    for h in soup.find_all(["h2","h3"])[:12]:
        price=price_from(h.get_text(" ",strip=True))
        if price:break
    if not price:price=price_from(top)
    b=integer_text(field(section,{"ada","ada no","ada numarasi","ada parsel no"}))
    p=integer_text(field(section,{"parsel","parsel no","parsel numarasi"}))
    if not (b and p):
        # A combined explicit field is also valid. Do not infer numbers from title.
        m=re.search(r"\b(?:ada\s*/\s*parsel(?:\s*no)?)\s*:?\s*(\d+)\s*/\s*(\d+)",top,re.I)
        if m:b,p=m.groups()
    if not area or not price:return None
    return item_record(title,url,area,price,kind,b,p,source,True,detail_verified=True)
async def search_source(c,req,source,stats=None):
    stats=stats if stats is not None else {}
    stats.update(links=0,listed=0,verified=0)
    base=SOURCES[source]
    path=("/tr/arsa-arazi/satilik/"+slug(req.province)+"/"+slug(req.district)) if source=="RE/MAX" else ("/satilik-arsa/"+slug(req.province)+"-"+slug(req.district)+"-"+slug(local(req.place)))
    url=base+path
    robots=await c.get(base+"/robots.txt")
    if robots.status_code!=200:raise ValueError("erişim kuralları doğrulanamadı")
    rp=urllib.robotparser.RobotFileParser();rp.parse(robots.text.splitlines())
    if source=="RE/MAX" and not rp.can_fetch(UA,url):raise ValueError("otomatik erişime izin verilmiyor")
    variants=[url] if source=="RE/MAX" else [url+"-mahallesi",url,url+"-koyu",base+"/satilik-arsa/"+slug(req.province)+"-"+slug(req.district)]
    resp=None
    for candidate in variants:
        if not rp.can_fetch(UA,candidate):continue
        try:
            trial=await c.get(candidate)
            if trial.status_code==200:
                url=candidate;resp=trial;break
        except httpx.HTTPError:continue
    if resp is None:raise ValueError("Erişilebilir ilan liste sayfası bulunamadı")
    soup=BeautifulSoup(resp.text,"html.parser")
    candidates={}
    for a in soup.select("a[href]"):
        u=urljoin(url,a.get("href",""));p=urlsplit(u)
        if p.scheme!="https" or p.hostname!=urlsplit(base).hostname:continue
        if source=="RE/MAX":
            ok=re.fullmatch(r"/(?:tr/portfoy|en/property)/P\d+/?",p.path,re.I)
        else:
            ok=re.fullmatch(r"/ilan/[^/]+-\d+/?",p.path,re.I)
        if not ok:continue
        u=base+p.path.rstrip("/")
        if not rp.can_fetch(UA,u):continue
        card=parse_card(a,u,req,source,"satilik" in urlsplit(url).path)
        if u not in candidates or card:candidates[u]=card
    stats["links"]=len(candidates)
    if not candidates:raise ValueError("liste sayfasından ilan bağlantısı alınamadı")
    ordered=sorted(candidates,key=lambda u:candidates[u] is None)[:24]
    sem=asyncio.Semaphore(3);out=[]
    async def detail(u):
        card=candidates[u]
        async with sem:
            try:
                r=await c.get(u);r.raise_for_status()
                d=parse_detail(r.text,u,req,source)
                if d:
                    # Explicit card/details disagreement is not silently accepted.
                    if card and (abs(card["area"]-d["area"])/d["area"]>.08 or card["price"]!=d["price"]):
                        d["detail_verified"]=False;d["block"]=None;d["parcel"]=None
                    out.append(d);return
            except Exception:pass
            if card:out.append(card)
    try:await asyncio.wait_for(asyncio.gather(*(detail(u) for u in ordered)),35)
    except TimeoutError:
        for u in ordered:
            if candidates[u] and not any(x["url"]==u for x in out):out.append(candidates[u])
    stats["listed"]=len(out);stats["verified"]=sum(bool(x.get("detail_verified")) for x in out)
    print(f"SOURCE {source}: links={len(candidates)} rows={len(out)} details={sum(bool(x.get('detail_verified')) for x in out)}",flush=True)
    return out

def quantile(a,q):
    a=sorted(a);i=(len(a)-1)*q;k=int(i)
    return a[k]+(a[min(k+1,len(a)-1)]-a[k])*(i-k)
@app.post("/api/analyze")
async def analyze(req:Req):
    if gate.locked():raise HTTPException(429,"Test sunucusu meşgul. Biraz sonra deneyin.")
    async with gate:
        subject=None;loc=None;items=[];warnings=[];external=[];source_stats={s:{"links":0,"listed":0,"verified":0} for s in (*feeds.LISTING_SOURCES,*feeds.VALUATION_SOURCES)}
        async with client() as c:
            async def get_subject():
                nonlocal subject,loc
                try:
                    loc=await locality(c,req);subject=await parcel_data(c,loc,req.block,req.parcel)
                except Exception as e:warnings.append("TKGM: "+(str(e)[:180] or "Bağlantı zaman aşımı"))
            async def get_items():
                async def collect(source):
                    stats=source_stats[source]
                    try:
                        rows=await feeds.listings(c,req,source,stats,norm,local)
                        items.extend(rows)
                    except Exception:
                        stats.update(status="error",message="Kaynak işleme hatası")
                async def collect_valuation(source):
                    stats=source_stats[source]
                    try:
                        row=await feeds.valuation(c,req,source,stats,norm,local)
                        if row:external.append(row)
                    except Exception:
                        stats.update(status="error",message="Değerleme kaynağı işleme hatası")
                sem_sources=asyncio.Semaphore(5)
                async def bounded(fn,name):
                    async with sem_sources:await fn(name)
                await asyncio.gather(*(bounded(collect,x) for x in feeds.LISTING_SOURCES),*(bounded(collect_valuation,x) for x in feeds.VALUATION_SOURCES))

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
                            if not g["area"] or abs(item["area"]-g["area"])/g["area"]>0.08:return
                            item["center"]=g["center"];item["distance"]=round(distance(subject["center"],g["center"]))
                        except Exception:return
                candidates=[i for i in items if i["block"] and i["parcel"]]
                try:await asyncio.wait_for(asyncio.gather(*(locate(i) for i in candidates[:24])),30)
                except TimeoutError:warnings.append("Bazı emsal konumları zaman aşımına uğradı.")
        # Prefer independently verified live observations, then dated references.
        # Merge direct URL duplicates before parcel-based deduplication.
        unique_urls={}
        for i in items:
            if i.get("same_parcel"):continue
            key=i["url"]
            old=unique_urls.get(key)
            rank=lambda x:(bool(x.get("detail_verified")),bool(x.get("live")),bool(x.get("center")))
            if old is None or rank(i)>rank(old):unique_urls[key]=i
        unique={}
        for i in unique_urls.values():
            key=(i["block"],i["parcel"]) if i["block"] and i["parcel"] else (i["url"],)
            old=unique.get(key)
            if old is None or (bool(i["live"]),bool(i["center"]))>(bool(old["live"]),bool(old["center"])):unique[key]=i
        items=sorted(unique.values(),key=lambda x:(x["distance"] is None,x["distance"] or 0,x["price"]))
        nearby=[i for i in items if i["distance"] is not None and i["distance"]<=1000]
        live_nearby=[i for i in nearby if i["live"] and i.get("detail_verified")]
        zone=req.zoning
        assumed=zone=="unknown"
        if assumed and subject and norm(subject["nature"])=="arsa":zone="residential"
        def comparable(i):
            return bool(subject and subject["area"] and zone!="unknown" and i["kind"]==zone and i.get("detail_verified") and .5*subject["area"]<=i["area"]<=2*subject["area"])
        def band(rows,scope):
            if len(rows)<3:return None
            units=[i["unit"] for i in rows]
            a=subject["area"]
            return {"low":round(quantile(units,.25)*a),"high":round(quantile(units,.75)*a),"median":round(quantile(units,.5)*a),"count":len(rows),"scope":scope,"conditional_zoning":assumed,"dated_count":sum(not i["live"] for i in rows)}
        strict=[i for i in live_nearby if comparable(i)]
        estimate=band(strict,"1 km · canlı doğrulanmış ilanlar") if not assumed else None
        reference_near=[i for i in nearby if comparable(i)]
        region=[i for i in items if comparable(i)]
        reference=band(reference_near,"1 km · kaynaklı ilan referansı") or band(region,"Mahalle/köy · bölgesel ilan referansı")
        if not any(s.get("status") in {"ok","empty"} for n,s in source_stats.items() if n in feeds.LISTING_SOURCES):warnings.append("Henüz bağlı ve çalışır durumda yetkili ilan veri kaynağı yok; ilan yok anlamına gelmez.")
        if not estimate:warnings.append("Kesin 1 km canlı emsal bandı için en az üç konumu doğrulanmış güncel ilan ve bilinen imar türü gerekir.")
        if reference and assumed:warnings.append("Referans fiyat, taşınmazın konut/villa imarlı olduğu varsayımına bağlıdır. Tapu niteliği imar durumunu kanıtlamaz.")
        if any(not i["live"] for i in items):warnings.append("26.11.2026 tarihli web araştırması kayıtları ayrı etiketlidir; canlı ilan aktifliği yeniden doğrulanmış sayılmaz.")
        print(f"ANALYZE subject={bool(subject)} rows={len(items)} nearby={len(nearby)} live={sum(i['live'] for i in items)} strict={len(strict)} reference={bool(reference)}",flush=True)
        return {"version":"v14","source_stats":source_stats,"external_valuations":external,"subject":subject,"items":items,"nearby_count":len(nearby),"live_nearby_count":len(live_nearby),"estimate":estimate,"reference_estimate":reference,"warnings":warnings,"checked_at":datetime.now(timezone.utc).isoformat(),"coverage":"Türkiye geneli lisanslı çok kaynaklı tarama. Yalnızca yapılandırılmış ve yetkilendirilmiş güncel veri akışları kullanılır. Mesafe parsel merkezleri arasındadır. Fiyatlar gerçekleşen satış değil, ilan talep fiyatlarıdır."}

@app.get("/api/test/akkoy")
async def test_akkoy():
    key="test:akkoy:v14"
    old=cache.get(key)
    if old and time.monotonic()-old[0]<300:return old[1]
    result=await analyze(Req(province="Yalova",district="Termal",place="Akköy",block="354",parcel="12",zoning="unknown"))
    cache[key]=(time.monotonic(),result)
    return result
