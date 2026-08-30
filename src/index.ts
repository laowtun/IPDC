interface Env {}

// IP geolocation API (free, no key, supports IPv4+IPv6, HTTPS)
const IP_API = 'https://ipinfo.io';

// DNS-over-HTTPS resolver (Cloudflare 1.1.1.1)
const DOH_URL = 'https://1.1.1.1/dns-query';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers for API
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // API: visitor info (from Cloudflare request.cf)
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

    // API: lookup IP or domain
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
          const [aRecords, aaaaRecords] = await Promise.all([
            resolveDNS(target, 'A'),
            resolveDNS(target, 'AAAA'),
          ]);
          result.dns = { a: aRecords, aaaa: aaaaRecords };
          const lookupIp = aRecords[0] || aaaaRecords[0];
          if (lookupIp) {
            const geo = await lookupIP(lookupIp);
            if (geo) {
              result.geolocation = geo;
              result.resolved_ip = lookupIp;
            }
          } else {
            result.error = 'No DNS records found';
          }
        } else {
          const [geo, ptrRecords] = await Promise.all([
            lookupIP(target),
            resolveDNS(`${target.split('.').reverse().join('.')}.in-addr.arpa`, 'PTR')
              .catch(() => resolveDNS(target, 'PTR')),
          ]);
          if (geo) result.geolocation = geo;
          result.reverse_dns = ptrRecords;
        }

        return Response.json(result, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ error: err?.message || 'Lookup failed' }, { status: 500, headers: corsHeaders });
      }
    }

    // Serve HTML page
    return new Response(HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  },
};

