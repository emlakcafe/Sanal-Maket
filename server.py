from __future__ import annotations
import asyncio, math, re, time, unicodedata, urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit
import httpx
import listing_readers
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

app=FastAPI(title="Emlak Cafe AI mobil test")
ADDR="https://api.turkiyeapi.dev/v2"
TKGM="https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api"
REMAX="https://remax.com.tr"
UA="EmlakCafeResearch/1.0"
SEARCH_RADIUS_METERS=1000
MAX_DETAIL_PAGES=40
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
    # One bounded retry for transient transport/service failures. Access
    # restrictions (403/429) and missing parcels (404) are never retried.
    for attempt in range(2):
        try:
            r=await client.get(url);r.raise_for_status();v=r.json();break
        except httpx.HTTPStatusError as e:
            if attempt or e.response.status_code not in {408,500,502,503,504}:raise
        except (httpx.TimeoutException,httpx.NetworkError):
            if attempt:raise
        await asyncio.sleep(.25)
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
async def health():return {"status":"ok","version":"v10.2","radius_m":SEARCH_RADIUS_METERS,"mode":"isolated-mobile-test","sources":["TurkiyeAPI","TKGM","RE/MAX","Emlakjet"],"dated_research":"Akköy"}
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
    place_kind:str=Field(default="unknown",pattern=r"^(unknown|mahalle|köy)$")
    block:str=Field(pattern=r"^\d{1,9}$")
    parcel:str=Field(pattern=r"^[1-9]\d{0,8}$")
    zoning:str=Field(default="unknown",pattern=r"^(unknown|residential|field)$")
def properties(data):
    if isinstance(data,dict) and isinstance(data.get("features"),list):return [x.get("properties",{}) for x in data["features"] if isinstance(x,dict)]
    return []
def match(rows,name):
    exact=[r for r in rows if local(r.get("text") or r.get("name"))==local(name) and r.get("id") is not None]
    if not exact:
        # Official catalogues sometimes join multiword names (e.g. Gazi Osman Paşa).
        exact=[r for r in rows if local(r.get("text") or r.get("name")).replace(" ","")==local(name).replace(" ","") and r.get("id") is not None]
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
def within_radius(item):
    meters=item.get("distance_m",item.get("distance"))
    return isinstance(meters,(int,float)) and math.isfinite(meters) and 0<=meters<=SEARCH_RADIUS_METERS

SOURCES={"RE/MAX":"https://remax.com.tr","Emlakjet":"https://www.emlakjet.com"}
def item_record(title,url,area,price,kind,block=None,parcel=None,source="RE/MAX",live=True,**extra):
    if not area or not price or area<=0 or price<=0:return None
    return {"title":title[:220],"url":url,"area":area,"price":price,"unit":price/area,"kind":kind,"type":kind,"block":block,"parcel":parcel,"center":None,"distance":None,"source":source,"live":live,**extra}

# Readers are selected per source; their structured-data and DOM rules are tested separately.
parse_detail=listing_readers.parse_detail

async def source_get(c,url,base,rules):
    """Follow a small number of same-source redirects, checking each public path."""
    for _ in range(4):
        parsed=urlsplit(url)
        if parsed.scheme!="https" or parsed.hostname!=urlsplit(base).hostname or parsed.username or parsed.password:
            raise ValueError("Kaynak dışına yönlendirme kabul edilmedi")
        if not rules.can_fetch(UA,url):raise PermissionError("Kaynak bu sayfanın otomatik okunmasına izin vermiyor")
        response=await c.get(url)
        if response.status_code in {301,302,303,307,308}:
            target=response.headers.get("location")
            if not target:raise ValueError("Yönlendirme adresi eksik")
            url=urljoin(url,target);continue
        response.raise_for_status()
        return response
    raise ValueError("Çok fazla yönlendirme")

