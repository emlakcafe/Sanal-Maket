"""On-demand web discovery for Emlak Cafe AI.

Uses the official Brave Web Search API with an operator-supplied API key.
Search results are candidates only; never counted as active/verified listings,
never geocoded from snippets, and never used for price valuation. No scraping,
no persistent storage of search results, no invented results.
"""
import asyncio, os, re, time
from urllib.parse import urlsplit, urlunsplit
from html import unescape
from licensed_sources import LISTING_SOURCES, safe_url

ENDPOINT="https://api.search.brave.com/res/v1/web/search"
LOCK=asyncio.Lock()
last_call=0.0

def config():
    return (os.getenv("EC_WEB_SEARCH_ENABLED","0")=="1",os.getenv("BRAVE_SEARCH_API_KEY","").strip())

def queries(req):
    location=f"{req.province} {req.district} {req.place}"
    kind="satılık tarla" if req.zoning=="field" else "satılık arsa tarla"
    return [f"{location} {kind}",f"{location} {kind} site:sahibinden.com",
            f"{location} {kind} site:hepsiemlak.com",f"{location} {kind} site:emlakjet.com",
            f"{location} {kind} site:remax.com.tr"]

def source_for(url):
    for name,(_,domains) in LISTING_SOURCES.items():
        if safe_url(url,domains):return name
    return None

def individual_url(url,source):
    p=urlsplit(url).path.rstrip("/")
    if source=="Sahibinden":return bool(re.search(r"/ilan/[^/]+-\d{5,}/detay$",p,re.I))
    if source=="Emlakjet":return bool(re.search(r"/ilan/[^/]+-\d{5,}$",p,re.I))
    if source=="Hepsiemlak":return bool(re.search(r"/\d{3,}-\d{1,}$",p))
    if source=="RE/MAX":return bool(re.search(r"/(?:tr/portfoy|en/property)/P\d+$",p,re.I))
    if source=="Emlak Cafe":return bool(re.search(r"/(?:listings|ilan)/[^/]+$",p,re.I))
    return bool(re.search(r"/(?:ilan|portfoy|property|properties|listing|detail|detay)/[^/]+(?:/\d+)?$",p,re.I))

def plain(v):
    return re.sub(r"\s+"," ",unescape(re.sub(r"<[^>]*>","",v))).strip() if isinstance(v,str) else ""

def distinct_value(pattern,text):
    found=set()
    for m in re.finditer(pattern,text,re.I):
        value=m.group(1).replace(" ","").replace(".","").replace(",",".")
        try:
            n=float(value)
            if n>0:found.add(n)
        except ValueError:pass
    return next(iter(found)) if len(found)==1 else None

def candidate(row,req,norm,local):
    if not isinstance(row,dict):return None
    url=row.get("url")
    if not safe_url(url):return None
    source=source_for(url)
    if not source or not individual_url(url,source):return None
    title=plain(row.get("title"))
    snippet=plain(row.get("description"))
    if not title:return None
    evidence=norm(title+" "+snippet+" "+urlsplit(url).path)
    place=local(req.place)
    if not place or not re.search(r"\b"+re.escape(place)+r"\b",evidence):return None
    if not re.search(r"\b"+re.escape(norm(req.district))+r"\b",evidence):return None
    if not re.search(r"\b"+re.escape(norm(req.province))+r"\b",evidence):return None
    if "satilik" not in evidence or ("kiralik" in evidence and "satilik" not in norm(title+" "+urlsplit(url).path)):return None
    if not any(x in evidence.split() for x in ("arsa","tarla","arazi","bahce","zeytinlik")):return None
    # Only present an explicit, unambiguous number printed in the result.
    # Search-result freshness does not establish an active listing.
    raw=title+" "+snippet
    price=distinct_value(r"(?<![\d.,])([\d][\d.,]*)\s*(?:TL|₺)(?!\s*/\s*m)",raw)
    area=distinct_value(r"(?<![\d.,/])([\d][\d.,]*)\s*m[²2](?!\s*/)",raw)
    u=urlsplit(url)
    return {"title":title[:200],"url":urlunsplit((u.scheme,u.netloc,u.path,"","")),"source":source,
            "price":price,"area":area,"active_verified":False,"location_verified":False,
            "status":"Arama sonucu; ilan aktifliği ve konumu doğrulanmadı"}

async def search(client,req,norm,local):
    enabled,key=config()
    status={"status":"connection_required","message":"Otomatik internet araması için Brave API bağlantısı gerekli","queries":0,"results":0}
    if not enabled or not key:return [],status
    seen={};errors=[];success=0
    global last_call
    for q in queries(req):
        try:
            async with LOCK:
                delay=max(0,1.05-(time.monotonic()-last_call))
                if delay:await asyncio.sleep(delay)
                last_call=time.monotonic()
                status["queries"]+=1
                r=await client.get(ENDPOINT,params={"q":q,"country":"TR","search_lang":"tr","count":20,"text_decorations":"false","result_filter":"web"},headers={"X-Subscription-Token":key,"Accept":"application/json"},timeout=6,follow_redirects=False)
            if r.status_code in (401,403,429):
                errors.append("HTTP "+str(r.status_code));break
            r.raise_for_status()
            data=r.json()
            rows=data.get("web",{}).get("results",[])
            if not isinstance(rows,list):raise ValueError("Invalid results")
            success+=1
            for row in rows[:20]:
                item=candidate(row,req,norm,local)
                if item:
                    old=seen.get(item["url"])
                    if old is None or sum(item[k] is not None for k in ("price","area"))>sum(old[k] is not None for k in ("price","area")):seen[item["url"]]=item
        except Exception:
            errors.append("Arama bağlantısı başarısız")
    out=list(seen.values())
    out.sort(key=lambda x:(x["price"] is None,x["area"] is None,x["source"]))
    status.update(status="ok" if success else "error",results=len(out),message=(str(success)+" arama tamamlandı; "+str(len(out))+" ilan adayı bulundu" if success else "İnternet araması tamamlanamadı")+("; "+", ".join(dict.fromkeys(errors)) if errors else ""))
    return out[:50],status
