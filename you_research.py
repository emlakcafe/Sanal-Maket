"""Independent keyless You.com MCP client for prototype research.

Official free endpoint, bounded usage; never retries a rate limit or
circumvents access restrictions. Search/extract observations are not licensed
live listing feeds. No result bodies or credentials are written to logs.
"""
import asyncio, json, os, time
from datetime import datetime, timezone
from urllib.parse import urlsplit
import keyless_research as evidence
from web_research import canonical
from licensed_sources import safe_url

URL="https://api.you.com/mcp/free"
LOCK=asyncio.Lock()
BACKOFF=0.0

def enabled():return os.getenv("EC_YOU_RESEARCH_ENABLED","1")=="1"
class MCPError(Exception):
    pass

class Session:
    def __init__(self,client):
        self.client=client
        self.session=None
        self.version="2025-03-26"
        self.n=0
    async def rpc(self,method,params=None,notification=False):
        global BACKOFF
        if time.monotonic()<BACKOFF:raise MCPError("rate_limited")
        self.n+=1
        request={"jsonrpc":"2.0","method":method}
        if not notification:request["id"]=self.n
        if params is not None:request["params"]=params
        headers={"Content-Type":"application/json","Accept":"application/json, text/event-stream","MCP-Protocol-Version":self.version}
        if self.session:headers["Mcp-Session-Id"]=self.session
        async with self.client.stream("POST",URL,json=request,headers=headers,timeout=12,follow_redirects=False) as response:
            if response.status_code==429:
                try:seconds=max(60,min(86400,int(response.headers.get("Retry-After","600"))))
                except ValueError:seconds=600
                BACKOFF=time.monotonic()+seconds
                raise MCPError("rate_limited")
            if response.status_code in (401,403):raise MCPError("access_denied")
            if response.status_code not in (200,202,204):raise MCPError("http_"+str(response.status_code))
            sid=response.headers.get("Mcp-Session-Id")
            if sid:self.session=sid
            if notification:return {}
            if "text/event-stream" in response.headers.get("Content-Type",""):
                lines=[];size=0
                async for line in response.aiter_lines():
                    size+=len(line)
                    if size>4_000_000:raise MCPError("response_too_large")
                    if line.startswith("data:"):lines.append(line[5:].lstrip())
                    elif not line and lines:
                        try:obj=json.loads("\n".join(lines))
                        except ValueError:obj={}
                        lines=[]
                        if isinstance(obj,dict) and obj.get("id")==self.n:return self.unwrap(obj)
                raise MCPError("no_rpc_response")
            chunks=[];size=0
            async for part in response.aiter_bytes():
                size+=len(part)
                if size>4_000_000:raise MCPError("response_too_large")
                chunks.append(part)
            try:obj=json.loads(b"".join(chunks))
            except ValueError:raise MCPError("invalid_json")
            if not isinstance(obj,dict) or obj.get("id")!=self.n:raise MCPError("invalid_rpc")
            return self.unwrap(obj)
    def unwrap(self,obj):
        global BACKOFF
        if obj.get("error"):
            msg=str(obj["error"]).lower()
            if "429" in msg or "rate limit" in msg or "quota" in msg:
                BACKOFF=time.monotonic()+600
                raise MCPError("rate_limited")
            raise MCPError("rpc_error")
        result=obj.get("result")
        if not isinstance(result,dict):raise MCPError("invalid_result")
        if result.get("isError"):
            msg=str(result.get("content","")).lower()
            if "429" in msg or "rate limit" in msg or "quota" in msg or "daily limit" in msg:
                BACKOFF=time.monotonic()+600
                raise MCPError("rate_limited")
            raise MCPError("tool_error")
        return result
    async def start(self):
        result=await self.rpc("initialize",{"protocolVersion":self.version,"capabilities":{},"clientInfo":{"name":"EmlakCafeResearch","version":"1.0"}})
        self.version=result.get("protocolVersion",self.version)
        await self.rpc("notifications/initialized",notification=True)
        tools=await self.rpc("tools/list",{})
        return {t["name"]:t.get("inputSchema",{}).get("properties",{}) for t in tools.get("tools",[]) if isinstance(t,dict) and "name" in t}
    async def call(self,name,args):
        return await self.rpc("tools/call",{"name":name,"arguments":args})

def documents(result):
    """Read structuredContent or JSON text MCP content blocks."""
    data=[]
    if isinstance(result.get("structuredContent"),(dict,list)):data.append(result["structuredContent"])
    for block in result.get("content",[]):
        if not isinstance(block,dict) or block.get("type")!="text":continue
        raw=block.get("text","")
        if not isinstance(raw,str) or len(raw)>4_000_000:continue
        try:data.append(json.loads(raw))
        except ValueError:pass
    return data

