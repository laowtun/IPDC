# IPDC - IP Lookup Tool

🌐 IP 地址查询工具，支持 IPv4/IPv6、域名 DNS 解析、3D 地球定位。

## 功能

- 🔍 **IP 查询** — 输入 IP 地址查看地理位置、ISP、ASN 等详细信息
- 🌐 **域名解析** — 输入域名自动解析 A/AAAA 记录并查询首个 IP
- 🌍 **3D 地球** — 以 3D 地球图展示 IP 所在位置
- 📍 **自动检测** — 打开页面自动获取并展示你当前的 IP 信息
- 📱 **响应式** — 完美适配手机和桌面

## 技术栈

- **Runtime**: Cloudflare Workers
- **框架**: Hono (lightweight, edge-native)
- **IP 数据**: ip-api.com (free, IPv4+IPv6)
- **DNS**: Cloudflare DNS-over-HTTPS (1.1.1.1)
- **3D 地球**: Three.js + globe.gl

## 部署

Push to `main` branch 自动通过 GitHub Actions 部署到 Cloudflare Workers。

## License

MIT
