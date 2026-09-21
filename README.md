# Virtual Location — 私有 iOS 网络定位服务

这是一个面向个人自托管场景的 iOS 网络定位服务。项目使用公网 IP 即可部署，不要求购买域名；通过 IKEv2 VPN、私有 DNS 和内置 WLOC 服务修改 Apple 网络定位响应中的坐标。

> 开源的是部署程序，不是某台已经部署好的服务器。仓库不包含可用的线上账号、密码、访问令牌、客户端私钥或 VPN 描述文件。每个部署者都必须使用自己的公网 IP 和随机凭据。

## 功能

- 设置目标纬度、经度、海拔和精度
- 保存常用位置并快速切换
- 随机游走：选两个收藏点作为直径构成一个圆，一键在圆内随机取点
- 自动生成 Root CA、VPN 服务器证书、客户端证书和 WLOC TLS 证书
- 生成包含 IKEv2 VPN、Root CA 和客户端证书的 iOS `.mobileconfig`
- 使用 HTTP Basic Auth 保护网页、位置管理 API 和描述文件下载
- 使用独立 Bearer Token 保护包含 VPN 服务器私钥的证书包接口
- 支持无域名、公网 IPv4 直连部署
- 支持 Apple 及中国区高德 WLOC 端点

## 工作原理

```text
iPhone
  │ 安装私有 Root CA、VPN 客户端证书和 IKEv2 配置
  ▼
IKEv2 VPN（strongSwan）
  │ 分配 10.8.1.2，并下发 DNS 10.8.1.1
  ▼
dnsmasq 将固定的 WLOC 域名解析到 10.8.1.1
  │
  ▼
iptables: 10.8.1.1:443 → 127.0.0.1:8445
  │
  ▼
WLOC 服务转发原始 /clls/wloc 请求，并修改有效 protobuf 响应中的坐标
```

项目处理的是 Apple 的网络定位结果，包括响应中的 Wi-Fi 和部分蜂窝位置。它不会直接修改 GPS 硬件读数，也不能保证所有第三方 App 都使用该结果。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | HTML / CSS / 原生 JavaScript |
| 后端 | Node.js 22+ / Express / HTTPS |
| 数据库 | Node.js 内置 SQLite |
| VPN | strongSwan IKEv2，客户端证书认证 |
| DNS | dnsmasq |
| 网络转发 | iptables |
| 证书 | node-forge + Node.js 原生 crypto |
| WLOC | `/clls/wloc` 长度前缀 protobuf，保留上游响应并替换坐标字段 |

## 安全模型

此项目是单用户工具，没有账号注册或多用户数据库，但不是匿名服务：

- 网页、位置 API、收藏 API、Root CA 和 `.mobileconfig` 下载均受 Basic Auth 保护。
- `/api/vpn/server-bundle` 使用独立的 `SERVER_BUNDLE_TOKEN`，因为响应包含 VPN 服务器私钥。
- `/api/health` 是唯一无需认证的 HTTP 接口，只返回服务健康状态和时间。
- VPN 使用客户端证书认证。没有 `.mobileconfig` 中的客户端私钥，不能连接 VPN。
- `server/data/` 保存 CA、服务器/客户端私钥和数据库，`.env` 保存管理凭据；两者都被 Git 忽略。

必须把以下内容视为机密，不能提交到 Git、上传到网盘公开链接或发给其他人：

```text
.env
server/data/
*.mobileconfig
*.p12 / *.pfx
server-bundle.json
```

`.mobileconfig` 不只是普通配置文件，其中包含 VPN 客户端证书及私钥。任何拿到该文件的人，都可能以同一个客户端身份连接你的 VPN。

## 快速开始

```bash
git clone https://github.com/Iexplain/apple-location.git
cd apple-location
npm ci
cp .env.example .env
```

编辑 `.env`。下面的 `203.0.113.10` 是 RFC 5737 保留的不可路由示例地址，必须替换成你自己的公网 IP：

