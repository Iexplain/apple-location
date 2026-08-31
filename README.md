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

## 部署

详见 [docs/DEPLOY.md](docs/DEPLOY.md)

## VPN 服务器配置

详见 [docs/VPN_SETUP.md](docs/VPN_SETUP.md)

## 工作原理

```
iPhone → 下载 .mobileconfig (Root CA + IKEv2 VPN) → 安装描述文件 → 连接 VPN → 定位伪装
```

VPN 服务器端的定位劫持逻辑需要额外配置（DNS 劫持 + 自建定位 API），详见 VPN_SETUP.md 第 8 节。

## 许可证

MIT
