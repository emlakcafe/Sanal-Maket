"""Parse individual listing cards from provider-returned category-page Markdown.

A card is a dated observation of an advertised price. It is not an independently
verified active listing, a cadastral location, or a completed sale.
"""
import re
from urllib.parse import urlsplit, urljoin, urlunsplit, unquote
from datetime import datetime, timezone
from bs4 import BeautifulSoup
import keyless_research as ev

LINK=re.compile(r"\[([^\]\n]{2,350})\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HEAD=re.compile(r"^\s*#{2,6}\s+(.+?)\s*$")
def strip_md(s):
    return re.sub(r"[*_#]+","",LINK.sub(lambda m:m.group(1),str(s))).strip()

def category(row,req,norm,local):
    url=row.get("url","")
    source=ev.source_for(url)
    if not source or ev.listing_url(url,source):return None
    path=unquote(urlsplit(url).path)
    n=norm(path)
    if not ("satilik" in n or (source=="RE/MAX" and "arsa arazi" in n)):return None
    if "kiralik" in n or not any(x in n.split() for x in ("arsa","tarla","arazi","bahce","zeytinlik")):return None
    if not ev.location_matches(str(row.get("title",""))+" "+path,req,norm,local):return None
    u=urlsplit(url)
    url=urlunsplit((u.scheme,u.netloc,u.path,"",""))
    return {"url":url,"source":source,"title":str(row.get("title",""))[:250]}

def clean_link(href,page):
    url=urljoin(page,href)
    source=ev.source_for(url)
    if not source or source!=ev.source_for(page) or not ev.listing_url(url,source):return None
    u=urlsplit(url)
    return urlunsplit((u.scheme,u.netloc,u.path,"",""))

def category_cards(page,raw,req,norm,local):
    source=page["source"];page_url=page["url"]
    if not category(page,req,norm,local):return []
    if not isinstance(raw,str) or not raw:return []
    if "<html" in raw[:1000].lower() or "<body" in raw[:1000].lower():
        soup=BeautifulSoup(raw,"html.parser")
        for a in soup.find_all("a",href=True):
            a.replace_with("["+a.get_text(" ",strip=True)+"]("+a["href"]+")")
        for h in soup.find_all(["h2","h3","h4","h5"]):
            h.replace_with("\n### "+h.get_text(" ",strip=True)+"\n")
        raw=soup.get_text("\n",strip=True)
    lines=raw[:180000].splitlines()
    markers=[]
    for idx,line in enumerate(lines):
        links=[(m.group(1),clean_link(m.group(2),page_url)) for m in LINK.finditer(line)]
        links=[(t,u) for t,u in links if u]
        h=HEAD.match(line)
        if links:
            # Image/empty card links are not titles.
            title,url=max(links,key=lambda t:len(t[0]))
            title=strip_md(title)
            if len(title)<8 or not any(x in norm(title) for x in ("arsa","tarla","arazi","bahce","zeytinlik","parsel","imarlı","imarli","satilik")):continue
            if len({u for _,u in links})>1:continue
            markers.append((idx,title,url))
        elif h:
            title=strip_md(h.group(1))
            n=norm(title)
            if any(x in n for x in ("ilanlari","fiyatlari","ilan bulundu","benzer ilanlar","diger ilanlar","filtrele","satilik arsa fiyat")):continue
            if not any(x in n for x in ("arsa","tarla","arazi","bahce","zeytinlik","parsel")):continue
            markers.append((idx,title,None))
    out=[];seen=set()
    page_kind=ev.type_from(page["title"],unquote(urlsplit(page_url).path),norm)
    for i,(idx,title,detail_url) in enumerate(markers):
        end=markers[i+1][0] if i+1<len(markers) else min(len(lines),idx+24)
        if end<=idx:continue
        body="\n".join(lines[idx+1:min(end,idx+24)])
        if len(body)>1800:continue
        # Category is province-specific, but each individual card must explicitly
        # match district and locality. No coordinates inferred from area names.
        n=norm(title+" "+body)
        if not ev.in_text(norm(req.district),n) or not ev.in_text(local(req.place),n):continue
        if ev.closed(title+" "+body,norm) or ev.risky(title+" "+body,norm):continue
        if "kiralik" in n and "satilik" not in norm(title):continue
        price,area=ev.price_area(body)
        if not area:
            _,area=ev.price_area(title)
        if not (price and area):continue
        kind=ev.type_from(title,body,norm)
        if kind=="unknown":kind=page_kind
        if kind=="land" and page_kind in ("residential","field"):kind=page_kind
        if kind=="unknown":continue
        key=detail_url or (norm(title),round(area,1),round(price))
        if key in seen:continue
        seen.add(key)
        out.append({"title":title[:200],"url":detail_url or page_url,"source":source,
          "price":price,"area":area,"kind":kind,"source_checked":True,
          "active_verified":False,"location_verified":False,"risky":False,
          "block":None,"parcel":None,"checked_at":datetime.now(timezone.utc).isoformat(),
          "observation_type":"category_card","category_url":page_url,
          "detail_url_available":bool(detail_url),
          "status":"Kaynak ilan listesindeki fiyat ve alan okundu; ilan aktifliği ve kesin konum teyit edilmedi"+("" if detail_url else " · bağlantı bölge ilan listesine aittir")})
    return out[:40]
