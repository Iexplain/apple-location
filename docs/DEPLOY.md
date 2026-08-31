# 部署指南

## 前提条件

- Node.js 18+ 
- 一台公网服务器（用于 VPN 服务器，需要公网 IP）
- 一个域名（指向你的服务器，用于 HTTPS 和 VPN）

> **iOS 限制**：描述文件必须通过 HTTPS 下载。VPN 服务器证书的 CN/SAN 必须匹配你的域名。

---

## 方式一：直接部署（Node.js + Caddy/Nginx 反向代理）

### 1. 安装依赖

```bash
git clone https://github.com/Iexplain/apple-location.git
cd apple-location
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
nano .env
```

关键配置：

```env
PORT=3000
JWT_SECRET=your-random-secret-string
VPN_SERVER_ADDRESS=vpn.yourdomain.com
VPN_REMOTE_ID=vpn.yourdomain.com
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-admin-password
```

### 3. 启动服务

```bash
# 前台运行（测试）
npm start

# 后台运行（推荐用 PM2）
npm install -g pm2
pm2 start server/index.js --name apple-location
pm2 save
pm2 startup
```

### 4. 配置 HTTPS 反向代理（Caddy）

Caddy 会自动申请 Let's Encrypt 证书，最简单：

```bash
# 安装 Caddy
sudo apt install caddy

# 编辑配置
sudo nano /etc/caddy/Caddyfile
```

```caddyfile
vpn.yourdomain.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl restart caddy
```

### 5. 验证

- 访问 `https://vpn.yourdomain.com` → 看到 WKT6 定位 2 页面
- 访问 `https://vpn.yourdomain.com/api/health` → 返回 `{"status":"ok"}`

---

## 方式二：Docker 部署

### 1. 创建 Dockerfile

在项目根目录创建：

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server/index.js"]
```

### 2. 构建并运行

```bash
docker build -t apple-location .
docker run -d \
  --name apple-location \
  -p 3000:3000 \
  -v $(pwd)/data:/app/server/data \
  -e JWT_SECRET=your-secret \
  -e VPN_SERVER_ADDRESS=vpn.yourdomain.com \
  --restart unless-stopped \
  apple-location
```

### 3. 配合 Caddy/Nginx 做 HTTPS

同方式一第 4 步。

---

## 环境变量说明

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | 3000 | 服务端口 |
| `JWT_SECRET` | dev-secret-change-me | JWT 签名密钥（**必须修改**） |
| `VPN_SERVER_ADDRESS` | vpn.example.com | VPN 服务器域名/IP |
| `VPN_REMOTE_ID` | 同 VPN_SERVER_ADDRESS | IKEv2 RemoteIdentifier |
| `CERT_ORGANIZATION` | Apple Location | 证书组织名 |
| `CERT_VALIDITY_DAYS` | 3650 | 证书有效期（天） |
| `ADMIN_USERNAME` | admin | 管理员用户名 |
| `ADMIN_PASSWORD` | admin123 | 管理员密码 |

---

## 部署后操作

### 1. 注册管理员账号

访问网站 → 注册 → 用户名填写你在 `.env` 中设置的 `ADMIN_USERNAME`。

### 2. 生成激活码

```bash
curl -X POST https://vpn.yourdomain.com/api/membership/codes \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"durationDays": 30, "count": 5}'
```

### 3. 获取服务器证书包

部署 VPN 服务器时需要用到：

```bash
curl https://vpn.yourdomain.com/api/vpn/server-bundle \
  -H "Authorization: Bearer <admin-token>"
```

返回包含：
- `serverCert` — 服务器证书 PEM（部署到 strongSwan）
- `serverKey` — 服务器私钥 PEM
- `caCert` — Root CA 证书 PEM

### 4. 配置 VPN 服务器

详见 [VPN_SETUP.md](VPN_SETUP.md)

---

## 数据备份

数据库和证书都在 `server/data/` 目录下：

```bash
# 备份
tar -czf backup.tar.gz server/data/

# 恢复
tar -xzf backup.tar.gz
```

> **重要**：证书的私钥文件一旦丢失，所有已安装描述文件的 iPhone 将无法连接 VPN。请妥善备份 `server/data/keys/` 目录。
