interface Env {}

const DOH_URL = 'https://1.1.1.1/dns-query';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // ─── API: visitor fallback ───
    if (url.pathname === '/api/visitor') {
      const cf = (request as any).cf || {};
      const ip = request.headers.get('cf-connecting-ip')
        || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || 'unknown';
      return Response.json({
        ip, country: cf.country||'', country_code: cf.countryCode||'',
        region: cf.region||'', city: cf.city||'', postal: cf.postalCode||'',
        latitude: cf.latitude||'', longitude: cf.longitude||'',
        timezone: cf.timezone||'', asn: cf.asn||'', as_org: cf.asOrganization||'',
      }, { headers: corsHeaders });
    }

    // ─── API: speed.cloudflare.com/meta ───
    if (url.pathname === '/api/meta') {
      try {
        const res = await fetch('https://speed.cloudflare.com/meta', {
          headers: { 'Referer': 'https://speed.cloudflare.com/', 'Origin': 'https://speed.cloudflare.com' },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return Response.json({ error: 'speed.cloudflare.com returned ' + res.status }, { status: 502, headers: corsHeaders });
        const data = await res.json();
        return Response.json(data, { headers: corsHeaders });
      } catch(e: any) {
        return Response.json({ error: e?.message || 'Failed' }, { status: 500, headers: corsHeaders });
      }
    }

    // ─── API: lookup IP or domain ───
    if (url.pathname === '/api/lookup') {
      const target = url.searchParams.get('target')?.trim();
      if (!target) return Response.json({ error: 'Missing target' }, { status: 400, headers: corsHeaders });
      try {
        const isIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(target);
        const isIPv6 = target.includes(':') && !target.includes('.');
        const isDomain = !isIPv4 && !isIPv6;
        const result: any = { target, type: isDomain?'domain':(isIPv6?'ipv6':'ipv4') };

        if (isDomain) {
          const [a, aaaa] = await Promise.all([resolveDNS(target,'A'), resolveDNS(target,'AAAA')]);
          result.dns = { a, aaaa };
          const [g4, g6] = await Promise.all([
            a[0] ? lookupIP(a[0]) : null,
            aaaa[0] ? lookupIP(aaaa[0]) : null,
          ]);
          if (g4||g6) {
            result.geolocation = {};
            if (g4) { result.geolocation.ipv4 = g4; result.resolved_ip = a[0]; }
            if (g6) { result.geolocation.ipv6 = g6; if(!result.resolved_ip) result.resolved_ip = aaaa[0]; }
          } else { result.error = 'No DNS records'; }
        } else {
          const geo = await lookupIP(target);
          if (geo) { result.geolocation = {}; result.geolocation[result.type] = geo; }
          let ptr = '';
          if (isIPv4) ptr = target.split('.').reverse().join('.')+'.in-addr.arpa';
          else if (isIPv6) ptr = target.replace(/:/g,'').split('').reverse().join('.')+'.ip6.arpa';
          if (ptr) { const r = await resolveDNS(ptr,'PTR').catch(()=>[]); if(r.length) result.reverse_dns = r; }
        }
        return Response.json(result, { headers: corsHeaders });
      } catch(e:any) { return Response.json({ error: e?.message }, { status: 500, headers: corsHeaders }); }
    }

    return new Response(HTML, { headers: { 'Content-Type':'text/html; charset=utf-8' } });
  },
};

