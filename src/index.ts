interface Env {}

const DOH_URL = 'https://1.1.1.1/dns-query';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ─── API: visitor info (Cloudflare built-in, zero external calls) ───
    if (url.pathname === '/api/visitor') {
      const cf = (request as any).cf || {};
      const ip = request.headers.get('cf-connecting-ip')
        || request.headers.get('x-real-ip')
        || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || 'unknown';
      return Response.json({
        ip,
        country: cf.country || '',
        country_code: cf.countryCode || '',
        region: cf.region || '',
        city: cf.city || '',
        postal: cf.postalCode || '',
        latitude: cf.latitude || '',
        longitude: cf.longitude || '',
        timezone: cf.timezone || '',
        asn: cf.asn || '',
        as_org: cf.asOrganization || '',
        colo: cf.colo || '',
      }, { headers: corsHeaders });
    }

    // ─── API: lookup IP or domain ───
    if (url.pathname === '/api/lookup') {
      const target = url.searchParams.get('target')?.trim();
      if (!target) {
        return Response.json({ error: 'Missing "target" parameter' }, { status: 400, headers: corsHeaders });
      }

      try {
        const isIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(target);
        const isIPv6 = target.includes(':') && !target.includes('.');
        const isDomain = !isIPv4 && !isIPv6;

        const result: any = { target, type: isDomain ? 'domain' : (isIPv6 ? 'ipv6' : 'ipv4') };

        if (isDomain) {
          // Domain → resolve both A + AAAA
          const [aRecords, aaaaRecords] = await Promise.all([
            resolveDNS(target, 'A'),
            resolveDNS(target, 'AAAA'),
          ]);
          result.dns = { a: aRecords, aaaa: aaaaRecords };

          // Lookup both in parallel
          const ipv4Ip = aRecords[0];
          const ipv6Ip = aaaaRecords[0];
          const [geo4, geo6] = await Promise.all([
            ipv4Ip ? lookupIP(ipv4Ip) : Promise.resolve(null),
            ipv6Ip ? lookupIP(ipv6Ip) : Promise.resolve(null),
          ]);

          if (geo4 || geo6) {
            result.geolocation = {};
            if (geo4) { result.geolocation.ipv4 = geo4; result.resolved_ip = ipv4Ip; }
            if (geo6) { result.geolocation.ipv6 = geo6; if (!result.resolved_ip) result.resolved_ip = ipv6Ip; }
            result.has_ipv4 = !!geo4;
            result.has_ipv6 = !!geo6;
          } else {
            result.error = 'No DNS records found';
          }
        } else {
          // Direct IP → lookup geolocation
          const geo = await lookupIP(target);
          if (geo) {
            result.geolocation = {};
            result.geolocation[result.type] = geo;
            result.has_ipv4 = result.type === 'ipv4';
            result.has_ipv6 = result.type === 'ipv6';
          }
          // Reverse DNS
          let ptrName = '';
          if (isIPv4) {
            ptrName = target.split('.').reverse().join('.') + '.in-addr.arpa';
          } else if (isIPv6) {
            ptrName = target.replace(/:/g, '').split('').reverse().join('.') + '.ip6.arpa';
          }
          if (ptrName) {
            const ptr = await resolveDNS(ptrName, 'PTR').catch(() => []);
            if (ptr.length) result.reverse_dns = ptr;
          }
        }

        return Response.json(result, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ error: err?.message || 'Lookup failed' }, { status: 500, headers: corsHeaders });
      }
    }

    // ─── Serve HTML page ───
    return new Response(HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  },
};

// ─── DNS-over-HTTPS (Cloudflare 1.1.1.1) ───
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

