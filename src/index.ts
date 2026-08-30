interface Env {}

const DOH_URL = 'https://1.1.1.1/dns-query';
const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      ...NO_CACHE,
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    if (url.pathname === '/api/visitor') {
      const cf = (request as any).cf || {};
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      return Response.json({
        ip, country: cf.country || '', city: cf.city || '', region: cf.region || '',
        postal: cf.postalCode || '', latitude: cf.latitude || '', longitude: cf.longitude || '',
        timezone: cf.timezone || '', asn: cf.asn || '', as_org: cf.asOrganization || '', colo: cf.colo || '',
      }, { headers: corsHeaders });
    }

    if (url.pathname === '/api/radar') {
      const ipver = url.searchParams.get('ip') || '4';
      const radarUrl = ipver === '6' ? 'https://ipv6-check-perf.radar.cloudflare.com/' : 'https://ipv4-check-perf.radar.cloudflare.com/';
      try {
        const res = await fetch(radarUrl, { signal: AbortSignal.timeout(8000) });
        return Response.json(await res.json(), { headers: corsHeaders });
      } catch (e: any) { return Response.json({ error: e?.message }, { status: 500, headers: corsHeaders }); }
    }

    if (url.pathname === '/api/lookup') {
      const target = url.searchParams.get('target')?.trim();
      if (!target) return Response.json({ error: 'Missing target' }, { status: 400, headers: corsHeaders });
      try {
        const isIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(target);
        const isIPv6 = target.includes(':') && !target.includes('.');
        const isDomain = !isIPv4 && !isIPv6;
        const result: any = { target, type: isDomain ? 'domain' : (isIPv6 ? 'ipv6' : 'ipv4') };
        if (isDomain) {
          const [a, aaaa] = await Promise.all([resolveDNS(target, 'A'), resolveDNS(target, 'AAAA')]);
          result.dns = { a, aaaa };
          const allIps = [...a, ...aaaa];
          if (allIps.length === 0) { result.error = 'No DNS records found'; }
          else {
            const geos = await Promise.all(allIps.map(ip => lookupIP(ip)));
            result.geolocation = {};
            const seen = new Set();
            for (let i = 0; i < allIps.length; i++) {
              const ip = allIps[i];
              const geo = geos[i];
              if (!geo || seen.has(ip)) continue;
              seen.add(ip);
              const ver = ip.includes(':') ? 'ipv6' : 'ipv4';
              if (!result.geolocation[ver]) result.geolocation[ver] = geo;
            }
            if (a[0]) result.resolved_ip = a[0];
            else if (aaaa[0]) result.resolved_ip = aaaa[0];
          }
        } else {
          const geo = await lookupIP(target);
          if (geo) { result.geolocation = {}; result.geolocation[result.type] = geo; }
        }
        return Response.json(result, { headers: corsHeaders });
      } catch (e: any) { return Response.json({ error: e?.message }, { status: 500, headers: corsHeaders }); }
    }

    return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_CACHE } });
  },
};