async def search_source(c,req,source,progress=None,output=None):
    base=SOURCES[source]
    deadline=time.monotonic()+48
    stats=progress if progress is not None else {}
    stats.update({"source":source,"status":"searching","links_found":0,"details_attempted":0,"details_read":0,"cards_only":0,"unreadable":0,"unavailable":0,"pages":[],"notes":[]})
    out=output if output is not None else []
    robots_key=base+"/robots.txt"
    old=cache.get(robots_key)
    if old and time.monotonic()-old[0]<3600:rules=old[1]
    else:
        robots=await asyncio.wait_for(c.get(robots_key),8)
        if robots.status_code!=200:raise ValueError("Kaynağın erişim kuralları okunamadı")
        rules=urllib.robotparser.RobotFileParser();rules.parse(robots.text.splitlines())
        cache[robots_key]=(time.monotonic(),rules)
    found={}
    search_urls=listing_readers.search_urls(req,source)
    local_page_read=False
    for url in search_urls:
        if source=="Emlakjet" and local_page_read and url!=search_urls[-1]:continue
        remaining=deadline-time.monotonic()
        if remaining<=1:
            stats["notes"].append("Kaynak araması süre sınırına ulaştı");break
        try:
            response=await asyncio.wait_for(source_get(c,url,base,rules),min(10,remaining))
            stats["pages"].append(str(response.url))
            if url!=search_urls[-1]:local_page_read=True
            for u,card in listing_readers.candidates(response.text,str(response.url),req,source).items():
                if u not in found or card:found[u]=card
        except httpx.HTTPStatusError as e:
            status=e.response.status_code
            stats["notes"].append(f"Liste sayfası HTTP {status}")
            if status in {403,429}:
                stats["status"]="restricted";break
        except PermissionError:
            stats["notes"].append("Liste sayfası otomatik erişime kapalı")
        except (httpx.RequestError,ValueError,TimeoutError):
            stats["notes"].append("Liste sayfası okunamadı veya zaman aşımı")
    stats["links_found"]=len(found)
    def priority(u):
        card=found[u] or {};addr=card.get("address") or {}
        return (local(addr.get("place"))!=local(req.place),not bool(card),u)
    ordered=sorted(found,key=priority)[:MAX_DETAIL_PAGES]
    stats["detail_limit"]=MAX_DETAIL_PAGES
    if len(found)>len(ordered):stats["notes"].append(f"İlk {len(ordered)} ilan detayına bakıldı; kaynakta daha fazla ilan var")
    sem=asyncio.Semaphore(3);finished=set();restricted=stats["status"]=="restricted"
    async def detail(u):
        nonlocal restricted
        card=found[u]
        detail_note="İlanın detay sayfasına erişilemedi"
        async with sem:
            if restricted:return
            stats["details_attempted"]+=1
            try:
                response=await source_get(c,u,base,rules)
                record=parse_detail(response.text,str(response.url),req,source)
                finished.add(u)
                if record:
                    if card and (card.get("price")!=record["price"] or abs(card.get("area",record["area"])-record["area"])/record["area"]>.08):
                        record["card_detail_changed"]=True
                    record["checked_at"]=datetime.now(timezone.utc).isoformat()
                    record["detail_status"]="read"
                    out.append(record);stats["details_read"]+=1;return
                stats["unreadable"]+=1
                detail_note=listing_readers.detail_problem(response.text,str(response.url),source)
                if detail_note.startswith("Kaynak ilanı yayından"):
                    stats["unreadable"]-=1;stats["unavailable"]+=1;return
            except httpx.HTTPStatusError as e:
                finished.add(u)
                if e.response.status_code in {404,410}:
                    stats["unavailable"]+=1;return
                if e.response.status_code in {403,429}:
                    restricted=True;stats["notes"].append("Kaynak detay erişimini kısıtladı")
                stats["unreadable"]+=1
            except (httpx.RequestError,ValueError,PermissionError):
                finished.add(u);stats["unreadable"]+=1
            if card:
                fallback=dict(card,live=False,detail_verified=False,detail_status="not_read",detail_note=detail_note,block=None,parcel=None)
                out.append(fallback);stats["cards_only"]+=1
    try:await asyncio.wait_for(asyncio.gather(*(detail(u) for u in ordered)),max(.05,min(38,deadline-time.monotonic())))
    except TimeoutError:
        stats["notes"].append("Bazı ilan detayları süre sınırında tamamlanamadı")
        for u in ordered:
            if u not in finished and found[u]:
                out.append(dict(found[u],live=False,detail_verified=False,detail_status="not_read",block=None,parcel=None))
                stats["cards_only"]+=1
    stats["status"]="restricted" if restricted else "partial" if stats["notes"] or stats["unreadable"] else "ok" if out else "empty"
    print(f"SOURCE {source}: links={stats['links_found']} attempted={stats['details_attempted']} rows={len(out)} details={stats['details_read']} unreadable={stats['unreadable']}",flush=True)
    return out,stats

