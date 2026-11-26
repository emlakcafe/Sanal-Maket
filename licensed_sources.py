"""Permission-based source adapters for Emlak Cafe AI.

Each feed URL is an operator-configured HTTPS endpoint implementing our
normalized contract, NOT a guessed platform API. Configure only after a
license/permission covering commercial valuation and display is in place.
"""
import math, os, re
from datetime import datetime, timezone
from urllib.parse import urlsplit

LISTING_SOURCES = {
    "Emlak Cafe": ("EMLAKCAFE", ("emlakcafe.com.tr",)),
    "Sahibinden": ("SAHIBINDEN", ("sahibinden.com",)),
    "Hepsiemlak": ("HEPSIEMLAK", ("hepsiemlak.com",)),
    "Emlakjet": ("EMLAKJET", ("emlakjet.com",)),
    "RE/MAX": ("REMAX", ("remax.com.tr",)),
    "Zingat": ("ZINGAT", ("zingat.com",)),
    "Turyap": ("TURYAP", ("turyap.com.tr",)),
    "TEKCE": ("TEKCE", ("tekce.com",)),
    "Coldwell Banker": ("COLDWELLBANKER", ("cb.com.tr", "coldwellbanker.com.tr")),
    "Century 21": ("CENTURY21", ("century21.com.tr",)),
    "ERA": ("ERA", ("era.com.tr",)),
    "Keller Williams": ("KW", ("kwturkiye.com", "kw.com.tr")),
    "Realty World": ("REALTYWORLD", ("realtyworld.com.tr",)),
}
VALUATION_SOURCES = {"Endeksa": ("ENDEKSA", ("endeksa.com",))}
def prefix(key):return "EC_"+key+"_"
def config(key):
    p=prefix(key)
    return (os.getenv(p+"AUTHORIZED","")=="1",os.getenv(p+"FEED_URL","").strip(),os.getenv(p+"FEED_TOKEN","").strip())
def safe_url(url,domains=()):
    if not isinstance(url,str) or len(url)>2048:return False
    try:
        u=urlsplit(url); host=u.hostname or ""
        return u.scheme=="https" and bool(host) and not u.username and not u.password and (not domains or any(host==d or host.endswith("."+d) for d in domains))
    except ValueError:return False
def positive(v):
    if isinstance(v,bool):return None
    try:
        x=float(v)
        return x if math.isfinite(x) and x>0 else None
    except (TypeError,ValueError,OverflowError):return None
def recent(value, hours=24):
    if not isinstance(value,str):return False
    try:
        t=datetime.fromisoformat(value.replace("Z","+00:00"))
        if t.tzinfo is None:return False
        age=(datetime.now(timezone.utc)-t).total_seconds()
        return -300<=age<=hours*3600
    except (ValueError,OverflowError):return False
def number(value,zero=False):
    if value is None or isinstance(value,bool):return None
    v=str(value).strip()
    if not re.fullmatch(r"[0-9]{1,9}",v):return None
    return str(int(v)) if zero or int(v)>0 else None
def request_payload(req):
    return {"province":req.province,"district":req.district,"place":req.place,"block":req.block,"parcel":req.parcel,"zoning":req.zoning,"transaction":"sale","category":"land"}
async def payload(client,key,req,stats):
    authorized,url,token=config(key)
    if not authorized:
        stats.update(status="permission_required",message="Ticari veri kullanım izni gerekli")
        return None
    if not safe_url(url) or not token:
        stats.update(status="connection_required",message="Lisanslı veri bağlantısı ve erişim anahtarı gerekli")
        return None
    try:
        r=await client.post(url,json=request_payload(req),headers={"Authorization":"Bearer "+token,"Accept":"application/json"},timeout=10,follow_redirects=False)
        r.raise_for_status()
        if len(r.content)>2_000_000:raise ValueError("Response too large")
        data=r.json()
        if not isinstance(data,dict):raise ValueError("Invalid response")
        return data
    except Exception:
        stats.update(status="error",message="Yetkili kaynak bağlantısı başarısız")
        return None
def normalize_listing(row,req,name,domains,norm,local):
    if not isinstance(row,dict) or row.get("active") is not True or row.get("transaction")!="sale" or row.get("category")!="land":return None
    if not recent(row.get("checked_at")):return None
    if norm(row.get("province"))!=norm(req.province) or norm(row.get("district"))!=norm(req.district) or local(row.get("place"))!=local(req.place):return None
    price,area=positive(row.get("price")),positive(row.get("area"))
    title=row.get("title");url=row.get("url")
    if not price or not area or not isinstance(title,str) or not title.strip() or not safe_url(url,domains):return None
    if row.get("currency")!="TRY":return None
    b=number(row.get("block"),True);p=number(row.get("parcel"))
    kind=row.get("kind")
    if kind not in ("residential","field","unknown"):kind="unknown"
    # Shared/unknown title deeds may be shown, but cannot enter full-parcel valuation.
    tenure=row.get("tenure")
    verified=row.get("detail_verified") is True and tenure=="full"
    return {"title":title.strip()[:220],"url":url,"price":price,"area":area,"unit":price/area,"kind":kind,"type":kind,"block":b,"parcel":p,"source":name,"live":True,"detail_verified":verified,"center":None,"distance":None,"checked_at":row["checked_at"],"tenure":tenure,"provenance":"authorized_feed"}
async def listings(client,req,name,stats,norm,local):
    key,domains=LISTING_SOURCES[name]
    data=await payload(client,key,req,stats)
    if data is None:return []
    rows=data.get("items")
    if not isinstance(rows,list):
        stats.update(status="error",message="Veri biçimi geçersiz")
        return []
    stats["links"]=len(rows)
    out=[];seen=set()
    for row in rows[:250]:
        item=normalize_listing(row,req,name,domains,norm,local)
        if item and item["url"] not in seen:
            out.append(item);seen.add(item["url"])
    stats.update(listed=len(out),verified=sum(bool(i["detail_verified"]) for i in out),status="ok" if out else "empty",message="İzinli veri akışı okundu" if out else "Uygun güncel ilan alınamadı")
    return out
async def valuation(client,req,name,stats,norm,local):
    key,domains=VALUATION_SOURCES[name]
    data=await payload(client,key,req,stats)
    if data is None:return None
    lo,hi=positive(data.get("low")),positive(data.get("high"))
    same=(norm(data.get("province"))==norm(req.province) and norm(data.get("district"))==norm(req.district) and local(data.get("place"))==local(req.place) and number(data.get("block"),True)==req.block and number(data.get("parcel"))==req.parcel)
    if not (same and lo and hi and lo<=hi and data.get("currency")=="TRY" and recent(data.get("checked_at"))):
        stats.update(status="empty",message="Bu parsele ait doğrulanabilir güncel değerleme alınamadı")
        return None
    stats.update(status="ok",message="Lisanslı değerleme referansı alındı")
    return {"source":name,"low":lo,"high":hi,"checked_at":data["checked_at"],"kind":"external_valuation"}