async function resolveDNS(name: string, type: string): Promise<string[]> {
  try {
    const res = await fetch(`${DOH_URL}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { 'Accept': 'application/dns-json' }, signal: AbortSignal.timeout(5000) });
    const data: any = await res.json();
    if (!data.Answer) return [];
    return data.Answer.filter((r: any) => r.type === (type === 'A' ? 1 : type === 'AAAA' ? 28 : 12)).map((r: any) => r.data);
  } catch { return []; }
}

async function lookupIP(ip: string): Promise<any | null> {
  try {
    const res = await fetch(`https://ipinfo.io/${ip}/json`, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const d: any = await res.json();
    if (d.error) return null;
    const [lat, lon] = (d.loc || ',').split(',');
    return { ip: d.ip, country: d.country, region: d.region, city: d.city, postal: d.postal, latitude: lat || '', longitude: lon || '', timezone: d.timezone || '', org: d.org || '' };
  } catch { return null; }
}

const HTML = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>IPDC - IP Lookup</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌐</text></svg>">
<style>
:root{--bg:#0f0f23;--card:#111827;--border:#1e293b;--text:#e2e8f0;--muted:#94a3b8;--accent:#3b82f6;--accent2:#8b5cf6;--green:#22c55e;--red:#ef4444;}
[data-theme="light"]{--bg:#f5f5f7;--card:rgba(255,255,255,0.85);--border:rgba(0,0,0,0.08);--text:#1d1d1f;--muted:#86868b;--accent:#0071e3;--accent2:#5856d6;--green:#34c759;--red:#ff3b30;}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;transition:background .3s,color .3s;}
.wrap{max-width:900px;margin:0 auto;padding:32px 16px;}
.hdr{text-align:center;margin-bottom:24px;position:relative;}
.hdr h1{font-size:2em;margin-bottom:6px;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.hdr p{color:var(--muted);font-size:.95em;}
.theme-btn{position:absolute;top:0;right:0;width:36px;height:36px;border-radius:50%;border:1px solid var(--border);background:var(--card);cursor:pointer;font-size:1.1em;display:flex;align-items:center;justify-content:center;transition:all .3s;}
.theme-btn:hover{transform:scale(1.1);box-shadow:0 2px 8px rgba(0,0,0,.2);}
.search{display:flex;gap:10px;margin-bottom:24px;}
.search input{flex:1;padding:12px 16px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:1em;outline:none;transition:all .3s;}
.search input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(59,130,246,.15);}
.search button{padding:12px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-weight:600;cursor:pointer;}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px;margin-bottom:14px;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);transition:all .3s;}
.card-t{font-size:.78em;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:12px;}
.dot{width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block;margin-right:6px;}
.ip{font-size:1.5em;font-weight:700;font-family:monospace;color:var(--accent);word-break:break-all;}
.badge{display:inline-block;padding:2px 8px;border-radius:5px;font-size:.5em;font-weight:600;text-transform:uppercase;vertical-align:middle;margin-left:8px;}
.b4{background:rgba(59,130,246,.15);color:var(--accent);}
.b6{background:rgba(139,92,246,.15);color:var(--accent2);}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;}
.item{padding:8px 12px;background:rgba(255,255,255,.03);border-radius:8px;}
[data-theme="light"] .item{background:rgba(0,0,0,.03);}
.item-l{font-size:.7em;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;}
.item-v{font-size:.9em;font-weight:500;}
.mono{font-family:monospace;font-size:.85em;}
.dns{font-family:monospace;font-size:.85em;line-height:2;}
.dns-t{color:var(--accent2);font-weight:600;margin-right:4px;}
.globe{width:100%;height:350px;border-radius:10px;overflow:hidden;background:#000;margin-bottom:14px;}
.loading{text-align:center;padding:30px;color:var(--muted);}
.spinner{width:24px;height:24px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 8px;}
@keyframes spin{to{transform:rotate(360deg);}}
.meta{border-left:3px solid var(--accent);}
.row{display:flex;gap:14px;flex-wrap:wrap;}
.row>.card{flex:1;min-width:260px;}
.foot{text-align:center;margin-top:28px;color:var(--muted);font-size:.8em;border-top:1px solid var(--border);padding-top:14px;}
.err{text-align:center;color:var(--red);}
@media(max-width:600px){.search{flex-direction:column;}.row{flex-direction:column;}}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <button class="theme-btn" onclick="toggleTheme()" id="themeBtn">🌙</button>
    <h1>IPDC</h1>
    <p>IPv4/IPv6 双栈查询 — 地理位置、ISP、DNS 解析</p>
  </div>
  <div class="search">
    <input type="text" id="q" placeholder="输入 IP 或域名，例如 8.8.8.8 / google.com" onkeydown="if(event.key==='Enter')doLookup()">
    <button onclick="doLookup()" id="btn">🔍 查询</button>
  </div>
  <div id="results"></div>
  <div id="metaBox"></div>
  <div class="foot">Powered by Workers + DNS-over-HTTPS + globe.gl</div>
</div>
<script src="https://unpkg.com/globe.gl@2.35.1/dist/globe.gl.min.js"></script>
<script>
var globe=null;

// ─── Theme ───
(function(){var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t);var b=document.getElementById('themeBtn');if(b)b.textContent=t==='dark'?'🌙':'☀️';})();
function toggleTheme(){var cur=document.documentElement.getAttribute('data-theme');var next=cur==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',next);localStorage.setItem('theme',next);document.getElementById('themeBtn').textContent=next==='dark'?'🌙':'☀️';}

function $(id){return document.getElementById(id);}
function badge(t){return '<span class="badge '+(t==='ipv4'?'b4':'b6')+'">'+t.toUpperCase()+'</span>';}
function item(l,v){return '<div class="item"><div class="item-l">'+l+'</div><div class="item-v">'+(v||'\\u2014')+'</div></div>';}
function itemM(l,v){return '<div class="item"><div class="item-l">'+l+'</div><div class="item-v mono">'+(v||'\\u2014')+'</div></div>';}

function initGlobe(){
  var el=$('globe');if(!el)return;if(globe)el.innerHTML='';
  globe=Globe()(el)
    .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
    .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
    .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
    .showAtmosphere(true).atmosphereColor('#3b82f6').atmosphereAltitude(0.25)
    .pointAltitude(0.06).pointRadius(0.5).pointColor(function(){return '#00ff88';})
    .pointsData([])
    .htmlElementsData([]).htmlLat('lat').htmlLng('lng')
    .htmlElement(function(d){
      var el=document.createElement('div');
      el.style.cssText='transform:translate(-50%,-100%);pointer-events:none;';
      el.innerHTML='<div style="background:linear-gradient(135deg,rgba(59,130,246,.9),rgba(139,92,246,.9));padding:6px 12px;border-radius:8px;color:#fff;font-size:11px;font-weight:600;white-space:nowrap;box-shadow:0 0 12px rgba(59,130,246,.4);">'+(d.label||'')+'<div style="font-size:9px;opacity:.8;font-family:monospace;">'+(d.ip||'')+'</div></div>';
      return el;
    })
    .ringsData([]).ringLat('lat').ringLng('lng')
    .ringColor(function(t){return 'rgba(0,255,136,'+((1-t)*0.6)+')';})
    .ringMaxRadius(3).ringPropagationSpeed(2).ringRepeatPeriod(1000)
    .width(el.clientWidth).height(el.clientHeight);
  globe.controls().autoRotate=false;globe.controls().enableZoom=true;
}

function showGlobe(lat,lng,label,ip){
  if(!globe)return;
  var pt={lat:parseFloat(lat)||0,lng:parseFloat(lng)||0,label:label||'',ip:ip||''};
  globe.pointsData([pt]);globe.htmlElementsData([pt]);globe.ringsData([pt]);
  globe.pointOfView({lat:pt.lat,lng:pt.lng,altitude:0.9},1500);
}

function showResults(d){
  var el=$('results');
  if(!el)return;
  if(d.error){el.innerHTML='<div class="card err">'+d.error+'</div>';return;}
  var g=d.geolocation||{};var g4=g.ipv4||null;var g6=g.ipv6||null;
  var h='<div class="globe" id="globe"></div>';
  h+='<div class="card"><div class="card-t"><span class="dot"></span>'+d.target+'</div><div style="display:flex;gap:12px;flex-wrap:wrap;">';
  if(g4)h+='<div class="ip">'+(g4.ip||g4.ip_address||'')+badge('ipv4')+'</div>';
  if(g6)h+='<div class="ip" style="color:var(--accent2)">'+(g6.ip||g6.ip_address||'')+badge('ipv6')+'</div>';
  if(!g4&&!g6)h+='<div style="color:var(--muted);">\\u2014</div>';
  h+='</div></div>';
  if(d.dns){
    h+='<div class="card"><div class="card-t"><span class="dot"></span>DNS 记录</div><div class="dns">';
    if(d.dns.a&&d.dns.a.length)h+='<div><span class="dns-t">A</span>'+d.dns.a.join(', ')+'</div>';
    if(d.dns.aaaa&&d.dns.aaaa.length)h+='<div><span class="dns-t">AAAA</span>'+d.dns.aaaa.join(', ')+'</div>';
    if((!d.dns.a||!d.dns.a.length)&&(!d.dns.aaaa||!d.dns.aaaa.length))h+='<div style="color:var(--muted);">\\u65e0\\u8bb0\\u5f55</div>';
    h+='</div></div>';
  }
  if(g4||g6){h+='<div class="row">';if(g4)h+=geoCard(g4,'ipv4');if(g6)h+=geoCard(g6,'ipv6');h+='</div>';}
  el.innerHTML=h;
  setTimeout(function(){initGlobe();var gp=g4||g6;if(gp&&gp.latitude)showGlobe(gp.latitude,gp.longitude,(gp.city||'')+', '+(gp.country||''),gp.ip||'');},200);
}

function geoCard(geo,ver){
  var h='<div class="card"><div class="card-t"><span class="dot"></span>'+ver.toUpperCase()+'</div><div class="grid">';
  h+=itemM('IP',geo.ip||geo.ip_address);
  h+=item('Country',geo.country);h+=item('Region',geo.region);h+=item('City',geo.city);
  h+=item('Colo',geo.colo);h+=item('AS','AS'+geo.asn);
  h+=itemM('Lat',geo.latitude);h+=itemM('Lon',geo.longitude);
  h+='</div></div>';return h;
}

function showLoading(m){var el=$('results');if(el)el.innerHTML='<div class="loading"><div class="spinner"></div>'+m+'</div>';}

// ─── Visitor: dual-stack via radar endpoints ───
async function fetchRadar(t){
  try{var r=await fetch('/api/radar?ip='+t+'&_t='+Date.now());if(!r.ok)return null;return await r.json();}catch(e){return null;}
}

async function loadVisitor(){
  showLoading('Detecting your IP...');
  try{
    var ipv4=await fetchRadar('ipv4');
    var ipv6=await fetchRadar('ipv6');
    var primary=ipv4||ipv6;
    if(primary)$('q').value=primary.ip_address||'';
    var d={target:(primary?primary.ip_address:'unknown'),type:'dual',geolocation:{}};
    if(ipv4)d.geolocation.ipv4=ipv4;
    if(ipv6)d.geolocation.ipv6=ipv6;
    showResults(d);
    showMeta(ipv4,ipv6);
  }catch(e){
    $('results').innerHTML='<div class="card err">'+e.message+'</div>';
  }
}

function showMeta(v4,v6){
  var h='<div class="card meta"><div class="card-t"><span class="dot"></span>Visitor Info</div><div class="grid">';
  if(v4){
    h+=itemM('IPv4',v4.ip_address);
    h+=item('AS','AS'+v4.asn);h+=item('Org',v4.asOrganization);
    h+=item('Country',v4.country);h+=item('City',v4.city);
    h+=item('Colo',v4.colo);
  }
  if(v6){
    h+=itemM('IPv6',v6.ip_address);
    h+=item('AS','AS'+v6.asn);h+=item('Org',v6.asOrganization);
    h+=item('Country',v6.country);h+=item('City',v6.city);
    h+=item('Colo',v6.colo);
  }
  if(!v4&&!v6)h+='<div style="color:var(--muted);">\\u65e0\\u6570\\u636e</div>';
  h+='</div></div>';
  $('metaBox').innerHTML=h;
}

// ─── Lookup ───
async function doLookup(){
  var input=$('q').value.trim();if(!input)return;
  $('btn').disabled=true;showLoading('Querying '+input+' ...');
  try{
    var r=await fetch('/api/lookup?target='+encodeURIComponent(input)+'&_t='+Date.now());
    var data=await r.json();
    showResults(data);
    var ipv4=await fetchRadar('ipv4');
    var ipv6=await fetchRadar('ipv6');
    showMeta(ipv4,ipv6);
  }catch(e){
    var el=$('results');if(el)el.innerHTML='<div class="card err">'+e.message+'</div>';
  }finally{
    $('btn').disabled=false;
  }
}

loadVisitor();
</script>
</body>
</html>`;