```env
NODE_ENV=production

PORT=3000
HTTP_HOST=127.0.0.1
HTTPS_HOST=0.0.0.0
HTTPS_PORT=8444
WLOC_PORT=8445

VPN_SERVER_ADDRESS=203.0.113.10
VPN_REMOTE_ID=203.0.113.10

ADMIN_USERNAME=replace-with-private-admin-username
ADMIN_PASSWORD=replace-with-at-least-16-random-characters
SERVER_BUNDLE_TOKEN=replace-with-at-least-32-random-characters
```

可以分别生成随机密码和令牌，例如：

```bash
openssl rand -hex 24
openssl rand -hex 32
```

不要把命令输出复制到 README、Issue、日志截图或任何 Git 跟踪文件中，只写入服务器上的 `.env`。

启动服务：

```bash
npm run init-certs
npm start
```

本地开发可以访问 `http://127.0.0.1:3000`。完整公网部署还需要配置 strongSwan、dnsmasq、iptables 和云安全组，参见：

- [公网 IP 部署指南](docs/DEPLOY.md)
- [strongSwan 与定位劫持配置](docs/VPN_SETUP.md)

## 云服务器端口

阿里云等云服务器的安全组只需要开放：

| 端口 | 协议 | 用途 |
|---|---|---|
| `8444` | TCP | 私有网页及描述文件下载 |
| `500` | UDP | IKEv2 |
| `4500` | UDP | IKEv2 NAT Traversal |

以下端口不应对公网开放：

| 端口 | 监听地址 | 用途 |
|---|---|---|
| `3000` | `127.0.0.1` | Express 内部 HTTP 服务 |
| `8445` | `127.0.0.1` | WLOC 内部 HTTPS 服务 |
| `53` | `10.8.1.1` | 仅供 VPN 客户端使用的 DNS |

公网访问地址格式为：

```text
https://<你的公网IP>:8444
```

浏览器会要求输入你在 `.env` 中自行设置的管理用户名和密码。仓库没有默认的生产密码，也不会在文档中提供任何可用于现有服务器的登录信息。

## iPhone 安装步骤

1. 使用 Safari 打开自己的 `https://<公网IP>:8444`。
2. 输入自己部署时写入 `.env` 的管理凭据。
3. 设置并保存目标坐标。
4. 下载“VPN 一体化配置”。
5. 在“设置 → 通用 → VPN 与设备管理”中安装描述文件。
6. 在“设置 → 通用 → 关于本机 → 证书信任设置”中完全信任 `Virtual Location Root CA`。
7. 连接 `Virtual Location` VPN。
8. 完全退出并重新打开地图等定位 App，然后刷新当前位置。

Root CA 的“完全信任”同时用于 WLOC HTTPS。只安装描述文件但没有开启完全信任时，VPN 可能连接成功，但定位请求会在 TLS 阶段失败。

## WLOC 实现说明

当前 iOS WLOC 接口路径是：

```text
/clls/wloc
```

请求和响应不是二进制 plist，而是带长度前缀的 protobuf。服务会：

1. 仅接受固定 WLOC 域名及 `/clls/wloc` POST 请求；
2. 将手机的原始请求转发给对应的 Apple 或高德上游；
3. 保留上游响应中的未知字段和容器结构；
4. 替换 Wi-Fi/蜂窝位置消息中的纬度、经度和精度；
5. 将有效响应返回 iPhone。

WLOC 叶子证书最长为 397 天，以满足现代 iOS 对 TLS 服务器证书有效期的要求。到期时服务会使用原 Root CA 自动重新签发 WLOC 叶子证书；Root CA 不变时，手机不需要重新安装描述文件。

## 随机游走

不想一直停在同一个坐标时，可以在收藏里给两个点分别点 `[A]` 和 `[B]`——这两点连成的线段作为**直径**构成一个圆。之后每点一次「随机取点」，就会在圆内均匀随机选一个位置并直接应用为目标位置。