def research_snapshot(req):
    # Small, dated original-source observations checked via web research on
    # 2026-11-26. Not a feed or a claim of current availability.
    if (norm(req.province),norm(req.district),local(req.place))!=("yalova","termal","akkoy"):return []
    rows=[
      ("524","11",350,1900000,"Emlakjet","https://www.emlakjet.com/ilan/ozgurce-gyd-den-yalova-akkoy-de-villa-imarli-350-m2-satilik-arsa-19787573","13.11.2026"),
      ("109","7",342,2530000,"Emlakjet","https://www.emlakjet.com/ilan/turyap-aydemirden-termal-akkoyde-342-m2-villa-imarli-arsa-19806271","21.11.2026"),
      ("535","9",399,3100000,"Emlakjet","https://www.emlakjet.com/ilan/sekercioglu-ndan-yalova-akkoy-de-399m-2-kat-imarli-satilik-arsa-19395361","31.08.2026"),
      ("495","16",350,3050000,"Emlakjet","https://www.emlakjet.com/ilan/yalova-termal-akkoyde-deniz-doga-manzarali-satilik-imarli-arsa-20071926","20.11.2026"),
      ("619","1",374,3750000,"Emlakjet","https://www.emlakjet.com/ilan/yalova-termal-akkoyde-374-59-m-satilik-arsa-20100944","21.11.2026"),
      ("314","178",360,3625000,"Emlakjet","https://www.emlakjet.com/ilan/turyap-ercan-dan-akkoy-de-satilik-360-m-villa-parseli-20067390","06.11.2026"),
      ("115","11",430,4900000,"Hepsiemlak","https://www.hepsiemlak.com/yalova-termal-akkoy-satilik/imarli-villa/0-47269317","09.09.2026"),
      ("3178","6",363,2600000,"RE/MAX","https://remax.com.tr/tr/portfoy/P22150221","05.10.2026"),
      ("3177","6",352,1700000,"RE/MAX","https://remax.com.tr/tr/portfoy/P61352831","17.10.2026"),
      ("112","13",547,4200000,"RE/MAX","https://remax.com.tr/tr/portfoy/P60754878","06.08.2026")
    ]
    return [item_record(f"Akköy · {b}/{p} · konut/villa imarlı arsa (ilan beyanı)",u,a,v,"residential",b,p,src,False,detail_verified=True,observed_on="2026-11-26",listing_date=d,address={"province":"Yalova","district":"Termal","place":"Akköy"},reader="dated-source-observation") for b,p,a,v,src,u,d in rows]
def quantile(a,q):
    a=sorted(a);i=(len(a)-1)*q;k=int(i)
    return a[k]+(a[min(k+1,len(a)-1)]-a[k])*(i-k)