// ─── IP geolocation via ipinfo.io (free, no key) ───
async function lookupIP(ip: string): Promise<any | null> {
  try {
    const res = await fetch(`https://ipinfo.io/${ip}/json`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (data.error) return null;
    const [lat, lon] = (data.loc || ',').split(',');
    return {
      ip: data.ip,
      country: data.country,
      region: data.region,
      city: data.city,
      postal: data.postal,
      latitude: lat || '',
      longitude: lon || '',
      timezone: data.timezone || '',
      org: data.org || '',
    };
  } catch {
    return null;
  }
}

// ─── HTML Frontend ───
const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IPDC - IP Lookup Tool</title>
<style>
  :root {
    --bg: #0a0e17; --card: #111827; --border: #1e293b;
    --text: #e2e8f0; --muted: #94a3b8;
    --accent: #3b82f6; --accent2: #8b5cf6;
    --green: #22c55e; --red: #ef4444; --yellow: #eab308;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; line-height:1.6; }
  .container { max-width:900px; margin:0 auto; padding:40px 20px; }
  .header { text-align:center; margin-bottom:40px; }
  .header h1 { font-size:2.2em; background:linear-gradient(135deg,var(--accent),var(--accent2)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:8px; }
  .header p { color:var(--muted); font-size:1.05em; }
  .search-box { display:flex; gap:12px; margin-bottom:32px; }
  .search-box input { flex:1; padding:14px 20px; border-radius:12px; border:1px solid var(--border); background:var(--card); color:var(--text); font-size:1.05em; outline:none; transition:border-color .2s; }
  .search-box input:focus { border-color:var(--accent); }
  .search-box input::placeholder { color:var(--muted); }
  .search-box button { padding:14px 28px; border-radius:12px; border:none; background:linear-gradient(135deg,var(--accent),var(--accent2)); color:#fff; font-size:1.05em; font-weight:600; cursor:pointer; transition:opacity .2s; white-space:nowrap; }
  .search-box button:hover { opacity:.9; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:16px; padding:24px; margin-bottom:20px; }
  .card-title { font-size:.85em; text-transform:uppercase; letter-spacing:1.5px; color:var(--muted); margin-bottom:16px; display:flex; align-items:center; gap:8px; }
  .card-title .dot { width:8px; height:8px; border-radius:50%; background:var(--green); display:inline-block; }
  .ip-display { font-size:2em; font-weight:700; font-family:'SF Mono','Cascadia Code',monospace; color:var(--accent); word-break:break-all; }
  .ip-type-badge { display:inline-block; padding:2px 10px; border-radius:6px; font-size:.55em; font-weight:600; text-transform:uppercase; vertical-align:middle; margin-left:12px; }
  .badge-ipv4 { background:rgba(59,130,246,.15); color:var(--accent); }
  .badge-ipv6 { background:rgba(139,92,246,.15); color:var(--accent2); }
  .info-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:16px; }
  .info-item { padding:12px 16px; background:rgba(255,255,255,.03); border-radius:10px; border:1px solid rgba(255,255,255,.05); }
  .info-label { font-size:.78em; color:var(--muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:4px; }
  .info-value { font-size:1.05em; font-weight:500; word-break:break-all; }
  .info-value.mono { font-family:'SF Mono',monospace; font-size:.95em; }
  .dns-records { font-family:'SF Mono',monospace; font-size:.9em; line-height:2; }
  .dns-records .dns-type { color:var(--accent2); font-weight:600; margin-right:8px; }
  #globe-container { width:100%; height:400px; border-radius:12px; overflow:hidden; background:#000; }
  .loading { text-align:center; padding:40px; color:var(--muted); }
  .spinner { width:32px; height:32px; border:3px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin .8s linear infinite; margin:0 auto 12px; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .error-msg { text-align:center; padding:24px; color:var(--red); }
  .footer { text-align:center; margin-top:40px; padding-top:20px; border-top:1px solid var(--border); color:var(--muted); font-size:.85em; }
  @media(max-width:600px) { .search-box{flex-direction:column;} .header h1{font-size:1.6em;} .ip-display{font-size:1.3em;} .info-grid{grid-template-columns:1fr;} #globe-container{height:280px;} }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>🌐 IPDC</h1>
    <p>IP 查询工具 — IPv4/IPv6 地理位置、ISP、DNS 解析、3D 地球定位</p>
  </div>
  <div class="search-box">
    <input type="text" id="searchInput" placeholder="输入 IP 地址或域名，例如 8.8.8.8 或 google.com" onkeydown="if(event.key==='Enter')doLookup()">
    <button onclick="doLookup()" id="searchBtn">🔍 查询</button>
  </div>
  <div id="results"></div>
  <div class="footer">Powered by Cloudflare Workers + Cloudflare DNS + ipinfo.io + globe.gl</div>
</div>

<script src="https://unpkg.com/globe.gl@2.35.1/dist/globe.gl.min.js"></script>
<script>
const \$ = id => document.getElementById(id);
let globe = null;

function detectType(s) {
  if (/^(\\d{1,3}\\.){3}\\d{1,3}\$/.test(s)) return 'ipv4';
  if (s.includes(':') && !s.includes('.')) return 'ipv6';
  return 'domain';
}
function badge(type) {
  const m = {ipv4:['IPv4','badge-ipv4'],ipv6:['IPv6','badge-ipv6'],domain:['域名','badge-ipv6']};
  const [l,c] = m[type]||m.domain;
  return '<span class="ip-type-badge '+c+'">'+l+'</span>';
}
function info(label, val, mono) {
  return '<div class="info-item"><div class="info-label">'+label+'</div><div class="info-value'+(mono?' mono':'')+'">'+(val||'—')+'</div></div>';
}

// ─── 3D Globe ───
function initGlobe() {
  const el = $('globe-container');
  if (!el) return;
  if (globe) el.innerHTML = '';
  globe = Globe()(el)
    .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
    .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
    .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
    .showAtmosphere(true).atmosphereColor('#3b82f6').atmosphereAltitude(0.25)
    .pointAltitude(0.06).pointRadius(0.6).pointColor(()=>'#00ff88')
    .pointsData([])
    .htmlElementsData([]).htmlLat('lat').htmlLng('lng')
    .htmlElement(d => {
      const el = document.createElement('div');
      el.style.cssText = 'transform:translate(-50%,-100%);pointer-events:none;';
      el.innerHTML = '<div style="text-align:center;">'
        +'<div style="background:linear-gradient(135deg,rgba(59,130,246,.95),rgba(139,92,246,.95));padding:8px 16px;border-radius:10px;color:#fff;font-size:13px;font-weight:600;white-space:nowrap;box-shadow:0 0 20px rgba(59,130,246,.5);border:1px solid rgba(255,255,255,.2);">'
        +'📍 '+(d.name||'')+'<div style="font-size:11px;opacity:.8;font-family:monospace;">'+(d.ip||'')+'</div></div>'
        +'<div style="width:2px;height:20px;background:linear-gradient(to bottom,rgba(0,255,136,.8),transparent);margin:0 auto;"></div></div>';
      return el;
    })
    .ringsData([]).ringLat('lat').ringLng('lng')
    .ringColor(t=>'rgba(0,255,136,'+((1-t)*0.6)+')')
    .ringMaxRadius(4).ringPropagationSpeed(2).ringRepeatPeriod(1000)
    .width(el.clientWidth).height(el.clientHeight);
  globe.controls().autoRotate = false;
  globe.controls().enableZoom = true;
  globe.controls().minDistance = 100;
  globe.controls().maxDistance = 500;
  window.addEventListener('resize', () => { if (globe && el.clientWidth>0) globe.width(el.clientWidth).height(el.clientHeight); });
}

function showGlobePoint(lat, lng, name, ip) {
  if (!globe) initGlobe();
  if (!globe) return;
  const pt = { lat:parseFloat(lat)||0, lng:parseFloat(lng)||0, name:name||'', ip:ip||'' };
  globe.pointsData([pt]);
  globe.htmlElementsData([pt]);
  globe.ringsData([pt]);
  globe.pointOfView({ lat:pt.lat, lng:pt.lng, altitude:0.9 }, 1500);
  globe.controls().autoRotate = false;
}

// ─── Render ───
function renderGeoCard(geo, ver) {
  if (!geo) return '';
  let h = '<div class="card" style="flex:1;min-width:300px;">';
  h += '<div class="card-title"><span class="dot"></span>'+badge(ver)+' 地理信息</div>';
  h += '<div class="info-grid">';
  h += info('IP', geo.ip, true);
  h += info('国家', (geo.country||'')+(geo.country_code?' ('+geo.country_code+')':''));
  h += info('地区', geo.region);
  h += info('城市', geo.city);
  h += info('邮编', geo.postal);
  h += info('时区', geo.timezone);
  h += info('纬度', geo.latitude, true);
  h += info('经度', geo.longitude, true);
  h += '</div></div>';
  h += '<div class="card" style="flex:1;min-width:300px;">';
  h += '<div class="card-title">'+badge(ver)+' 网络信息</div>';
  h += '<div class="info-grid">';
  h += info('运营商', geo.org);
  h += '</div></div>';
  return h;
}

function showResults(data) {
  const el = $('results');
  if (data.error) { el.innerHTML = '<div class="card error-msg">❌ '+data.error+'</div>'; return; }
  const geo = data.geolocation;
  const geo4 = geo?.ipv4, geo6 = geo?.ipv6;
  const has4 = !!geo4, has6 = !!geo6;
  let html = '';
  // Globe
  html += '<div class="card" style="padding:0;overflow:hidden;"><div id="globe-container"></div></div>';
  // IP summary
  html += '<div class="card"><div class="card-title"><span class="dot"></span>查询结果 — '+data.target+'</div>';
  html += '<div style="display:flex;gap:16px;flex-wrap:wrap;">';
  if (has4) html += '<div class="ip-display" style="font-size:1.3em;">'+geo4.ip+badge('ipv4')+'</div>';
  if (has6) html += '<div class="ip-display" style="font-size:1.3em;color:var(--accent2);">'+geo6.ip+badge('ipv6')+'</div>';
  if (!has4&&!has6) html += '<div style="color:var(--muted);">未找到 IP 记录</div>';
  html += '</div></div>';
  // DNS
  if (data.dns) {
    html += '<div class="card"><div class="card-title">DNS 记录</div><div class="dns-records">';
    if (data.dns.a&&data.dns.a.length) html += '<div><span class="dns-type">A</span>'+data.dns.a.join(', ')+'</div>';
    if (data.dns.aaaa&&data.dns.aaaa.length) html += '<div><span class="dns-type">AAAA</span>'+data.dns.aaaa.join(', ')+'</div>';
    if ((!data.dns.a||!data.dns.a.length)&&(!data.dns.aaaa||!data.dns.aaaa.length)) html += '<div style="color:var(--muted);">无记录</div>';
    html += '</div></div>';
  }
  // PTR
  if (data.reverse_dns&&data.reverse_dns.length) {
    html += '<div class="card"><div class="card-title">反向 DNS</div><div class="dns-records"><span class="dns-type">PTR</span>'+data.reverse_dns.join(', ')+'</div></div>';
  }
  // IPv4 + IPv6 cards
  if (has4||has6) {
    html += '<div style="display:flex;gap:20px;flex-wrap:wrap;">';
    if (has4) html += renderGeoCard(geo4,'ipv4');
    if (has6) html += renderGeoCard(geo6,'ipv6');
    html += '</div>';
  }
  el.innerHTML = html;
  setTimeout(() => {
    initGlobe();
    const g = has4?geo4:geo6;
    if (g&&g.latitude&&g.longitude) showGlobePoint(g.latitude, g.longitude, (g.city||'')+', '+(g.country||''), g.ip);
  }, 100);
}

function showLoading(msg) { \$('results').innerHTML = '<div class="loading"><div class="spinner"></div>'+(msg||'查询中...')+'</div>'; }

async function doLookup() {
  const input = \$('searchInput').value.trim();
  if (!input) return;
  \$('searchBtn').disabled = true;
  showLoading('查询 '+input+' ...');
  try {
    const res = await fetch('/api/lookup?target='+encodeURIComponent(input));
    showResults(await res.json());
  } catch(e) { \$('results').innerHTML = '<div class="card error-msg">❌ '+e.message+'</div>'; }
  finally { \$('searchBtn').disabled = false; }
}

// ─── Auto-load visitor info (Cloudflare built-in, instant) ───
async function loadVisitor() {
  showLoading('获取你的 IP 信息...');
  try {
    // 1. Get visitor IP + geolocation from Cloudflare (instant, no external call)
    const visRes = await fetch('/api/visitor');
    const vis = await visRes.json();
    if (!vis.ip || vis.ip === 'unknown') {
      \$('results').innerHTML = '<div class="card error-msg">无法获取 IP</div>';
      return;
    }
    \$('searchInput').value = vis.ip;

    // 2. Build result directly from Cloudflare data (no need to call ipinfo for visitor)
    const geo = {
      ip: vis.ip,
      country: vis.country,
      region: vis.region,
      city: vis.city,
      postal: vis.postal,
      latitude: vis.latitude,
      longitude: vis.longitude,
      timezone: vis.timezone,
      org: 'AS' + vis.asn + ' ' + vis.as_org,
    };

    const data = {
      target: vis.ip,
      type: detectType(vis.ip),
      geolocation: {},
      has_ipv4: false,
      has_ipv6: false,
    };
    data.geolocation[data.type] = geo;
    data.has_ipv4 = data.type === 'ipv4';
    data.has_ipv6 = data.type === 'ipv6';

    showResults(data);
  } catch(e) {
    \$('results').innerHTML = '<div class="card error-msg">❌ '+e.message+'</div>';
  }
}

setTimeout(() => initGlobe(), 500);
loadVisitor();
</script>
</body>
</html>`;
