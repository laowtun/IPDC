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

    // ─── 访客信息 (Cloudflare request.cf) ───
    if (url.pathname === '/api/visitor') {
      const cf = (request as any).cf || {};
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      return Response.json({
        ip,
        country: cf.country || '',
        country_code: cf.countryCode || '',
        city: cf.city || '',
        region: cf.region || '',
        postal: cf.postalCode || '',
        latitude: cf.latitude || '',
        longitude: cf.longitude || '',
        timezone: cf.timezone || '',
        asn: cf.asn || '',
        as_org: cf.asOrganization || '',
        colo: cf.colo || '',
      }, { headers: corsHeaders });
    }

    // ─── DNS 查询 ───
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
          const [g4, g6] = await Promise.all([
            a[0] ? lookupIP(a[0]) : null,
            aaaa[0] ? lookupIP(aaaa[0]) : null,
          ]);
          if (g4 || g6) {
            result.geolocation = {};
            if (g4) { result.geolocation.ipv4 = g4; result.resolved_ip = a[0]; }
            if (g6) { result.geolocation.ipv6 = g6; if (!result.resolved_ip) result.resolved_ip = aaaa[0]; }
          } else {
            result.error = 'No DNS records';
          }
        } else {
          const geo = await lookupIP(target);
          if (geo) {
            result.geolocation = {};
            result.geolocation[result.type] = geo;
          }
        }
        return Response.json(result, { headers: corsHeaders });
      } catch (e: any) {
        return Response.json({ error: e?.message }, { status: 500, headers: corsHeaders });
      }
    }

    return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_CACHE } });
  },
};

