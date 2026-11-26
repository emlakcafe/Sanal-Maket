"""Emlak Cafe's own public listing reader and user-initiated search links.

Never copy third-party sites here. Feed adapters handle licensed third-party data.
The public first-party API may change; unexpected schemas are reported, not guessed.
"""
import re, math
from urllib.parse import urlencode
from datetime import datetime,timezone
from licensed_sources import positive, number, safe_url

BASE="https://www.emlakcafe.com.tr"
def take(row,*keys):
    for k in keys:
        if k in row and row[k] is not None and row[k]!="":return row[k]
    return None
def label(value):
    if isinstance(value,dict):return take(value,"name","label","title") or ""
    return value if isinstance(value,str) else ""
def list_rows(data):
    if isinstance(data,list):return data
    if not isinstance(data,dict):return None
    for k in ("items","listings","results","data"):
        if k in data:
            v=data[k]
            if isinstance(v,list):return v
            if isinstance(v,dict):
                for sub in ("items","listings","results"):
                    if isinstance(v.get(sub),list):return v[sub]
    return None
def first_party_item(row,req,norm,local):
    if not isinstance(row,dict):return None
    # Accept only records explicitly marked as public/published and EIDS-verified.
    status=norm(label(take(row,"status","publicationStatus")))
    eids=norm(label(take(row,"eidsStatus","eidsVerificationStatus","verificationStatus")))
    if status not in {"published","active","yayinda","aktif"}:return None
    if not (row.get("hasEids") is True or row.get("eidsVerified") is True or eids in {"eids verified","verified","dogrulandi"}):return None
    if row.get("isActive") is False or row.get("active") is False:return None
    loc=row.get("location") if isinstance(row.get("location"),dict) else {}
    province=label(take(row,"province","city","provinceName","cityName") or take(loc,"province","city","provinceName","cityName"))
    district=label(take(row,"district","districtName") or take(loc,"district","districtName"))
    place=label(take(row,"neighborhood","neighbourhood","village","mahalle","neighborhoodName") or take(loc,"neighborhood","village","neighborhoodName"))
    if norm(province)!=norm(req.province) or norm(district)!=norm(req.district) or local(place)!=local(req.place):return None
    tx=norm(label(take(row,"transactionType","listingType","transaction","purpose","offerType")))
    if tx not in {"sale","sell","for sale","satilik","satilik ilan"}:return None
    cat=norm(label(take(row,"propertyType","category","type","propertyCategory")))
    if cat not in {"land","plot","field","arsa","tarla","arazi","bag bahce","zeytinlik","bag ve bahce","agricultural land"}:return None
    currency=take(row,"currency","currencyCode")
    if currency and str(currency).upper() not in {"TRY","TL"}:return None
    area=positive(take(row,"area","areaM2","landArea","squareMeters","grossArea","grossSquareMeters","size"))
    price=positive(take(row,"price","askingPrice","amount"))
    title=take(row,"title","name")
    id=take(row,"id","listingId")
    url=take(row,"url","canonicalUrl","publicUrl")
    if not safe_url(url,("emlakcafe.com.tr",)):
        if not isinstance(id,str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,120}",id):return None
        url=BASE+"/listings/"+id
    if not (area and price and isinstance(title,str) and title.strip()):return None
    rawblock=take(row,"block","blockNo","ada","adaNo")
    rawparcel=take(row,"parcel","parcelNo","parsel","parselNo")
    zoning=norm(label(take(row,"zoning","zoningStatus","imarDurumu")))
    tenure=norm(label(take(row,"tenure","titleDeed","deedStatus")))
    kind="field" if cat in {"field","tarla","agricultural land","bag bahce","zeytinlik","bag ve bahce"} else "residential" if zoning in {"konut imarli","villa imarli","residential","residential zoned"} else "unknown"
    # A public listing does not by itself establish full title or planning permission.
    verified=tenure in {"full","mustakil tapulu","mustakil","tek tapu"}
    return {"title":title.strip()[:220],"url":url,"price":price,"area":area,"unit":price/area,"kind":kind,"type":kind,"block":number(rawblock,True),"parcel":number(rawparcel),"source":"Emlak Cafe","live":True,"detail_verified":verified,"center":None,"distance":None,"checked_at":datetime.now(timezone.utc).isoformat(),"provenance":"first_party_public"}
async def collect(client,req,stats,norm,local):
    try:
        r=await client.get(BASE+"/api/listings",params={"province":req.province,"district":req.district,"neighborhood":req.place,"limit":100},timeout=10,follow_redirects=False)
        if r.status_code!=200:
            stats.update(status="error",message=f"Emlak Cafe ilan API: HTTP {r.status_code}");return []
        if len(r.content)>5_000_000:
            stats.update(status="error",message="Emlak Cafe API yanıt sınırı aşıldı");return []
        data=r.json();rows=list_rows(data)
        if rows is None:
            stats.update(status="error",message="Emlak Cafe API veri biçimi eşleşmedi");return []
        out=[];seen=set()
        for row in rows[:250]:
            item=first_party_item(row,req,norm,local)
            if item and item["url"] not in seen:out.append(item);seen.add(item["url"])
        stats.update(links=len(rows),listed=len(out),verified=sum(bool(i["detail_verified"]) for i in out),status="ok" if out else "empty",message=f"Emlak Cafe API okundu: {len(rows)} kayıt, {len(out)} uygun yayımlanmış ilan")
        return out
    except Exception:
        stats.update(status="error",message="Emlak Cafe ilan API bağlantısı veya veri biçimi doğrulanamadı");return []
def research_links(req):
    q=f"{req.province} {req.district} {req.place} satılık "+("tarla" if req.zoning=="field" else "arsa tarla")
    domains={"Sahibinden":"sahibinden.com","Hepsiemlak":"hepsiemlak.com","Emlakjet":"emlakjet.com","RE/MAX":"remax.com.tr","Zingat":"zingat.com","Turyap":"turyap.com.tr","TEKCE":"tekce.com","Coldwell Banker":"cb.com.tr","Century 21":"century21.com.tr","ERA":"era.com.tr","Keller Williams":"kwturkiye.com","Realty World":"realtyworld.com.tr","Emlak Cafe":"emlakcafe.com.tr"}
    return [{"source":name,"url":"https://www.google.com/search?"+urlencode({"q":q+" site:"+domain})} for name,domain in domains.items()]