async function resolveDNS(name: string, type: string): Promise<string[]> {
  try {
    const url = `${DOH_URL}?name=${encodeURIComponent(name)}&type=${type}`;
    const res = await fetch(url, {
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
    const res = await fetch(`${IP_API}/${ip}/json`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.log(`[lookupIP] HTTP ${res.status} for ${ip}`);
      return null;
    }
    const data: any = await res.json();
    if (data.error) {
      console.log(`[lookupIP] API error for ${ip}:`, data.reason || data.message);
      return null;
    }
    const [lat, lon] = (data.loc || ',').split(',');
    return {
      ip: data.ip,
      country: data.country,
      country_code: data.country,
      region: data.region,
      city: data.city,
      postal: data.postal,
      latitude: lat || '',
      longitude: lon || '',
      timezone: data.timezone || '',
      isp: data.org || '',
      org: data.org || '',
      as_info: data.org || '',
      as_name: data.org || '',
      reverse_dns: data.hostname || '',
      is_mobile: false,
      is_proxy: false,
      is_hosting: false,
    };
  } catch (e: any) {
    console.log(`[lookupIP] Error for ${ip}:`, e?.message);
    return null;
  }
}

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IPDC - IP Lookup Tool</title>
<style>
  :root {
    --bg: #0a0e17;
    --card: #111827;
    --border: #1e293b;
    --text: #e2e8f0;
    --muted: #94a3b8;
    --accent: #3b82f6;
    --accent2: #8b5cf6;
    --green: #22c55e;
    --red: #ef4444;
    --yellow: #eab308;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    line-height: 1.6;
  }
  .container { max-width: 900px; margin: 0 auto; padding: 40px 20px; }
  .header { text-align: center; margin-bottom: 40px; }
  .header h1 {
    font-size: 2.2em;
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    margin-bottom: 8px;
  }
  .header p { color: var(--muted); font-size: 1.05em; }
  .search-box { display: flex; gap: 12px; margin-bottom: 32px; }
  .search-box input {
    flex: 1; padding: 14px 20px; border-radius: 12px;
    border: 1px solid var(--border); background: var(--card);
    color: var(--text); font-size: 1.05em; outline: none; transition: border-color 0.2s;
  }
  .search-box input:focus { border-color: var(--accent); }
  .search-box input::placeholder { color: var(--muted); }
  .search-box button {
    padding: 14px 28px; border-radius: 12px; border: none;
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    color: white; font-size: 1.05em; font-weight: 600; cursor: pointer;
    transition: opacity 0.2s; white-space: nowrap;
  }
  .search-box button:hover { opacity: 0.9; }
  .search-box button:disabled { opacity: 0.5; cursor: not-allowed; }
  .card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 16px; padding: 24px; margin-bottom: 20px;
  }
  .card-title {
    font-size: 0.85em; text-transform: uppercase; letter-spacing: 1.5px;
    color: var(--muted); margin-bottom: 16px; display: flex; align-items: center; gap: 8px;
  }
  .card-title .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); display: inline-block; }
  .ip-display {
    font-size: 2em; font-weight: 700;
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    color: var(--accent); word-break: break-all;
  }
  .ip-type-badge {
    display: inline-block; padding: 2px 10px; border-radius: 6px;
    font-size: 0.55em; font-weight: 600; text-transform: uppercase;
    vertical-align: middle; margin-left: 12px;
  }
  .badge-ipv4 { background: rgba(59,130,246,0.15); color: var(--accent); }
  .badge-ipv6 { background: rgba(139,92,246,0.15); color: var(--accent2); }
  .badge-domain { background: rgba(234,179,8,0.15); color: var(--yellow); }
  .info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
  .info-item {
    padding: 12px 16px; background: rgba(255,255,255,0.03);
    border-radius: 10px; border: 1px solid rgba(255,255,255,0.05);
  }
  .info-label {
    font-size: 0.78em; color: var(--muted); text-transform: uppercase;
    letter-spacing: 1px; margin-bottom: 4px;
  }
  .info-value { font-size: 1.05em; font-weight: 500; word-break: break-all; }
  .info-value.mono { font-family: 'SF Mono', monospace; font-size: 0.95em; }
  .tag {
    display: inline-block; padding: 3px 10px; border-radius: 6px;
    font-size: 0.82em; font-weight: 500;
  }
  .tag-yes { background: rgba(34,197,94,0.15); color: var(--green); }
  .tag-no { background: rgba(148,163,184,0.1); color: var(--muted); }
  .tag-warn { background: rgba(234,179,8,0.15); color: var(--yellow); }
  .dns-records { font-family: 'SF Mono', monospace; font-size: 0.9em; line-height: 2; }
  .dns-records .dns-type { color: var(--accent2); font-weight: 600; margin-right: 8px; }
  .dns-records .dns-val { color: var(--text); }
  #globe-container {
    width: 100%; height: 400px; border-radius: 12px; overflow: hidden;
    border: 1px solid var(--border); background: #000; position: relative;
  }
  .loading { text-align: center; padding: 40px; color: var(--muted); }
  .spinner {
    width: 32px; height: 32px; border: 3px solid var(--border);
    border-top-color: var(--accent); border-radius: 50%;
    animation: spin 0.8s linear infinite; margin: 0 auto 12px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .error-msg { text-align: center; padding: 24px; color: var(--red); }
  .footer {
    text-align: center; margin-top: 40px; padding-top: 20px;
    border-top: 1px solid var(--border); color: var(--muted); font-size: 0.85em;
  }
  .footer a { color: var(--accent); text-decoration: none; }
  @media (max-width: 600px) {
    .search-box { flex-direction: column; }
    .header h1 { font-size: 1.6em; }
    .ip-display { font-size: 1.4em; }
    .info-grid { grid-template-columns: 1fr; }
    #globe-container { height: 300px; }
  }
</style>
</head>
<body>

<div class="container">
  <div class="header">
    <h1>🌐 IPDC</h1>
    <p>IP Lookup Tool — 查询 IPv4/IPv6 地理位置、ISP、DNS 解析，3D 地球定位</p>
  </div>

  <div class="search-box">
    <input type="text" id="searchInput" placeholder="输入 IP 地址或域名，例如 8.8.8.8 或 google.com"
           onkeydown="if(event.key==='Enter')doLookup()">
    <button onclick="doLookup()" id="searchBtn">🔍 查询</button>
  </div>

  <div id="results"></div>

  <div class="footer">
    Powered by Cloudflare Workers + ip-api.com + DNS-over-HTTPS + globe.gl
  </div>
</div>

<script src="https://unpkg.com/globe.gl@2.35.1/dist/globe.gl.min.js"></script>
<script>
  const $ = id => document.getElementById(id);
  let globe = null;
  let currentLat = 0, currentLng = 0;

  function detectType(s) {
    if (/^(\\d{1,3}\\.){3}\\d{1,3}$/.test(s)) return 'ipv4';
    if (s.includes(':') && !s.includes('.')) return 'ipv6';
    return 'domain';
  }

  function badge(type) {
    const map = { ipv4: ['IPv4','badge-ipv4'], ipv6: ['IPv6','badge-ipv6'], domain: ['域名','badge-domain'] };
    const [label, cls] = map[type] || map.domain;
    return '<span class="ip-type-badge ' + cls + '">' + label + '</span>';
  }

  function tag(val, labelYes, labelNo) {
    return val
      ? '<span class="tag tag-yes">' + (labelYes || '是') + '</span>'
      : '<span class="tag tag-no">' + (labelNo || '否') + '</span>';
  }

  function info(label, value, mono) {
    return '<div class="info-item"><div class="info-label">' + label + '</div>'
      + '<div class="info-value' + (mono ? ' mono' : '') + '">' + (value || '—') + '</div></div>';
  }

  // Initialize3D Globe
  function initGlobe() {
    const container = $('globe-container');
    if (!container) return;
    if (globe) {
      container.innerHTML = '';
    }
    globe = Globe()(container)
      .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
      .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
      .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
      .pointAltitude(0.01)
      .pointRadius(0.25)
      .pointColor(() => '#3b82f6')
      .pointLabel(({ name }) => '<div style="background:rgba(0,0,0,0.8);padding:6px 12px;border-radius:8px;color:#fff;font-size:13px;">' + name + '</div>')
      .pointsData([])
      .width(container.clientWidth)
      .height(container.clientHeight);

    globe.controls().autoRotate = true;
    globe.controls().autoRotateSpeed = 0.5;
    globe.controls().enableZoom = true;

    // Handle resize
    window.addEventListener('resize', () => {
      if (globe && container.clientWidth > 0) {
        globe.width(container.clientWidth).height(container.clientHeight);
      }
    });
  }

  function showGlobePoint(lat, lng, name) {
    if (!globe) initGlobe();
    if (!globe) return;
    currentLat = parseFloat(lat) || 0;
    currentLng = parseFloat(lng) || 0;

    // Set point data
    globe.pointsData([{ lat: currentLat, lng: currentLng, name: name || '' }]);

    // Fly to point
    globe.pointOfView({ lat: currentLat, lng: currentLng, altitude: 1.5 }, 1000);
  }

  function showResults(data) {
    const el = $('results');
    if (data.error) {
      el.innerHTML = '<div class="card error-msg">❌ ' + data.error + '</div>';
      return;
    }

    const geo = data.geolocation;
    const type = data.type;
    const ip = geo ? geo.ip : data.target;

    let html = '';

    // Globe card
    html += '<div class="card" style="padding:0;overflow:hidden;">';
    html += '<div id="globe-container"></div>';
    html += '</div>';

    // IP card
    html += '<div class="card">';
    html += '<div class="card-title"><span class="dot"></span>查询结果</div>';
    html += '<div class="ip-display">' + ip + badge(type) + '</div>';
    if (data.resolved_ip && data.resolved_ip !== ip) {
      html += '<div style="color:var(--muted);margin-top:8px;font-size:0.9em;">解析自 ' + data.target + ' → ' + data.resolved_ip + '</div>';
    }
    html += '</div>';

    // DNS records
    if (data.dns) {
      html += '<div class="card">';
      html += '<div class="card-title">DNS 记录</div>';
      html += '<div class="dns-records">';
      if (data.dns.a && data.dns.a.length) {
        html += '<div><span class="dns-type">A</span>' + data.dns.a.map(v => '<span class="dns-val">' + v + '</span>').join(', ') + '</div>';
      }
      if (data.dns.aaaa && data.dns.aaaa.length) {
        html += '<div><span class="dns-type">AAAA</span>' + data.dns.aaaa.map(v => '<span class="dns-val">' + v + '</span>').join(', ') + '</div>';
      }
      if ((!data.dns.a || !data.dns.a.length) && (!data.dns.aaaa || !data.dns.aaaa.length)) {
        html += '<div style="color:var(--muted);">无 A/AAAA 记录</div>';
      }
      html += '</div></div>';
    }

    // Reverse DNS
    if (data.reverse_dns && data.reverse_dns.length) {
      html += '<div class="card">';
      html += '<div class="card-title">反向 DNS (PTR)</div>';
      html += '<div class="dns-records"><span class="dns-type">PTR</span>';
      html += data.reverse_dns.map(v => '<span class="dns-val">' + v + '</span>').join(', ');
      html += '</div></div>';
    }

    // Geolocation card
    if (geo) {
      html += '<div class="card">';
      html += '<div class="card-title">地理信息</div>';
      html += '<div class="info-grid">';
      html += info('国家', (geo.country || '') + (geo.country_code ? ' (' + geo.country_code + ')' : ''));
      html += info('地区', geo.region);
      html += info('城市', geo.city);
      html += info('邮编', geo.postal);
      html += info('时区', geo.timezone);
      html += info('纬度', geo.latitude, true);
      html += info('经度', geo.longitude, true);
      html += '</div></div>';

      // Network card
      html += '<div class="card">';
      html += '<div class="card-title">网络信息</div>';
      html += '<div class="info-grid">';
      html += info('ISP', geo.isp);
      html += info('组织', geo.org);
      html += info('AS 信息', geo.as_info, true);
      html += info('AS 名称', geo.as_name);
      html += info('反向 DNS', geo.reverse_dns);
      html += '</div>';

      html += '<div style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap;">';
      html += '<div>' + tag(geo.is_hosting, '托管/数据中心', '非托管') + '</div>';
      html += '<div>' + tag(geo.is_proxy, '代理/VPN', '非代理') + '</div>';
      html += '<div>' + tag(geo.is_mobile, '移动网络', '非移动') + '</div>';
      html += '</div>';
      html += '</div>';

      // Show on globe
      if (geo.latitude && geo.longitude) {
        showGlobePoint(geo.latitude, geo.longitude, geo.city + ', ' + geo.country);
      }
    }

    el.innerHTML = html;

    // Re-init globe after DOM update
    setTimeout(() => {
      initGlobe();
      if (geo && geo.latitude && geo.longitude) {
        showGlobePoint(geo.latitude, geo.longitude, geo.city + ', ' + geo.country);
      }
    }, 100);
  }

  function showLoading(msg) {
    $('results').innerHTML = '<div class="loading"><div class="spinner"></div>' + (msg || '查询中...') + '</div>';
  }

  async function doLookup() {
    const input = $('searchInput').value.trim();
    if (!input) return;
    $('searchBtn').disabled = true;
    showLoading('查询 ' + input + ' ...');
    try {
      const res = await fetch('/api/lookup?target=' + encodeURIComponent(input));
      const data = await res.json();
      showResults(data);
    } catch (e) {
      $('results').innerHTML = '<div class="card error-msg">❌ 网络错误: ' + e.message + '</div>';
    } finally {
      $('searchBtn').disabled = false;
    }
  }

  async function loadVisitor() {
    showLoading('获取你的 IP 信息...');
    try {
      const res = await fetch('/api/visitor');
      const data = await res.json();
      if (data.ip && data.ip !== 'unknown') {
        $('searchInput').value = data.ip;
        const lookupRes = await fetch('/api/lookup?target=' + encodeURIComponent(data.ip));
        const lookupData = await lookupRes.json();
        showResults(lookupData);
      } else {
        $('results').innerHTML = '<div class="card error-msg">无法获取你的 IP 地址</div>';
      }
    } catch (e) {
      $('results').innerHTML = '<div class="card error-msg">❌ 无法连接: ' + e.message + '</div>';
    }
  }

  // Init globe on first load
  setTimeout(() => initGlobe(), 500);
  loadVisitor();
</script>

</body>
</html>`;