async function resolveDNS(name: string, type: string): Promise<string[]> {
  try {
    const res = await fetch(`${DOH_URL}?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { 'Accept': 'application/dns-json' },
      signal: AbortSignal.timeout(5000),
    });
    const data: any = await res.json();
    if (!data.Answer) return [];
    return data.Answer
      .filter((r: any) => r.type === (type === 'A' ? 1 : type === 'AAAA' ? 28 : 12))
      .map((r: any) => r.data);
  } catch {
    return [];
  }
}

async function lookupIP(ip: string): Promise<any | null> {
  try {
    const res = await fetch(`https://ipinfo.io/${ip}/json`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const d: any = await res.json();
    if (d.error) return null;
    const [lat, lon] = (d.loc || ',').split(',');
    return {
      ip: d.ip,
      country: d.country,
      region: d.region,
      city: d.city,
      postal: d.postal,
      latitude: lat || '',
      longitude: lon || '',
      timezone: d.timezone || '',
      org: d.org || '',
    };
  } catch {
    return null;
  }
}

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>IPDC - IP Lookup</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌐</text></svg>">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f23;color:#e2e8f0;min-height:100vh;}
.wrap{max-width:900px;margin:0 auto;padding:32px 16px;}
h1{text-align:center;font-size:2em;margin-bottom:8px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.sub{text-align:center;color:#94a3b8;margin-bottom:24px;}
.search{display:flex;gap:10px;margin-bottom:24px;}
.search input{flex:1;padding:12px 16px;border-radius:10px;border:1px solid #1e293b;background:#111827;color:#e2e8f0;font-size:1em;outline:none;}
.search input:focus{border-color:#3b82f6;}
.search button{padding:12px 20px;border-radius:10px;border:none;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;font-weight:600;cursor:pointer;}
.card{background:#111827;border:1px solid #1e293b;border-radius:14px;padding:18px;margin-bottom:14px;}
.card-t{font-size:.78em;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:12px;}
.dot{width:7px;height:7px;border-radius:50%;background:#22c55e;display:inline-block;margin-right:6px;}
.ip{font-size:1.5em;font-weight:700;font-family:monospace;color:#3b82f6;}
.badge{display:inline-block;padding:2px 8px;border-radius:5px;font-size:.5em;font-weight:600;text-transform:uppercase;vertical-align:middle;margin-left:8px;}
.b4{background:rgba(59,130,246,.15);color:#3b82f6;}
.b6{background:rgba(139,92,246,.15);color:#8b5cf6;}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;}
.item{padding:8px 12px;background:rgba(255,255,255,.03);border-radius:8px;}
.item-l{font-size:.7em;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;}
.item-v{font-size:.9em;font-weight:500;}
.mono{font-family:monospace;font-size:.85em;}
.dns{font-family:monospace;font-size:.85em;line-height:2;}
.dns-t{color:#8b5cf6;font-weight:600;margin-right:4px;}
.globe{width:100%;height:350px;border-radius:10px;overflow:hidden;background:#000;margin-bottom:14px;}
.loading{text-align:center;padding:30px;color:#94a3b8;}
.spinner{width:24px;height:24px;border:3px solid #1e293b;border-top-color:#3b82f6;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 8px;}
@keyframes spin{to{transform:rotate(360deg);}}
.meta{border-left:3px solid #3b82f6;}
.row{display:flex;gap:14px;flex-wrap:wrap;}
.row>.card{flex:1;min-width:260px;}
.foot{text-align:center;margin-top:28px;color:#64748b;font-size:.8em;border-top:1px solid #1e293b;padding-top:14px;}
.err{text-align:center;color:#ef4444;}
@media(max-width:600px){.search{flex-direction:column;}.row{flex-direction:column;}}
</style>
</head>
<body>
<div class="wrap">
  <h1>IPDC</h1>
  <p class="sub">IPv4/IPv6 双栈查询 — 地理位置、ISP、DNS 解析</p>
  <div class="search">
    <input type="text" id="q" placeholder="输入 IP 或域名，例如 8.8.8.8 / google.com" onkeydown="if(event.key==='Enter')doLookup()">
    <button onclick="doLookup()" id="btn">🔍 查询</button>
  </div>
  <div id="results"></div>
  <div id="metaBox"></div>
  <div class="foot">Powered by Cloudflare Workers + Cloudflare Radar + DNS-over-HTTPS + globe.gl</div>
</div>
<script src="https://unpkg.com/globe.gl@2.35.1/dist/globe.gl.min.js"></script>
<script>
var globe=null;
function $(id){return document.getElementById(id);}

function badge(t){return '<span class="badge '+(t==='ipv4'?'b4':'b6')+'">'+t.toUpperCase()+'</span>';}
function item(l,v){return '<div class="item"><div class="item-l">'+l+'</div><div class="item-v">'+(v||'\u2014')+'</div></div>';}
function itemM(l,v){return '<div class="item"><div class="item-l">'+l+'</div><div class="item-v mono">'+(v||'\u2014')+'</div></div>';}

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
  if(d.error){el.innerHTML='<div class="card err">'+d.error+'</div>';return;}
  var g=d.geolocation;var g4=g?g.ipv4:null;var g6=g?g.ipv6:null;
  var h='<div class="globe" id="globe"></div>';
  h+='<div class="card"><div class="card-t"><span class="dot"></span>'+d.target+'</div><div style="display:flex;gap:12px;flex-wrap:wrap;">';
  if(g4)h+='<div class="ip">'+(g4.ip_address||g4.ip)+badge('ipv4')+'</div>';
  if(g6)h+='<div class="ip" style="color:#8b5cf6">'+(g6.ip_address||g6.ip)+badge('ipv6')+'</div>';
  h+='</div></div>';
  if(d.dns){
    h+='<div class="card"><div class="card-t"><span class="dot"></span>DNS 记录</div><div class="dns">';
    if(d.dns.a&&d.dns.a.length)h+='<div><span class="dns-t">A</span>'+d.dns.a.join(', ')+'</div>';
    if(d.dns.aaaa&&d.dns.aaaa.length)h+='<div><span class="dns-t">AAAA</span>'+d.dns.aaaa.join(', ')+'</div>';
    h+='</div></div>';
  }
  if(g4||g6){h+='<div class="row">';if(g4)h+=geoCard(g4,'ipv4');if(g6)h+=geoCard(g6,'ipv6');h+='</div>';}
  el.innerHTML=h;
  setTimeout(function(){initGlobe();var gp=g4||g6;if(gp&&gp.latitude)showGlobe(gp.latitude,gp.longitude,(gp.city||'')+', '+(gp.country||''),gp.ip_address||gp.ip);},200);
}

function geoCard(geo,ver){
  var h='<div class="card"><div class="card-t"><span class="dot"></span>'+ver.toUpperCase()+'</div><div class="grid">';
  h+=itemM('IP',geo.ip_address||geo.ip);
  h+=item('国家',geo.country);h+=item('地区',geo.region);h+=item('城市',geo.city);
  h+=item('数据中心',geo.colo);h+=item('AS','AS'+geo.asn);
  h+=itemM('纬度',geo.latitude);h+=itemM('经度',geo.longitude);
  h+='</div></div>';return h;
}

function showLoading(m){$('results').innerHTML='<div class="loading"><div class="spinner"></div>'+m+'</div>';}

// ─── 访客信息 (从 request.cf 获取) ───
async function loadVisitor(){
  showLoading('检测你的 IP 信息...');
  try{
    var r=await fetch('/api/visitor?_t='+Date.now());
    var vis=await r.json();
    if(vis.ip&&vis.ip!=='unknown'){
      $('q').value=vis.ip;
      var d={target:vis.ip,type:vis.ip.indexOf(':')>=0?'ipv6':'ipv4',geolocation:{}};
      d.geolocation[d.type]={
        ip:vis.ip, country:vis.country, region:vis.region, city:vis.city,
        latitude:vis.latitude, longitude:vis.longitude, asn:vis.asn, org:vis.as_org, colo:vis.colo
      };
      showResults(d);
      // 显示访客信息
      showMeta(vis);
    }else{
      $('results').innerHTML='<div class="card err">无法获取 IP</div>';
    }
  }catch(e){
    $('results').innerHTML='<div class="card err">'+e.message+'</div>';
  }
}

// ─── 显示访客信息 ───
function showMeta(vis){
  var h='<div class="card meta"><div class="card-t"><span class="dot"></span>访客信息 (Cloudflare)</div><div class="grid">';
  h+=itemM('IP',vis.ip);
  h+=item('AS','AS'+vis.asn);
  h+=item('运营商',vis.as_org);
  h+=item('国家',vis.country);
  h+=item('城市',vis.city);
  h+=item('地区',vis.region);
  h+=item('邮编',vis.postal);
  h+=item('时区',vis.timezone);
  h+=itemM('纬度',vis.latitude);
  h+=itemM('经度',vis.longitude);
  h+=item('数据中心',vis.colo);
  h+='</div></div>';
  $('metaBox').innerHTML=h;
}

// ─── IP/域名查询 ───
async function doLookup(){
  var input=$('q').value.trim();if(!input)return;
  $('btn').disabled=true;showLoading('查询 '+input+' ...');
  try{
    var r=await fetch('/api/lookup?target='+encodeURIComponent(input)+'&_t='+Date.now());
    var data=await r.json();
    showResults(data);
    // 查询后也更新访客信息
    var vr=await fetch('/api/visitor?_t='+Date.now());
    var vis=await vr.json();
    if(vis.ip)showMeta(vis);
  }catch(e){
    $('results').innerHTML='<div class="card err">'+e.message+'</div>';
  }finally{
    $('btn').disabled=false;
  }
}

loadVisitor();
</script>
</body>
</html>`;
