# WKT6 定位 2 — iOS 虚拟定位服务

完整复现 [apple2.wkt6.cn](https://apple2.wkt6.cn/) 的 iOS 虚拟定位服务，包含前端 UI、后端 API、证书生成、描述文件生成和 VPN 服务器配置指南。

## 功能

- **账号系统** — 注册 / 登录 / 设备绑定 / JWT 认证
- **目标位置** — 设置纬度、经度、海拔、精度
- **收藏位置** — 保存常用坐标，一键应用
- **会员服务** — 激活码充值、到期管理、设备绑定
- **描述文件生成** — 自动生成 iOS `.mobileconfig`（IKEv2 VPN + Root CA + 客户端证书）
- **证书管理** — 自签 Root CA、服务器证书、客户端证书（PKCS12）
- **VPN 配置指南** — strongSwan IKEv2 服务器配置

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | HTML / CSS / 原生 JS（无框架，无构建） |
| 后端 | Node.js + Express |
| 数据库 | SQLite (better-sqlite3) |
| 认证 | JWT (jsonwebtoken) + bcryptjs |
| 证书 | node-forge（纯 JS，无原生依赖） |

## 快速开始

### 1. 克隆 & 安装

```bash
git clone https://github.com/Iexplain/apple-location.git
cd apple-location
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，设置 VPN_SERVER_ADDRESS 为你的 VPN 服务器域名
```

### 3. 启动服务

```bash
npm start
```

服务默认运行在 `http://localhost:3000`。首次启动时会自动生成证书和初始化数据库。

### 4. 使用

1. 打开浏览器访问 `http://localhost:3000`
2. 注册账号（自动赠送 7 天试用会员）
3. 设置目标位置 → 保存
4. 下载 VPN 一体化配置描述文件
5. 在 iPhone 上安装描述文件并开启 VPN

> **注意**：iOS 描述文件必须通过 **HTTPS** 下载。本地开发可用 HTTP，生产环境必须配置 HTTPS。

## 项目结构

```
apple-location/
├── server/
│   ├── index.js              # Express 入口
│   ├── config.js             # 配置
│   ├── db.js                 # SQLite 初始化
│   ├── middleware/
│   │   └── auth.js           # JWT 认证
│   ├── routes/
│   │   ├── auth.js           # 注册/登录/设备绑定/激活码
│   │   ├── location.js       # 目标位置
│   │   ├── favorites.js      # 收藏位置
│   │   ├── membership.js      # 会员状态
│   │   └── profile.js        # 描述文件/证书下载
│   ├── utils/
│   │   ├── certificates.js   # 证书生成（CA/Server/Client）
│   │   └── mobileconfig.js   # .mobileconfig 生成
│   └── data/                 # 运行时数据（git 忽略）
│       ├── app.db            # SQLite 数据库
│       ├── certs/            # 证书 PEM
│       └── keys/             # 私钥 PEM
├── public/
│   ├── index.html            # 主页面
│   ├── css/style.css         # 深色玻璃拟态样式
│   └── js/
│       ├── api.js            # API 封装
│       └── app.js            # 主逻辑
├── scripts/
│   ├── init-certificates.js  # 手动生成证书
│   └── init-db.js            # 手动初始化数据库
├── docs/
│   ├── DEPLOY.md             # 部署指南
│   └── VPN_SETUP.md          # strongSwan VPN 服务器配置
├── .env.example
└── package.json
```

## API 概览

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| POST | `/api/auth/register` | ✗ | 注册（送 7 天试用） |
| POST | `/api/auth/login` | ✗ | 登录 |
| GET | `/api/auth/me` | ✓ | 当前用户信息 |
| POST | `/api/auth/device/bind` | ✓ | 绑定设备 |
| POST | `/api/auth/activate` | ✓ | 激活码充值 |
| GET | `/api/location` | ✓ | 获取目标位置 |
| POST | `/api/location` | ✓ | 保存目标位置 |
| GET | `/api/favorites` | ✓ | 收藏列表 |
| POST | `/api/favorites` | ✓ | 添加收藏 |
| DELETE | `/api/favorites/:id` | ✓ | 删除收藏 |
| GET | `/api/membership` | ✓ | 会员状态 |
| POST | `/api/membership/bind-device` | ✓ | 会员绑定设备 |
| GET | `/api/membership/codes` | ✓ (admin) | 激活码列表 |
| POST | `/api/membership/codes` | ✓ (admin) | 生成激活码 |
| GET | `/api/vpn/profile` | ✓ | 下载 .mobileconfig |
| GET | `/api/certificate` | ✓ | 下载 Root CA .cer |
| GET | `/api/vpn/server-bundle` | ✓ (admin) | 获取服务器证书包 |

## 管理员操作

默认管理员用户名在 `.env` 中配置（`ADMIN_USERNAME=admin`，`ADMIN_PASSWORD=admin123`）。

注册一个名为 `admin` 的账号后，即可使用管理员功能：

```bash
# 生成激活码（30 天有效期）
curl -X POST http://localhost:3000/api/membership/codes \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"durationDays": 30, "count": 5}'

# 获取服务器证书包（用于 VPN 服务器部署）
curl http://localhost:3000/api/vpn/server-bundle \
  -H "Authorization: Bearer <token>"
```

## 部署

详见 [docs/DEPLOY.md](docs/DEPLOY.md)

## VPN 服务器配置

详见 [docs/VPN_SETUP.md](docs/VPN_SETUP.md)

## 工作原理

```
iPhone                    你的服务器                      Apple 定位服务
  │                          │                              │
  │── 1. 下载 .mobileconfig ──>│                              │
  │   (Root CA + IKEv2 VPN)   │                              │
  │                          │                              │
  │── 2. 安装描述文件 ─────────│                              │
  │   信任 Root CA            │                              │
  │                          │                              │
  │── 3. 连接 IKEv2 VPN ──────>│                              │
  │<──── VPN 隧道建立 ────────│                              │
  │                          │                              │
  │── 4. App 请求定位 ────────────────────────────────────────>│
  │<── 5. VPN 服务器劫持/转发定位请求，返回伪造位置 <───────────│
```

> **注意**：此项目提供完整的描述文件生成和 VPN 配置基础设施。实际的定位劫持逻辑需要在 VPN 服务器端实现（参见 VPN_SETUP.md 中的 DNS 劫持 / 代理配置部分）。

## 许可证

MIT