@app.post("/api/analyze")
async def analyze(req:Req):
    if gate.locked():raise HTTPException(429,"Test sunucusu meşgul. Biraz sonra deneyin.")
    async with gate:
        subject=None;loc=None;items=[];warnings=[];source_status=[]
        async with client() as c:
            async def get_subject():
                nonlocal subject,loc
                try:
                    loc=await locality(c,req);subject=await parcel_data(c,loc,req.block,req.parcel)
                    subject["locality_id"]=loc
                except Exception as e:warnings.append("TKGM: "+(str(e)[:180] or "Bağlantı zaman aşımı"))
            async def get_items():
                async def collect(source):
                    rows=[];stats={"source":source,"status":"searching","details_read":0,"notes":[]}
                    source_status.append(stats)
                    try:
                        await search_source(c,req,source,progress=stats,output=rows)
                        if not rows:warnings.append(source+": erişilebilir sayfalarda uygun alanlar okunamadı.")
                    except asyncio.CancelledError:
                        stats["status"]="partial"
                        stats["notes"].append("Süre doldu; tamamlanan okumalar korundu")
                        raise
                    except Exception as e:
                        message=str(e)[:180] or "Bağlantı zaman aşımı"
                        warnings.append(source+": "+message)
                        stats["status"]="error";stats["notes"].append(message)
                    finally:items.extend(rows)
                await asyncio.gather(*(collect(x) for x in SOURCES))
                live_urls={i["url"] for i in items if i.get("detail_verified")}
                for row in research_snapshot(req):
                    if row["url"] not in live_urls:
                        items.append(row)
            try:await asyncio.wait_for(asyncio.gather(get_subject(),get_items()),55)
            except TimeoutError:warnings.append("Kaynak sorgusu zaman aşımına uğradı.")
            if subject and loc:
                sem=asyncio.Semaphore(2)
                async def locate(item):
                    if not item.get("detail_verified"):return
                    if not item["block"] or not item["parcel"]:
                        item["location_note"]="İlanda ada/parsel bilgisi bulunamadı";return
                    address=item.get("address") or {}
                    if not all(address.get(k) for k in ("province","district","place")):
                        item["location_note"]="İlanın açık adresi doğrulanamadı";return
                    async with sem:
                        try:
                            listing_req=req.model_copy(update={k:address[k] for k in ("province","district","place")})
                            listing_loc=await locality(c,listing_req)
                            item["locality_id"]=listing_loc
                            if listing_loc==loc and int(item["block"])==int(req.block) and int(item["parcel"])==int(req.parcel):
                                item["same_parcel"]=True;return
                            g=await parcel_data(c,listing_loc,item["block"],item["parcel"])
                            # The advertised area must be consistent with the parcel.
                            if not g["area"] or abs(item["area"]-g["area"])/g["area"]>0.08:
                                item["location_note"]="İlan alanı TKGM parsel alanıyla uyuşmadı";return
                            item["center"]=g["center"]
                            item["distance_m"]=distance(subject["center"],g["center"])
                            item["distance"]=round(item["distance_m"])
                            item["within_radius"]=within_radius(item)
                            item["location_note"]="İlan adresi ve TKGM parseli eşleştirildi"
                        except ValueError as e:
                            item["location_note"]="İlandaki mahalle/köy adı TKGM kadastro listesiyle eşleşmedi" if "TKGM adresi" in str(e) else "İlanın kendi adresinde ada/parsel doğrulanamadı"
                        except httpx.TimeoutException:
                            item["location_note"]="TKGM yanıtı zaman aşımına uğradı; konum doğrulanamadı"
                        except httpx.HTTPStatusError as e:
                            item["location_note"]=f"TKGM parsel yanıtı alınamadı (HTTP {e.response.status_code})"
                        except httpx.RequestError:
                            item["location_note"]="TKGM bağlantısı tamamlanamadı; konum doğrulanamadı"
                        except Exception:
                            item["location_note"]="İlanın kendi adresinde ada/parsel doğrulanamadı"
                def location_priority(item):
                    pin=item.get("advertised_center")
                    if isinstance(pin,list) and len(pin)==2 and all(isinstance(v,(int,float)) and math.isfinite(v) for v in pin):
                        rough=distance(subject["center"],pin)
                        return (0 if rough<=SEARCH_RADIUS_METERS*1.5 else 2,rough)
                    return (1 if local((item.get("address") or {}).get("place"))==local(req.place) else 3,0)
                candidates=sorted([i for i in items if i["block"] and i["parcel"]],key=location_priority)
                for item in candidates[50:]:item["location_note"]="Bu sorgunun konum doğrulama sınırına ulaşıldı"
                try:await asyncio.wait_for(asyncio.gather(*(locate(i) for i in candidates[:50])),30)
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
            address=i.get("address") or {}
            place_key=i.get("locality_id") or tuple(local(address.get(k)) for k in ("province","district","place"))
            key=(place_key,i["block"],i["parcel"]) if i["block"] and i["parcel"] and all(address.get(k) for k in ("province","district","place")) else (i["url"],)
            old=unique.get(key)
            if old is None:unique[key]=i
            else:
                urls=list(dict.fromkeys(old.get("source_urls",[old["url"]])+i.get("source_urls",[i["url"]])))
                if (bool(i["detail_verified"]),bool(i["live"]),bool(i["center"]))>(bool(old["detail_verified"]),bool(old["live"]),bool(old["center"])):unique[key]=i
                unique[key]["source_urls"]=urls
        items=sorted(unique.values(),key=lambda x:(x["distance"] is None,x["distance"] or 0,x["price"]))
        nearby=[i for i in items if within_radius(i)]
        live_nearby=[i for i in nearby if i["live"] and i.get("detail_verified")]
        zone=req.zoning
        assumed=zone=="unknown"
        if assumed and subject and norm(subject["nature"])=="arsa":zone="residential"
        def comparable(i):
            return bool(subject and subject["area"] and zone!="unknown" and i["kind"]==zone and i.get("detail_verified") and not i.get("share_sale") and .5*subject["area"]<=i["area"]<=2*subject["area"])
        def band(rows,scope):
            if len(rows)<3:return None
            units=[i["unit"] for i in rows]
            a=subject["area"]
            return {"low":round(quantile(units,.25)*a),"high":round(quantile(units,.75)*a),"median":round(quantile(units,.5)*a),"count":len(rows),"scope":scope,"conditional_zoning":assumed,"dated_count":sum(not i["live"] for i in rows)}
        strict=[i for i in live_nearby if comparable(i)]
        estimate=band(strict,"1 km · sayfası ve konumu doğrulanmış ilanlar") if not assumed else None
        reference_near=[i for i in nearby if comparable(i)]
        reference=band(reference_near,"1 km · kaynaklı ilan referansı")
        if not estimate:warnings.append("1 km fiyat aralığı için en az üç benzer büyüklükte, sayfası ve konumu doğrulanmış ilan ve bilinen imar türü gerekir.")
        if reference and assumed:warnings.append("Referans fiyat, taşınmazın konut/villa imarlı olduğu varsayımına bağlıdır. Tapu niteliği imar durumunu kanıtlamaz.")
        if any(i.get("observed_on") for i in items):warnings.append("26.11.2026 tarihli web araştırması kayıtları ayrı etiketlidir; canlı ilan aktifliği yeniden doğrulanmış sayılmaz.")
        print(f"ANALYZE query={req.province}/{req.district}/{req.place}:{req.block}/{req.parcel} radius_m={SEARCH_RADIUS_METERS} subject={bool(subject)} rows={len(items)} nearby={len(nearby)} live={sum(i['live'] for i in items)} strict={len(strict)} reference={bool(reference)}",flush=True)
        return {"subject":subject,"items":items,"radius_m":SEARCH_RADIUS_METERS,"source_status":source_status,"nearby_count":len(nearby),"live_nearby_count":len(live_nearby),"estimate":estimate,"reference_estimate":reference,"warnings":warnings,"checked_at":datetime.now(timezone.utc).isoformat(),"coverage":"RE/MAX ve Emlakjet için ayrı sayfa okuyucuları. Yalnızca 1 km içindeki konumu doğrulanmış emsaller fiyat aralığına katılır. Mesafe parsel merkezleri arasındadır. Fiyatlar ilan talep fiyatlarıdır; sayfanın erişilebilir olması taşınmazın henüz satılmadığını kanıtlamaz."}

@app.get("/api/test/akkoy")
async def test_akkoy():
    key="test:akkoy:v10.2"
    old=cache.get(key)
    if old and time.monotonic()-old[0]<300:return old[1]
    result=await analyze(Req(province="Yalova",district="Termal",place="Akköy",block="354",parcel="12",zoning="unknown"))
    cache[key]=(time.monotonic(),result)
    return result

