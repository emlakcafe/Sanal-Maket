"""Keyless web research for the mobile prototype.

Uses Tavily's documented anonymous Search/Extract mode. Does not impersonate
human users, scrape search-engine HTML, bypass blocks, or invent records.
Rate limits are respected. Only factual listing fields and links are returned.
An extracted page is evidence of an advertised observation, not proof of sale
or of current availability. Web-only references are distinct from live emsals.
"""
import asyncio, math, os, re, time, unicodedata
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit, unquote
from licensed_sources import LISTING_SOURCES, safe_url
from web_research import plain, canonical

BASE = "https://api.tavily.com"
LOCK = asyncio.Lock()
LAST_CALL = 0.0
BACKOFF_UNTIL = 0.0
HEADERS = {"X-Tavily-Access-Mode":"keyless", "Accept":"application/json"}
def enabled():
    return os.getenv("EC_KEYLESS_RESEARCH_ENABLED","1") == "1"

def source_for(url):
    for name,(_,domains) in LISTING_SOURCES.items():
        if name!="Emlak Cafe" and safe_url(url,domains):
            return name
    return None

def listing_url(url,source):
    p=unquote(urlsplit(url).path).rstrip("/")
    if source=="Sahibinden":return bool(re.fullmatch(r"/ilan/[^/]+-\d{5,}/detay",p,re.I))
    if source=="Emlakjet":return bool(re.fullmatch(r"/ilan/[^/]+-\d{5,}",p,re.I))
    if source=="Hepsiemlak":return bool(re.search(r"/\d+-\d{4,}$",p))
    if source=="RE/MAX":return bool(re.fullmatch(r"/(?:tr/portfoy|en/property)/P\d+",p,re.I))
    return bool(re.search(r"/(?:ilan|ilanlar|portfoy|property|properties|listing|detail|detay)/[^/]+(?:/\d+)?$",p,re.I))

def trnum(value):
    s=str(value).strip().replace(" ","").replace("\u00a0","")
    if not re.fullmatch(r"\d+(?:[.,]\d+)*",s):return None
    if "." in s and "," in s:
        s=s.replace(".","").replace(",",".") if s.rfind(",")>s.rfind(".") else s.replace(",","")
    elif re.fullmatch(r"\d{1,3}(?:\.\d{3})+",s):s=s.replace(".","")
    elif re.fullmatch(r"\d{1,3}(?:,\d{3})+",s):s=s.replace(",","")
    else:s=s.replace(",",".")
    try:
        v=float(s)
        return v if math.isfinite(v) and v>0 else None
    except ValueError:return None

NUM=r"(\d[\d.,]*)"
def unique_values(pattern,text,minimum=0):
    vals=set()
    for m in re.finditer(pattern,text,re.I):
        v=trnum(m.group(1).rstrip(".,"))
        if v is not None and v>=minimum:vals.add(v)
    return vals
def price_area(text):
    # Remove unit-price contexts before reading total asking prices.
    t=re.sub(r"(?i)(?:m[²2]\s*(?:başına|fiyatı)|metrekare\s*fiyatı)[^\n]{0,50}", " ",text)
    prices=unique_values(NUM+r"\s*(?:TL|TRY|₺)(?![\w]|\s*/|\s*\/\s*m)",t,10000)
    prices|=unique_values(r"₺\s*"+NUM+r"(?![\d.,]|\s*/)",t,10000)
    # Also supports label-first table rows, but never treats unit price as total.
    if not prices:
        prices=unique_values(r"(?:ilan\s+fiyatı|satış\s+fiyatı|fiyat)\s*[:|]?\s*"+NUM+r"(?![\d.,]|\s*/)",t,10000)
    areas=unique_values(NUM+r"\s*m[²2](?!\s*(?:/|fiyat|başına))",text,10)
    if not areas:
        areas=unique_values(r"(?:arsa\s+alanı|yüzölçümü|m[²2]|metrekare)\s*[:|]?\s*"+NUM+r"(?![\d.,])",text,10)
    return (next(iter(prices)) if len(prices)==1 else None,next(iter(areas)) if len(areas)==1 else None)

def in_text(word,text):
    return bool(word and re.search(r"\b"+re.escape(word)+r"\b",text))

def location_matches(text,req,norm,local):
    n=norm(text)
    return all(in_text(x,n) for x in (norm(req.province),norm(req.district),local(req.place)))

def type_from(title,body,norm):
    # The listing's title/type fields are preferable to arbitrary descriptions.
    n=norm(title+" "+body[:2200])
    if any(x in n for x in ("tarla","tarimsal arazi","tarim arazisi","zeytinlik","bag bahce")):
        if not any(x in n for x in ("konut imarli","villa imarli")):return "field"
    if any(x in n for x in ("konut imarli","villa imarli","konut imari","villa imari")):return "residential"
    if any(x in n.split() for x in ("arsa","arazi")):return "land"
    return "unknown"
