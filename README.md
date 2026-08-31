# WKT6 定位 2 — iOS 虚拟定位服务（个人版）

复现 [apple2.wkt6.cn](https://apple2.wkt6.cn/) 的 iOS 虚拟定位服务，简化为个人工具——打开即用，无需登录/注册/会员。

## 功能

- **目标位置** — 设置纬度、经度、海拔、精度
- **收藏位置** — 保存常用坐标，一键应用
- **描述文件生成** — 自动生成 iOS `.mobileconfig`（IKEv2 VPN + Root CA + 客户端证书）
- **证书管理** — 自签 Root CA、服务器证书、客户端证书
- **VPN 配置指南** — strongSwan IKEv2 服务器配置

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | HTML / CSS / 原生 JS |
| 后端 | Node.js + Express（无认证，无数据库用户系统） |
| 数据库 | SQLite（Node 22 内置 `node:sqlite`） |
| 证书 | node-forge + Node.js native crypto |

## 快速开始

```bash
git clone https://github.com/Iexplain/apple-location.git
cd apple-location
npm install
cp .env.example .env
# 编辑 .env，设置 VPN_SERVER_ADDRESS 为你的 VPN 服务器域名
npm start
```

打开 `http://localhost:3000`，设置目标位置，下载描述文件。

> **iOS 限制**：描述文件必须通过 **HTTPS** 下载。生产环境需配置 HTTPS 反向代理。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/location` | 获取当前目标位置 |
| POST | `/api/location` | 保存目标位置 |
| GET | `/api/favorites` | 收藏列表 |
| POST | `/api/favorites` | 添加收藏 |
| DELETE | `/api/favorites/:id` | 删除收藏 |
| GET | `/api/vpn/profile` | 下载 .mobileconfig |
| GET | `/api/certificate` | 下载 Root CA .cer |
| GET | `/api/vpn/server-bundle` | 获取服务器证书包（部署 VPN 用） |

## 部署到云服务器（手机随时访问）

部署到一台有公网 IP 的云服务器后，手机在外面也能随时打开网址使用。

### 前提

- 一台云服务器（有公网 IP，开放 80/443 端口）
- 一个域名解析到服务器 IP（如 `loc.yourdomain.com` → 服务器 IP）

> **为什么需要 HTTPS？** iOS 描述文件必须通过 HTTPS 下载，HTTP 会被 iPhone 拒绝。

### 步骤

```bash
# 1. 服务器上拉代码
git clone https://github.com/Iexplain/apple-location.git
cd apple-location
npm install

# 2. 配置
cp .env.example .env
nano .env
#   → 把 VPN_SERVER_ADDRESS 改成你的域名

# 3. 用 PM2 后台运行（不会因 SSH 断开而停）
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save && pm2 startup

# 4. 装 Caddy 自动配置 HTTPS（一行搞定域名 + 证书）
sudo apt install caddy
sudo cp Caddyfile.example /etc/caddy/Caddyfile
#   → 编辑 Caddyfile 把 loc.yourdomain.com 换成你的域名
sudo systemctl restart caddy
```

完成后，手机浏览器打开 `https://你的域名` 即可。

### Docker 方式

```bash
docker build -t apple-location .
docker run -d -p 3000:3000 --name apple-location --restart unless-stopped apple-location
```

> Docker 方式同样需要 Caddy/Nginx 做 HTTPS 反向代理。

## VPN 服务器配置

详见 [docs/VPN_SETUP.md](docs/VPN_SETUP.md)

## 工作原理

```
iPhone → 下载 .mobileconfig (Root CA + IKEv2 VPN) → 安装描述文件 → 连接 VPN → 定位伪装
```

VPN 服务器端的定位劫持逻辑需要额外配置（DNS 劫持 + 自建定位 API），详见 VPN_SETUP.md 第 8 节。

## 许可证

MIT