def rows_from(result):
    rows=[]
    def walk(value,depth=0):
        if depth>6:return
        if isinstance(value,dict):
            if isinstance(value.get("url"),str) and isinstance(value.get("title"),str):
                rows.append(value);return
            for k in ("results","web","data","result","search_results"):
                if k in value:walk(value[k],depth+1)
        elif isinstance(value,list):
            for x in value[:100]:walk(x,depth+1)
    for d in documents(result):walk(d)
    return rows[:100]

def text_list(v):
    if isinstance(v,str):return v
    if isinstance(v,list):return "\n".join(x if isinstance(x,str) else str(x.get("text","")) for x in v[:12] if isinstance(x,(str,dict)))
    return ""

def row_text(row):
    c=row.get("contents")
    c=c if isinstance(c,dict) else {}
    return "\n".join(text_list(row.get(k)) for k in ("description","snippets","highlights"))+"\n"+text_list(c.get("highlights"))

def extract_text(result,url):
    # Structured extraction payloads can be nested. Only accept a matching URL
    # when a URL field exists, and never follow extracted links.
    def walk(v,depth=0):
        if depth>6:return ""
        if isinstance(v,dict):
            if isinstance(v.get("url"),str) and canonical(v["url"])!=canonical(url):return ""
            for k in ("markdown","raw_content","content","text","contents","data","results","result"):
                if k in v:
                    x=v[k]
                    if isinstance(x,str) and len(x)>80:return x[:20000]
                    t=walk(x,depth+1)
                    if t:return t
        elif isinstance(v,list):
            for x in v[:10]:
                t=walk(x,depth+1)
                if t:return t
        return ""
    for d in documents(result):
        t=walk(d)
        if t:return t
    # The single-URL tool can also return plain Markdown text.
    blocks=result.get("content",[])
    if len(blocks)==1 and isinstance(blocks[0],dict) and blocks[0].get("type")=="text":
        raw=blocks[0].get("text","")
        if isinstance(raw,str) and len(raw)>80 and not raw.lstrip().startswith(("{","[")):return raw[:20000]
    return ""

async def search(client,req,norm,local,max_queries=2,extract_limit=4):
    status={"provider":"You.com MCP free","status":"disabled","queries":0,"results":0,"source_checked":0,"message":"Anahtarsız araştırma kapalı"}
    if not enabled():return [],status
    location=f"{req.province} {req.district} {req.place}"
    kind="satılık tarla" if req.zoning=="field" else "satılık arsa tarla"
    queries=[f"{location} {kind} ilan fiyatı metrekare",f"{location} {kind} emlakjet hepsiemlak sahibinden remax"]
    found={};errors=[];success=0;raw_count=0
    async with LOCK:
        try:
            session=Session(client)
            tools=await session.start()
            if "you-search" not in tools:raise MCPError("search_tool_missing")
            for q in queries[:max_queries]:
                args={"query":q}
                if "count" in tools["you-search"]:args["count"]=30
                status["queries"]+=1
                result=await session.call("you-search",args)
                rows=rows_from(result);raw_count+=len(rows);success+=1
                for row in rows:
                    item=evidence.make_candidate({"url":row["url"],"title":row["title"],"content":row_text(row)},req,norm,local)
                    if not item:continue
                    item["discovered_at"]=datetime.now(timezone.utc).isoformat()
                    key=canonical(item["url"])
                    old=found.get(key)
                    if old is None or sum(item[k] is not None for k in ("price","area"))>sum(old[k] is not None for k in ("price","area")):found[key]=item
                if sum(bool(i["price"] and i["area"] and not i["risky"]) for i in found.values())>=5:break
            if "you-extract" in tools:
                targets=sorted((i for i in found.values() if not i["risky"]),key=lambda i:(i["price"] is None,i["area"] is None))[:extract_limit]
                # Only the official single-URL extract tool; no direct scraping.
                for item in targets:
                    raw=await session.call("you-extract",{"url":item["url"]})
                    body=extract_text(raw,item["url"])
                    if body:evidence.read_detail(item,body,req,norm,local)
        except MCPError as e:errors.append(str(e))
        except asyncio.CancelledError:raise
        except Exception:errors.append("connection_or_parse_error")
    out=sorted(found.values(),key=lambda x:(not x["source_checked"],x["risky"],x["price"] is None,x["area"] is None,x["source"]))[:40]
    checked=sum(i["source_checked"] for i in out)
    status.update(status="ok" if success else (errors[0] if errors else "error"),results=len(out),raw_results=raw_count,source_checked=checked,message=f"You.com: {success} arama · {raw_count} arama sonucu · {len(out)} ilan adayı · {checked} kaynak metni okundu"+(" · "+", ".join(dict.fromkeys(errors)) if errors else ""))
    return out,status