def closed(text,norm):
    n=norm(text)
    return any(x in n for x in ("ilan yayinda degil","ilan kaldirildi","ilan pasif","ilan artik yayinda degil","ilan bulunamadi","bu ilan silinmis","ilanin suresi dolmus","satilmistir","ilan aktif degil"))
def risky(text,norm):
    n=norm(text)
    return any(x in n for x in ("hisseli","satilik hisse","hisse satisi","hisse tapu","hisse payi","devren","takas bedeli","pesinat","aylik taksit","ihale","icra","m2 fiyati olarak"))

def page_section(text):
    # Search/extract outputs can contain recommendation carousels.
    text=str(text or "")[:20000]
    lines=[]
    for line in text.splitlines():
        if re.search(r"(?i)^\s*[#* ]*(?:benzer ilanlar|diğer ilanlar|bu ilana bakanlar|önerilen ilanlar|yakındaki ilanlar|sponsorlu ilanlar|ilgili ilanlar)\b",line):
            if lines:break
        lines.append(line)
    return "\n".join(lines)[:10000]

def cadastral(text):
    def one(label):
        vals=set(re.findall(label+r"\s*[:|]?\s*(\d{1,9})(?!\d)",text,re.I))
        return str(int(next(iter(vals)))) if len(vals)==1 else None
    return one(r"\bada\s*(?:no(?:su)?|numarası)?"),one(r"\bparsel\s*(?:no(?:su)?|numarası)?")

def make_candidate(row,req,norm,local):
    if not isinstance(row,dict):return None
    url=row.get("url")
    if not safe_url(url):return None
    source=source_for(url)
    if not source or not listing_url(url,source):return None
    title=plain(row.get("title"))
    content=page_section(row.get("content"))
    evidence=title+" "+content+" "+unquote(urlsplit(url).path)
    n=norm(evidence)
    if not title or not location_matches(evidence,req,norm,local):return None
    if "satilik" not in n or ("kiralik" in n and "satilik" not in norm(title+" "+urlsplit(url).path)):return None
    if closed(title+" "+content,norm):return None
    kind=type_from(title,content,norm)
    if kind=="unknown":return None
    price,area=price_area(title+"\n"+content)
    u=urlsplit(url)
    return {"title":title[:200],"url":urlunsplit((u.scheme,u.netloc,u.path,"","")),"source":source,"price":price,"area":area,
            "kind":kind,"source_checked":False,"active_verified":False,"location_verified":False,
            "risky":risky(title+" "+content,norm),"block":None,"parcel":None,
            "status":"Arama sonucu; aktiflik ve kesin konum doğrulanmadı"}

def read_detail(item,raw,req,norm,local):
    text=page_section(raw)
    if len(text)<80:return
    n=norm(text)
    if closed(text,norm):
        item.update(status="Kaynakta kapalı/satılmış ilan işareti var; değerleme dışı",risky=True)
        return
    if not location_matches(text,req,norm,local):return
    # Reject ambiguous listings, not merely HTTP 200 pages.
    if "satilik" not in norm(item["title"]+" "+text) or ("kiralik" in n and "satilik" not in norm(item["title"])):return
    kind=type_from(item["title"],text,norm)
    p,a=price_area(text)
    if not (p and a and kind!="unknown"):return
    # Conflicts may mean a changed price or another listing in page output.
    if item["price"] and abs(item["price"]-p)/p>.03:
        item.update(status="Arama ve kaynak fiyatı farklı; fiyat teyidi gerekli",risky=True);return
    if item["area"] and abs(item["area"]-a)/a>.03:
        item.update(status="Arama ve kaynak alanı farklı; değerleme dışı",risky=True);return
    b,pno=cadastral(text)
    item.update(price=p,area=a,kind=kind,block=b,parcel=pno,source_checked=True,
                risky=item["risky"] or risky(text,norm),
                checked_at=datetime.now(timezone.utc).isoformat(),
                status="Kaynak metni okundu; satışta olduğu ve tapu/imar bilgileri ayrıca teyit edilmeli")

async def call(client,endpoint,payload):
    global LAST_CALL,BACKOFF_UNTIL
    async with LOCK:
        if time.monotonic()<BACKOFF_UNTIL:
            return None,"rate_limited"
        delay=max(0,1.1-(time.monotonic()-LAST_CALL))
        if delay:await asyncio.sleep(delay)
        LAST_CALL=time.monotonic()
        try:
            r=await client.post(BASE+endpoint,json=payload,headers=HEADERS,timeout=11,follow_redirects=False)
        except Exception:return None,"connection_error"
        if r.status_code==429:
            try:seconds=max(60,min(86400,int(r.headers.get("Retry-After","300"))))
            except ValueError:seconds=300
            BACKOFF_UNTIL=time.monotonic()+seconds
            return None,"rate_limited"
        if r.status_code in (401,403):return None,"access_denied"
        if r.status_code!=200:return None,"http_"+str(r.status_code)
        if len(r.content)>4_000_000:return None,"response_too_large"
        try:
            data=r.json()
            return (data,None) if isinstance(data,dict) else (None,"invalid_response")
        except Exception:return None,"invalid_response"