async function resolveDNS(name: string, type: string): Promise<string[]> {
  try {
    const res = await fetch(`${DOH_URL}?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { 'Accept':'application/dns-json' }, signal: AbortSignal.timeout(5000),
    });
    const data: any = await res.json();
    if (!data.Answer) return [];
    return data.Answer.filter((r:any)=>r.type===(type==='A'?1:type==='AAAA'?28:12)).map((r:any)=>r.data);
  } catch { return []; }
}

async function lookupIP(ip: string): Promise<any|null> {
  try {
    const res = await fetch(`https://ipinfo.io/${ip}/json`, {
      headers: { 'Accept':'application/json' }, signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const d: any = await res.json();
    if (d.error) return null;
    const [lat,lon] = (d.loc||',').split(',');
    return { ip:d.ip, country:d.country, region:d.region, city:d.city, postal:d.postal,
      latitude:lat||'', longitude:lon||'', timezone:d.timezone||'', org:d.org||'' };
  } catch { return null; }
}

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>IPDC - IP Lookup Tool</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌐</text></svg>">
<style>
:root{--bg:rgba(245,245,247,0.72);--card:rgba(255,255,255,0.72);--card-solid:#fff;--border:rgba(0,0,0,0.08);--text:#1d1d1f;--muted:#86868b;--accent:#0071e3;--accent2:#5856d6;--green:#34c759;--red:#ff3b30;--blur:20px;--shadow:0 8px 32px rgba(0,0,0,0.08);}
[data-theme="dark"]{--bg:rgba(10,14,23,0.72);--card:rgba(17,24,39,0.72);--card-solid:#111827;--border:rgba(255,255,255,0.08);--text:#e2e8f0;--muted:#94a3b8;--accent:#3b82f6;--accent2:#8b5cf6;--green:#22c55e;--red:#ef4444;--shadow:0 8px 32px rgba(0,0,0,0.3);}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;line-height:1.6;backdrop-filter:blur(var(--blur));-webkit-backdrop-filter:blur(var(--blur));transition:background .3s,color .3s;}
.container{max-width:960px;margin:0 auto;padding:32px 16px;}
.header{text-align:center;margin-bottom:32px;position:relative;}
.header h1{font-size:2.2em;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:6px;font-weight:700;}
.header p{color:var(--muted);font-size:1em;}
.theme-toggle{position:absolute;top:0;right:0;width:40px;height:40px;border-radius:50%;border:1px solid var(--border);background:var(--card);backdrop-filter:blur(10px);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1.2em;transition:all .3s;box-shadow:var(--shadow);}
.theme-toggle:hover{transform:scale(1.1);}
.search-box{display:flex;gap:10px;margin-bottom:28px;}
.search-box input{flex:1;padding:14px 20px;border-radius:12px;border:1px solid var(--border);background:var(--card);backdrop-filter:blur(var(--blur));color:var(--text);font-size:1em;outline:none;transition:all .3s;box-shadow:var(--shadow);}
.search-box input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(59,130,246,0.15);}
.search-box input::placeholder{color:var(--muted);}
.search-box button{padding:14px 28px;border-radius:12px;border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-size:1em;font-weight:600;cursor:pointer;transition:all .3s;box-shadow:var(--shadow);}
.search-box button:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(59,130,246,0.3);}
.card{background:var(--card);backdrop-filter:blur(var(--blur));-webkit-backdrop-filter:blur(var(--blur));border:1px solid var(--border);border-radius:16px;padding:20px;margin-bottom:16px;box-shadow:var(--shadow);transition:all .3s;}
.card-title{font-size:.8em;text-transform:uppercase;letter-spacing:1.2px;color:var(--muted);margin-bottom:14px;display:flex;align-items:center;gap:7px;}
.dot{width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block;}
.ip-display{font-size:1.6em;font-weight:700;font-family:'SF Mono','Cascadia Code',monospace;color:var(--accent);word-break:break-all;}
.ip-type-badge{display:inline-block;padding:2px 8px;border-radius:5px;font-size:.5em;font-weight:600;text-transform:uppercase;vertical-align:middle;margin-left:10px;}
.badge-ipv4{background:rgba(59,130,246,.15);color:var(--accent);}
.badge-ipv6{background:rgba(139,92,246,.15);color:var(--accent2);}
.info-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;}
.info-item{padding:10px 14px;background:rgba(255,255,255,.03);border-radius:10px;border:1px solid rgba(255,255,255,.05);transition:all .3s;}
[data-theme="dark"] .info-item{background:rgba(255,255,255,.03);}
.info-label{font-size:.72em;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;}
.info-value{font-size:.95em;font-weight:500;word-break:break-all;}
.info-value.mono{font-family:'SF Mono',monospace;font-size:.88em;}
.dns-records{font-family:'SF Mono',monospace;font-size:.85em;line-height:2;}
.dns-type{color:var(--accent2);font-weight:600;margin-right:6px;}
#globe-container{width:100%;height:380px;border-radius:12px;overflow:hidden;background:#000;}
.loading{text-align:center;padding:36px;color:var(--muted);}
.spinner{width:28px;height:28px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 10px;}
@keyframes spin{to{transform:rotate(360deg);}}
.error-msg{text-align:center;padding:20px;color:var(--red);}
.footer{text-align:center;margin-top:32px;padding-top:16px;border-top:1px solid var(--border);color:var(--muted);font-size:.8em;}
.dual-row{display:flex;gap:16px;flex-wrap:wrap;}
.dual-row>.card{flex:1;min-width:280px;}
.meta-card{border-left:3px solid var(--accent);}
@media(max-width:600px){.search-box{flex-direction:column;}.header h1{font-size:1.5em;}.ip-display{font-size:1.2em;}.info-grid{grid-template-columns:1fr;}#globe-container{height:260px;}.dual-row{flex-direction:column;}.theme-toggle{top:-40px;}}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <button class="theme-toggle" onclick="toggleTheme()" id="themeBtn">🌙</button>
    <h1>IPDC</h1>
    <p>IPv4/IPv6 双栈查询 — 地理位置、ISP、DNS 解析、3D 地球定位</p>
  </div>
  <div class="search-box">
    <input type="text" id="q" placeholder="输入 IP 或域名，例如 8.8.8.8 / google.com" onkeydown="if(event.key==='Enter')doLookup()">
    <button onclick="doLookup()" id="btn">🔍 查询</button>
  </div>
  <div id="results"></div>
  <div id="metaSection"></div>
  <div class="footer">Powered by Cloudflare Workers + Cloudflare Radar + DNS-over-HTTPS + globe.gl</div>
</div>
<script>
// ─── Theme ───
const savedTheme=localStorage.getItem('theme')||'dark';
document.documentElement.setAttribute('data-theme',savedTheme);
function toggleTheme(){
  const cur=document.documentElement.getAttribute('data-theme');
  const next=cur==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',next);
  localStorage.setItem('theme',next);
  $('themeBtn').textContent=next==='dark'?'🌙':'☀️';
}
$('themeBtn').textContent=savedTheme==='dark'?'🌙':'☀️';

// ─── Helpers ───
const \$=id=>document.getElementById(id);
let globe=null;
let globeLoaded=false;

function badge(t){const m={ipv4:['IPv4','badge-ipv4'],ipv6:['IPv6','badge-ipv6'],domain:['域名','badge-ipv6']};const[l,c]=m[t]||m.domain;return'<span class="ip-type-badge '+c+'">'+l+'</span>';}
function info(l,v,m){return'<div class="info-item"><div class="info-label">'+l+'</div><div class="info-value'+(m?' mono':'')+'">'+(v||'—')+'</div></div>';}

// ─── Lazy load Globe.gl ───
function loadGlobeScript(){
  if(globeLoaded)return Promise.resolve();
  return new Promise((resolve)=>{
    const s=document.createElement('script');
    s.src='https://unpkg.com/globe.gl@2.35.1/dist/globe.gl.min.js';
    s.onload=()=>{globeLoaded=true;resolve();};
    s.onerror=resolve;
    document.head.appendChild(s);
  });
}

// ─── 3D Globe ───
async function initGlobe(){
  await loadGlobeScript();
  if(typeof Globe==='undefined')return;
  const el=\$('globe-container');if(!el)return;if(globe)el.innerHTML='';
  globe=Globe()(el)
    .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
    .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
    .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
    .showAtmosphere(true).atmosphereColor('#3b82f6').atmosphereAltitude(0.25)
    .pointAltitude(0.06).pointRadius(0.6).pointColor(()=>'#00ff88')
    .pointsData([])
    .htmlElementsData([]).htmlLat('lat').htmlLng('lng')
    .htmlElement(d=>{const el=document.createElement('div');el.style.cssText='transform:translate(-50%,-100%);pointer-events:none;';el.innerHTML='<div style="text-align:center;"><div style="background:linear-gradient(135deg,rgba(59,130,246,.95),rgba(139,92,246,.95));padding:7px 14px;border-radius:9px;color:#fff;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 0 16px rgba(59,130,246,.5);border:1px solid rgba(255,255,255,.2);">'+(d.label||'')+'<div style="font-size:10px;opacity:.8;font-family:monospace;">'+(d.ip||'')+'</div></div><div style="width:2px;height:16px;background:linear-gradient(to bottom,rgba(0,255,136,.7),transparent);margin:0 auto;"></div></div>';return el;})
    .ringsData([]).ringLat('lat').ringLng('lng')
    .ringColor(t=>'rgba(0,255,136,'+((1-t)*0.6)+')')
    .ringMaxRadius(4).ringPropagationSpeed(2).ringRepeatPeriod(1000)
    .width(el.clientWidth).height(el.clientHeight);
  globe.controls().autoRotate=false;globe.controls().enableZoom=true;
  globe.controls().minDistance=100;globe.controls().maxDistance=500;
  window.addEventListener('resize',()=>{if(globe&&el.clientWidth>0)globe.width(el.clientWidth).height(el.clientHeight);});
}
function showGlobePoint(lat,lng,label,ip){
  if(!globe)initGlobe();if(!globe)return;
  const pt={lat:parseFloat(lat)||0,lng:parseFloat(lng)||0,label:label||'',ip:ip||''};
  globe.pointsData([pt]);globe.htmlElementsData([pt]);globe.ringsData([pt]);
  globe.pointOfView({lat:pt.lat,lng:pt.lng,altitude:0.9},1500);
  globe.controls().autoRotate=false;
}

// ─── Render geo card ───
function renderGeo(geo,ver){
  if(!geo)return'';
  let h='<div class="card"><div class="card-title"><span class="dot"></span>'+badge(ver)+' 信息</div>';
  h+='<div class="info-grid">';
  h+=info('IP',geo.ip_address||geo.ip,true);
  h+=info('国家',geo.country);
  h+=info('地区',geo.region);
  h+=info('城市',geo.city);
  h+=info('数据中心',geo.colo);
  h+=info('AS',geo.asn?'AS'+geo.asn:(geo.org||''));
  h+=info('纬度',geo.latitude,true);
  h+=info('经度',geo.longitude,true);
  h+='</div></div>';
  return h;
}

function showResults(data){
  const el=\$('results');
  if(data.error){el.innerHTML='<div class="card error-msg">❌ '+data.error+'</div>';return;}
  const g=data.geolocation;const g4=g?.ipv4,g6=g?.ipv6;
  let h='';
  h+='<div class="card" style="padding:0;overflow:hidden;"><div id="globe-container"></div></div>';
  h+='<div class="card"><div class="card-title"><span class="dot"></span>'+data.target+'</div><div style="display:flex;gap:14px;flex-wrap:wrap;">';
  if(g4)h+='<div class="ip-display" style="font-size:1.2em;">'+(g4.ip_address||g4.ip)+badge('ipv4')+'</div>';
  if(g6)h+='<div class="ip-display" style="font-size:1.2em;color:var(--accent2);">'+(g6.ip_address||g6.ip)+badge('ipv6')+'</div>';
  if(!g4&&!g6)h+='<div style="color:var(--muted);">未找到</div>';
  h+='</div></div>';
  if(data.dns){
    h+='<div class="card"><div class="card-title">DNS 记录</div><div class="dns-records">';
    if(data.dns.a?.length)h+='<div><span class="dns-type">A</span>'+data.dns.a.join(', ')+'</div>';
    if(data.dns.aaaa?.length)h+='<div><span class="dns-type">AAAA</span>'+data.dns.aaaa.join(', ')+'</div>';
    if(!data.dns.a?.length&&!data.dns.aaaa?.length)h+='<div style="color:var(--muted);">无记录</div>';
    h+='</div></div>';
  }
  if(data.reverse_dns?.length)h+='<div class="card"><div class="card-title">反向 DNS</div><div class="dns-records"><span class="dns-type">PTR</span>'+data.reverse_dns.join(', ')+'</div></div>';
  if(g4||g6){h+='<div class="dual-row">';if(g4)h+=renderGeo(g4,'ipv4');if(g6)h+=renderGeo(g6,'ipv6');h+='</div>';}
  el.innerHTML=h;
  setTimeout(async()=>{
    await initGlobe();
    const gp=g4||g6;
    if(gp&&(gp.latitude||gp.longitude)){
      const city=gp.city||'';const country=gp.country||'';
      showGlobePoint(gp.latitude,gp.longitude,city+(city&&country?', ':'')+country,gp.ip_address||gp.ip);
    }
  },100);
}

function showLoading(m){\$('results').innerHTML='<div class="loading"><div class="spinner"></div>'+(m||'查询中...')+'</div>';}

// ─── Speed.cloudflare.com/meta ───
async function loadMeta(){
  try{
    const r=await fetch('/api/meta');
    if(!r.ok)return;
    const d=await r.json();
    if(!d||d.error)return;
    let h='<div class="card meta-card"><div class="card-title"><span class="dot"></span>Speed.cloudflare.com/meta</div>';
    h+='<div class="info-grid">';
    h+=info('客户端 IP',d.clientIp,true);
    h+=info('协议',d.httpProtocol);
    h+=info('AS 编号','AS'+d.asn,true);
    h+=info('运营商',d.asOrganization);
    h+=info('国家',d.country);
    h+=info('城市',d.city);
    h+=info('地区',d.region);
    h+=info('邮编',d.postalCode);
    h+=info('时区',d.timezone);
    h+=info('纬度',d.latitude,true);
    h+=info('经度',d.longitude,true);
    h+=info('数据中心',d.colo?.iata||'');
    h+='</div></div>';
    \$('metaSection').innerHTML=h;
  }catch{}
}

// ─── Cloudflare Radar ───
async function fetchRadar(type){
  const url=type==='ipv4'?'https://ipv4-check-perf.radar.cloudflare.com/':'https://ipv6-check-perf.radar.cloudflare.com/';
  try{const r=await fetch(url,{headers:{'Accept':'application/json'}});if(!r.ok)return null;return await r.json();}catch{return null;}
}

// ─── Auto-detect visitor ───
async function loadVisitor(){
  showLoading('检测你的 IP 信息...');
  loadMeta();
  try{
    const[ipv4,ipv6]=await Promise.all([fetchRadar('ipv4'),fetchRadar('ipv6')]);
    const primary=ipv4||ipv6;
    if(primary)\$('q').value=primary.ip_address;
    if(!ipv4&&!ipv6){
      const vis=await(await fetch('/api/visitor')).json();
      if(vis.ip&&vis.ip!=='unknown'){
        \$('q').value=vis.ip;
        const data={target:vis.ip,type:vis.ip.includes(':')?'ipv6':'ipv4',geolocation:{}};
        const ver=data.type;
        data.geolocation[ver]={ip:vis.ip,country:vis.country,region:vis.region,city:vis.city,
          latitude:vis.latitude,longitude:vis.longitude,asn:vis.asn,org:vis.as_org,colo:''};
        showResults(data);
      }else{\$('results').innerHTML='<div class="card error-msg">无法获取 IP</div>';}
      return;
    }
    const data={target:primary.ip_address,type:'dual',geolocation:{}};
    if(ipv4)data.geolocation.ipv4=ipv4;
    if(ipv6)data.geolocation.ipv6=ipv6;
    showResults(data);
  }catch(e){\$('results').innerHTML='<div class="card error-msg">❌ '+e.message+'</div>';}
}

// ─── Domain/IP lookup ───
async function doLookup(){
  const input=\$('q').value.trim();if(!input)return;
  \$('btn').disabled=true;showLoading('查询 '+input+' ...');
  try{
    const r=await fetch('/api/lookup?target='+encodeURIComponent(input));
    const data=await r.json();
    if(data.geolocation){
      const ver=data.type;
      if(ver==='ipv4'||ver==='ipv6'){
        const radar=await fetchRadar(ver);
        if(radar)data.geolocation[ver]={...data.geolocation[ver],...radar,colo:radar.colo||data.geolocation[ver]?.colo};
      }
    }
    showResults(data);
  }catch(e){\$('results').innerHTML='<div class="card error-msg">❌ '+e.message+'</div>';}
  finally{\$('btn').disabled=false;}
}

loadVisitor();
</script>
</body>
</html>`;
