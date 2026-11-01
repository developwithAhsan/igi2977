const { Readable, Transform } = require("node:stream");
const { StringDecoder } = require("node:string_decoder");
const PRIMARY_HOST = "playigi.com";
const MAX_DIAGNOSTIC_BYTES = 2 * 1024 * 1024;
const TEXT_TYPES = /^(?:text\/|application\/(?:javascript|x-javascript|json|manifest\+json|xml))/i;
const EXTENSION_TYPES = {
  ".html":"text/html; charset=utf-8",".htm":"text/html; charset=utf-8",
  ".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",
  ".mjs":"application/javascript; charset=utf-8",".json":"application/json; charset=utf-8",
  ".webmanifest":"application/manifest+json; charset=utf-8",".xml":"application/xml; charset=utf-8",
  ".wasm":"application/wasm",".svg":"image/svg+xml",
  ".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".gif":"image/gif",
  ".webp":"image/webp",".avif":"image/avif",".ico":"image/x-icon",
  ".woff":"font/woff",".woff2":"font/woff2",".ttf":"font/ttf",".otf":"font/otf",
  ".mp3":"audio/mpeg",".ogg":"audio/ogg",".wav":"audio/wav",".mp4":"video/mp4",
  ".webm":"video/webm",".pdf":"application/pdf"
};
function sendError(res,status,message){
  res.statusCode=status;res.setHeader("Content-Type","text/plain; charset=utf-8");
  res.setHeader("Cache-Control","no-store");res.setHeader("X-Robots-Tag","noindex");res.end(message);
}
function baseOrigin(req){
  const proto=String(req.headers["x-forwarded-proto"]||"https").split(",")[0].trim();
  const host=String(req.headers["x-forwarded-host"]||req.headers.host||"").split(",")[0].trim();
  return (proto==="http"?"http":"https")+"://"+host;
}
function parseRequestedPath(url){
  let value=url.searchParams.get("path")||"";
  try{value=decodeURIComponent(value);}catch(_){}
  value=value.replace(/^\/+/,"");
  if(value.length>1800||value.includes("\0")||value.includes("\\")||
    value.split("/").some(part=>part==="."||part===".."))return null;
  return value;
}
function resolveUpstreamPath(path){
  const trailingSlash=path.endsWith("/");
  const parts=path.split("/").filter(Boolean);
  let host=PRIMARY_HOST;
  if(parts[0]==="_host"){
    host=String(parts[1]||"").toLowerCase();
    if(!/^(?:[a-z0-9-]+\.)+playigi\.com$/.test(host))return null;
    parts.splice(0,2);
  }
  const resolved="/"+parts.join("/");
  return {host,path:resolved==="/"?"/":resolved+(trailingSlash?"/":"")};
}
function proxyPathForUrl(raw){
  let parsed;try{parsed=new URL(raw,"https://"+PRIMARY_HOST);}catch(_){return raw;}
  const host=parsed.hostname.toLowerCase();
  if(host!==PRIMARY_HOST&&host!=="www."+PRIMARY_HOST&&!host.endsWith("."+PRIMARY_HOST))return raw;
  const prefix=(host===PRIMARY_HOST||host==="www."+PRIMARY_HOST)?"/g":"/g/_host/"+host;
  return prefix+(parsed.pathname||"/")+parsed.search+parsed.hash;
}
function rewriteRemoteHosts(text,origin){
  text=text.replace(/https?:\/\/(?:[a-z0-9-]+\.)*playigi\.com(?::\d+)?(?:\/[^"'\\s<>)]*)?/gi,value=>proxyPathForUrl(value));
  text=text.replace(/\/\/(?:[a-z0-9-]+\.)*playigi\.com(?::\d+)?(?:\/[^"'\\s<>)]*)?/gi,value=>proxyPathForUrl("https:"+value));
  return text.replace(/https?:\/\/(?:[a-z0-9-]+\.)*playigi\.com/gi,origin);
}
function rewriteRootPaths(text,contentType){
  const isHtml=/html/i.test(contentType),isCss=/css/i.test(contentType);
  if(isHtml){
    text=text.replace(/\b(target\s*=\s*)(["'])_(?:top|parent|blank)\2/gi,'$1"_self"');
    text=text.replace(/((?:href|src|action|poster|data-src|formaction|manifest)\s*=\s*)(["'])\/(?!\/|g(?:\/|["']))/gi,'$1$2/g/');
    text=text.replace(/(\bsrcset\s*=\s*["'][^"']*)/gi,value=>
      value.replace(/(^|[,\s])\/(?!\/|g(?:\/|[,\s]))/g,"$1/g/"));
  }
  if(isCss){
    text=text.replace(/url\((\s*["']?)\/(?!\/|g(?:\/|["')]))/gi,"url($1/g/");
    text=text.replace(/(@import\s+(?:url\(\s*)?["']?)\/(?!\/|g(?:\/|["')]))/gi,"$1/g/");
  }
  text=text.replace(/(["'\x60])\/(?!\/|g(?:\/|["'\x60]))([^"'\x60\s<>]*)/g,"$1/g/$2");
  text=text.replace(/\b(?:window\.)?top\.location\b/g,"window.location");
  text=text.replace(/\b(?:window\.)?top\s*!==?\s*(?:window\.)?self\b/g,"false");
  text=text.replace(/\b(?:window\.)?self\s*!==?\s*(?:window\.)?top\b/g,"false");
  text=text.replace(/\bparent\.location\b/g,"window.location");
  return text;
}
function extractPreloads(html){
  const found=new Set(),candidates=[];
  const stylesheet=[...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)];
  stylesheet.slice(0,2).forEach(m=>candidates.push({href:m[1],as:"style"}));
  const scripts=[...html.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi)];
  scripts.slice(0,3).forEach(m=>candidates.push({href:m[1],as:"script"}));
  const fonts=[...html.matchAll(/<link\b[^>]*rel=["']preload["'][^>]*href=["']([^"']+)["'][^>]*as=["']font["'][^>]*>/gi)];
  fonts.slice(0,3).forEach(m=>candidates.push({href:m[1],as:"font",cross:true}));
  const image=html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i)||
    html.match(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/i);
  if(image&&image[1])candidates.unshift({href:image[1],as:"image"});
  const tags=[];
  for(const item of candidates){
    let href=item.href;
    if(!href||/^(?:data:|blob:|javascript:|mailto:|tel:|\/\/)/i.test(href))continue;
    if(/^https?:\/\//i.test(href)){
      try{const u=new URL(href);if(!/(?:^|\.)playigi\.com$/i.test(u.hostname))continue;href=proxyPathForUrl(u.href);}
      catch(_){continue;}
    }else if(href.startsWith("/")){
      if(!href.startsWith("/g/"))href="/g"+href;
    }else{
      href="/g/"+href.replace(/^(?:\.\/)+/,"").replace(/^\/+/,"");
    }
    if(!href.startsWith("/g/")||found.has(href))continue;
    found.add(href);
    tags.push('<link rel="preload" href="'+href.replace(/&/g,"&amp;").replace(/"/g,"&quot;")+
      '" as="'+item.as+'"'+(item.cross?' crossorigin="anonymous"':"")+">");
  }
  return tags.join("");
}
const PROXY_THEME=[
  '<meta name="robots" content="noindex,nofollow">',
  '<style id="igi-proxy-theme">',
  ':root{--bg:#070806;--screen:#020b05;--surface:#020b05;--text:#5dff8a;--highlight:#c8ffd8;',
  '--muted:rgba(93,255,138,.70);--border:rgba(93,255,138,.30);',
  '--font-menu:"IGI Menu","Courier New",ui-monospace,monospace;',
  '--font-small:"IGI Small","Courier New",ui-monospace,monospace;',
  '--font-tiny:"IGI Tiny","Courier New",ui-monospace,monospace}',
  'html,body{margin:0!important;min-width:0!important;width:100%!important;background:#020b05!important;',
  'color:#5dff8a!important;font-family:var(--font-small)!important;font-size:14px!important;line-height:1.55!important;',
  'overflow-x:hidden!important;-webkit-font-smoothing:none!important}',
  'body{min-height:100svh!important;padding:0!important}',
  'a{color:#5dff8a!important;text-decoration-color:rgba(93,255,138,.3)!important}',
  'button,input,select,textarea{font-family:var(--font-small)!important;border-radius:0!important}',
  'h1,h2,h3,h4,nav,header,.menu,.title,.heading{font-family:var(--font-menu)!important;color:#c8ffd8!important}',
  'img,video,canvas,svg{max-width:100%}',
  '</style>'
].join("");
function rewriteDocument(text,type,origin){
  text=rewriteRemoteHosts(text,origin);text=rewriteRootPaths(text,type);
  text=text.replace(/playigi\.com/gi,"IGI Online");
  if(/html/i.test(type)){
    const inject=PROXY_THEME+extractPreloads(text);
    if(/<\/head\s*>/i.test(text))text=text.replace(/<\/head\s*>/i,inject+"</head>");
    else text=inject+text;
  }
  return text;
}
const MAX_HTML_REWRITE_BYTES = 8 * 1024 * 1024;
class TextRewriteTransform extends Transform{
  constructor(type,origin){
    super();
    this.type=type;this.origin=origin;this.isHtml=/html/i.test(type);
    this.decoder=new StringDecoder("utf8");this.pending="";
    this.htmlChunks=[];this.htmlBytes=0;
  }
  _transform(chunk,encoding,callback){
    try{
      const decoded=this.decoder.write(chunk);
      if(this.isHtml){
        this.htmlBytes+=Buffer.byteLength(decoded);
        if(this.htmlBytes>MAX_HTML_REWRITE_BYTES){
          callback(new Error("HTML rewrite limit exceeded"));return;
        }
        this.htmlChunks.push(decoded);callback();return;
      }
      const combined=this.pending+decoded;
      const keep=8192,cut=combined.length-keep;
      if(cut>0){
        this.push(rewriteDocument(combined.slice(0,cut),this.type,this.origin));
        this.pending=combined.slice(cut);
      }else this.pending=combined;
      callback();
    }catch(error){callback(error);}
  }
  _flush(callback){
    try{
      if(this.isHtml){
        const html=this.htmlChunks.join("")+this.decoder.end();
        this.push(rewriteDocument(html,this.type,this.origin));
        this.htmlChunks.length=0;
      }else{
        this.push(rewriteDocument(this.pending+this.decoder.end(),this.type,this.origin));
      }
      callback();
    }catch(error){callback(error);}
  }
}
function guessType(path){
  const ext=(path.match(/\.[a-z0-9]{1,8}$/i)||[""])[0].toLowerCase();
  return EXTENSION_TYPES[ext]||"application/octet-stream";
}
function isVersioned(url,path){
  return /(?:^|[._-])[a-f0-9]{8,}(?:[._-]|$)/i.test(path)||/[?&](?:v|ver|version|hash)=[^&]+/i.test(url);
}
function cachePolicy(url,path,type){
  if(/html/i.test(type))return "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
  if(isVersioned(url,path))return "public, max-age=31536000, immutable";
  if(type==="application/wasm")return "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";
  return "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
}
function rewriteCookie(cookie){
  return cookie.replace(/;\s*Domain=[^;]*/ig,"")
    .replace(/;\s*Path=\/(?=;|$)/ig,"; Path=/g/")
    .replace(/;\s*Path=([^;]*)/ig,(m,path)=>path.startsWith("/g/")?m:"; Path=/g"+(path.startsWith("/")?path:"/"+path));
}
function rewriteLocation(value){
  if(!value)return value;
  try{
    const u=new URL(value,"https://"+PRIMARY_HOST),host=u.hostname.toLowerCase();
    if(host===PRIMARY_HOST||host==="www."+PRIMARY_HOST||host.endsWith("."+PRIMARY_HOST))return proxyPathForUrl(u.href);
    if(value.startsWith("/")&&!value.startsWith("//"))return "/g"+value;
  }catch(_){}
  return value;
}
function requestHeaders(req,upstreamOrigin,path){
  const headers=new Headers();
  if(req.headers.accept)headers.set("accept",req.headers.accept);
  if(req.headers["accept-language"])headers.set("accept-language",req.headers["accept-language"]);
  if(req.headers["user-agent"])headers.set("user-agent",req.headers["user-agent"]);
  if(req.headers.range)headers.set("range",req.headers.range);
  if(req.headers.cookie)headers.set("cookie",req.headers.cookie);
  headers.set("accept-encoding","identity");
  headers.set("referer",upstreamOrigin+(path==="/"?"/":path));
  headers.set("origin","https://"+PRIMARY_HOST);
  if(process.env.PLAYIGI_PROXY_KEY)headers.set("X-Proxy-Key",process.env.PLAYIGI_PROXY_KEY);
  return headers;
}
function setSafeHeaders(response,res,targetUrl,targetPath,origin,type){
  const blocked=/^(?:server|via|alt-svc|cf-.+|x-powered-by|x-vercel-id)$/i;
  const allowed=new Set([
    "content-type","content-length","content-range","accept-ranges","etag","last-modified","cache-control",
    "expires","vary","content-disposition","retry-after","www-authenticate","location","link","set-cookie",
    "content-security-policy","content-security-policy-report-only","x-frame-options","cross-origin-resource-policy",
    "cross-origin-opener-policy","cross-origin-embedder-policy","referrer-policy","permissions-policy",
    "access-control-allow-origin","access-control-allow-headers","access-control-allow-methods",
    "access-control-expose-headers","access-control-max-age","service-worker-allowed"
  ]);
  for(const [name,raw] of response.headers.entries()){
    const key=name.toLowerCase();if(blocked.test(key)||!allowed.has(key)||key==="set-cookie")continue;
    let value=raw;
    if(key==="location")value=rewriteLocation(value);
    if(key==="link")value=rewriteRemoteHosts(value,origin).replace(/(["'])\/(?!\/|g\/)/g,'$1/g/');
    if(key==="content-security-policy"||key==="content-security-policy-report-only")
      value=value.replace(/https?:\/\/(?:[a-z0-9-]+\.)*playigi\.com/gi,origin);
    if(key==="service-worker-allowed")value="/g/";
    res.setHeader(name,value);
  }
  if(typeof response.headers.getSetCookie==="function"){
    const cookies=response.headers.getSetCookie().map(rewriteCookie);if(cookies.length)res.setHeader("Set-Cookie",cookies);
  }else{
    const cookie=response.headers.get("set-cookie");if(cookie)res.setHeader("Set-Cookie",rewriteCookie(cookie));
  }
  if(/html/i.test(type)){res.setHeader("X-Robots-Tag","noindex, nofollow");res.removeHeader("Content-Length");res.removeHeader("ETag");}
  res.setHeader("Content-Type",type);
  res.setHeader("Cache-Control",cachePolicy(targetUrl,targetPath,type));
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
  res.setHeader("Vary","Accept-Encoding, Range");
}
module.exports=async function handler(req,res){
  try{
    if(!["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"].includes(req.method)){
      res.setHeader("Allow","GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");return sendError(res,405,"Method not allowed");
    }
    const incoming=new URL(req.url,"https://proxy.invalid");
    const path=parseRequestedPath(incoming);if(path===null)return sendError(res,400,"Invalid upstream path");
    const mapped=resolveUpstreamPath(path);if(!mapped)return sendError(res,400,"Invalid upstream host");
    const target=new URL(mapped.path,"https://"+mapped.host);
    for(const [key,value] of incoming.searchParams.entries())if(key!=="path"&&key!=="__diag")target.searchParams.append(key,value);
    const origin=baseOrigin(req);
    const headers=requestHeaders(req,target.origin,mapped.path);
    const init={method:req.method,headers,redirect:"manual",signal:AbortSignal.timeout(240000)};
    if(!["GET","HEAD"].includes(req.method)){init.body=Readable.toWeb(req);init.duplex="half";}
    const upstream=await fetch(target.href,init);
    if([301,302,303,307,308].includes(upstream.status)){
      setSafeHeaders(upstream,res,target.href,mapped.path,origin,upstream.headers.get("content-type")||"text/plain; charset=utf-8");
      res.statusCode=upstream.status;return res.end();
    }
    const type=upstream.headers.get("content-type")||guessType(mapped.path);
    setSafeHeaders(upstream,res,target.href,mapped.path,origin,type);
    res.statusCode=upstream.status;
    if(req.method==="HEAD"||!upstream.body)return res.end();
    if(TEXT_TYPES.test(type)){
      res.removeHeader("Content-Length");res.removeHeader("Content-Encoding");
      const source=Readable.fromWeb(upstream.body),transform=new TextRewriteTransform(type,origin);
      source.on("error",()=>{if(!res.headersSent)res.statusCode=502;res.destroy();});
      transform.on("error",()=>res.destroy());
      source.pipe(transform).pipe(res);return;
    }
    const source=Readable.fromWeb(upstream.body);
    source.on("error",()=>{if(!res.headersSent)res.statusCode=502;res.destroy();});
    source.pipe(res);
  }catch(error){
    console.error("[playigi-proxy]",error&&error.stack?error.stack:error);
    if(!res.headersSent)return sendError(res,502,"The upstream game site could not be reached. Please retry.");
    res.destroy();
  }
};