async def search(client,req,norm,local):
    status={"status":"disabled","message":"Anahtarsız araştırma kapalı","queries":0,"results":0,"source_checked":0,"provider":"Tavily keyless"}
    if not enabled():return [],status
    location=f"{req.province} {req.district} {req.place}"
    kind="satılık tarla" if req.zoning=="field" else "satılık arsa tarla"
    queries=[f"{location} {kind} ilan fiyatı metrekare",f"{location} {kind} sahibinden hepsiemlak emlakjet remax"]
    found={}; errors=[];success=0
    for q in queries:
        status["queries"]+=1
        data,error=await call(client,"/search",{"query":q,"search_depth":"basic","max_results":20,"topic":"general"})
        if error:
            errors.append(error)
            if error in ("rate_limited","access_denied"):break
            continue
        rows=data.get("results",[])
        if not isinstance(rows,list):errors.append("invalid_response");continue
        success+=1
        for row in rows[:20]:
            item=make_candidate(row,req,norm,local)
            if not item:continue
            key=canonical(item["url"])
            old=found.get(key)
            if old is None or sum(item[x] is not None for x in ("price","area"))>sum(old[x] is not None for x in ("price","area")):
                found[key]=item
        # Two bounded searches are enough for an initial prototype; no retries on quota errors.
        if len(found)>=12:break
    out=sorted(found.values(),key=lambda x:(x["risky"],x["price"] is None,x["area"] is None,x["source"]))
    # The provider's documented extraction endpoint is used, not direct portal crawling.
    if out and not any(x in errors for x in ("rate_limited","access_denied")):
        selected=[x for x in out if not x["risky"]][:10]
        if selected:
            data,error=await call(client,"/extract",{"urls":[x["url"] for x in selected],"extract_depth":"basic"})
            if error:errors.append(error)
            else:
                by_url={canonical(x["url"]):x for x in selected}
                for row in data.get("results",[]):
                    if not isinstance(row,dict) or not safe_url(row.get("url")):continue
                    item=by_url.get(canonical(row["url"]))
                    if item:read_detail(item,row.get("raw_content",""),req,norm,local)
    out.sort(key=lambda x:(not x["source_checked"],x["risky"],x["price"] is None,x["area"] is None,x["source"]))
    checked=sum(x["source_checked"] for x in out)
    status.update(status="ok" if success else (errors[0] if errors else "error"),results=len(out),source_checked=checked,
                  message=f"{success} internet araması · {len(out)} ilan adayı · {checked} fiyat/alan bilgisi kaynak metninden okundu"+(" · "+", ".join(dict.fromkeys(errors)) if errors else ""))
    return out[:40],status

def reference(candidates,subject,req,norm,quantile):
    if not subject or not subject.get("area"):return None
    zone=req.zoning
    if zone=="unknown":
        nature=norm(subject.get("nature"))
        zone="field" if "tarla" in nature else "land" if nature=="arsa" else "unknown"
    if zone=="unknown":return None
    # Exact locality was checked before candidates were accepted. Never call
    # these a 1 km or active-listing estimate without separate verification.
    choices=[]
    for item in candidates:
        if item.get("risky") or not item.get("price") or not item.get("area"):continue
        if item.get("block")==str(req.block) and item.get("parcel")==str(req.parcel):continue
        if zone=="land":
            if item["kind"] not in ("land","residential"):continue
        elif item["kind"]!=zone:continue
        if not .5*subject["area"]<=item["area"]<=2*subject["area"]:continue
        choices.append(item)
    # Conservatively collapse matching parcel, or equal area and asking price.
    def distinct(rows):
        out=[];seen_parcels=set();seen_pairs=set()
        for i in rows:
            pair=(round(i["area"],1),round(i["price"]))
            cadas=(i["block"],i["parcel"]) if i.get("block") and i.get("parcel") else None
            if pair in seen_pairs or (cadas and cadas in seen_parcels):continue
            seen_pairs.add(pair)
            if cadas:seen_parcels.add(cadas)
            out.append(i)
        return out
    checked=distinct([i for i in choices if i["source_checked"]])
    rows=checked if len(checked)>=3 else distinct(sorted(choices,key=lambda x:not x["source_checked"]))
    if len(rows)<3:return None
    verified=len(checked)>=3
    units=[i["price"]/i["area"] for i in rows]
    area=subject["area"]
    return {"low":round(quantile(units,.25)*area),"median":round(quantile(units,.5)*area),"high":round(quantile(units,.75)*area),
            "count":len(rows),"scope":"Mahalle/köy · kaynak metni okunan ilan referansı" if verified else "Mahalle/köy · arama özeti ön tahmini (düşük güven)",
            "source_checked":sum(i["source_checked"] for i in rows),"conditional_zoning":req.zoning=="unknown","urls":[i["url"] for i in rows],
            "active_verified":False}