- 圆心取两点在球面上的中点，因此 A、B 都**恰好落在圆周上**；半径等于两点距离的一半。
- 取点按**面积均匀**分布（`r = R·√U`），圆内每个位置被选中的概率相同。若不做开根号，点会明显向圆心聚集。
- 两个端点的坐标在设置时从收藏**快照**保存，之后删除该收藏不会影响已配置的范围。
- 海拔和精度沿用当前设置，随机只改变经纬度。

## API

除健康检查外，以下接口都需要认证：

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/api/health` | 无 | 健康检查，不返回坐标或密钥 |
| GET | `/api/location` | Basic Auth | 获取当前目标位置 |
| POST | `/api/location` | Basic Auth | 保存目标位置 |
| GET | `/api/favorites` | Basic Auth | 获取收藏列表 |
| POST | `/api/favorites` | Basic Auth | 添加收藏 |
| DELETE | `/api/favorites/:id` | Basic Auth | 删除收藏 |
| GET | `/api/range` | Basic Auth | 获取随机游走的两个端点、圆心和半径 |
| POST | `/api/range` | Basic Auth | 从收藏设置端点 A 或 B（`{ slot, favoriteId }`） |
| DELETE | `/api/range/:slot` | Basic Auth | 清除端点 A 或 B |
| POST | `/api/range/random` | Basic Auth | 在圆内随机取点并写入目标位置 |
| GET | `/api/vpn/profile` | Basic Auth | 下载 `.mobileconfig` |
| GET | `/api/certificate` | Basic Auth | 下载 Root CA |
| GET | `/api/vpn/server-bundle` | Bearer Token | 获取 VPN 服务器证书包 |

生产环境启动时会检查 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 和 `SERVER_BUNDLE_TOKEN`。未配置、仍使用 `replace-with-...` 等文档占位符，或密码/令牌少于 16 个字符时，服务都会拒绝启动。

## Docker

```bash
docker build -t apple-location .
docker run -d \
  --env-file .env \
  -p 8444:8444 \
  -v "$(pwd)/server/data:/app/server/data" \
  --name apple-location \
  --restart unless-stopped \
  apple-location
```

Docker 只运行 Node 服务；宿主机仍需配置 strongSwan、dnsmasq、VPN 地址和 iptables。WLOC 的 `10.8.1.1:443` DNAT 规则必须位于 Docker 自动生成的 `PREROUTING ... -j DOCKER` 规则之前，否则 Docker 的公网 443 映射会抢先处理定位请求。

## 验证

```bash
npm test
curl http://127.0.0.1:3000/api/health
dig @10.8.1.1 gs-loc.apple.com
swanctl --list-sas
iptables -t nat -vnL PREROUTING --line-numbers
pm2 logs apple-location --nostream --lines 80
```

虚拟定位实际生效时，日志会出现类似以下记录：

```text
[wloc] → <目标纬度>,<目标经度> (400 Wi-Fi, 0 cell locations)
```

VPN 显示已连接只证明 IKEv2 隧道成功；必须看到新的 `[wloc] → ...` 才能确认定位请求已被处理。

## 凭据泄露后的处理

- 管理账号泄露：修改服务器 `.env` 中的 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD`，然后重启服务。
- 证书包令牌泄露：修改 `SERVER_BUNDLE_TOKEN`，然后重启服务。
- `.mobileconfig` 或客户端私钥泄露：仅修改网页密码不够；需要吊销或更换 VPN 客户端证书，并重新安装新描述文件。
- CA 私钥泄露：需要更换整个 Root CA、所有叶子证书和描述文件。

不要把新的凭据提交到 Git。若秘密曾经进入 Git 提交历史，仅删除当前文件不够，还必须轮换秘密并清理历史。

## 限制

- 不能直接修改 GPS 硬件数据。
- iOS 和第三方 App 可能使用缓存、GPS 或自己的定位接口。
- 定位效果受 iOS 版本、地区端点和 App 实现影响。
- 当前客户端证书是单用户共享模型，不适合公开提供给多人使用。

## 许可证

MIT
