# 部署指南（公网 IP 版）

本项目可以直接使用阿里云公网 IP，不需要购买域名。网页和描述文件通过 Node 的 `8444` HTTPS 端口提供，TLS 证书由项目自己的私有 Root CA 签发。

## 前提条件

- Node.js 22+
- 阿里云公网 IP
- 安全组开放 TCP `8444`、UDP `500`、UDP `4500`
- 服务器已安装 strongSwan、dnsmasq 和 iptables

## 安装和配置

```bash
git clone https://github.com/Iexplain/apple-location.git
cd apple-location
npm ci
cp .env.example .env
```

编辑 `.env`，把 VPN 地址设置为公网 IP：

```env
NODE_ENV=production
PORT=3000
HTTP_HOST=127.0.0.1
HTTPS_HOST=0.0.0.0
HTTPS_PORT=8444
WLOC_PORT=8445
VPN_SERVER_ADDRESS=203.0.113.10
VPN_REMOTE_ID=203.0.113.10
CERT_ORGANIZATION=Virtual Location
CERT_ORGANIZATIONAL_UNIT=iOS Services
CERT_COUNTRY=CN
CERT_STATE=Beijing
CERT_LOCALITY=Beijing
CERT_VALIDITY_DAYS=3650
SERVER_BUNDLE_TOKEN=替换为随机长令牌
ADMIN_USERNAME=替换为私有管理用户名
ADMIN_PASSWORD=替换为至少16位的随机密码
```

`203.0.113.10` 是不可路由的文档示例地址，必须替换成自己的公网 IP。
`SERVER_BUNDLE_TOKEN` 用于保护返回 VPN 服务器私钥的接口。生产环境不要留空，也不要把真实值提交到 Git。
网页和管理 API 还需要 `ADMIN_USERNAME` / `ADMIN_PASSWORD` Basic Auth；生产环境用户名必须显式配置，密码至少 16 个字符。
程序会拒绝使用 `replace-with-...` 等文档占位符启动生产服务。

## 启动

```bash
npm run init-certs
npm run init-db
npm start
```

启动时会自动检查并生成四类证书：

```text
server/data/certs/ca-cert.pem
server/data/certs/server-cert.pem
server/data/certs/client-cert.pem
server/data/certs/wloc-cert.pem
```

WLOC 证书的 SAN 必须包含：

```text
gs-loc.apple.com
gs-loc-new.apple.com
gs-loc-cn.apple.com
gsp-ssl.ls.apple.com
bluedot.is.autonavi.com
bluedot.is.autonavi.com.gds.alibabadns.com
```

生产环境可以使用 PM2：

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root
# 按命令输出执行 systemctl enable pm2-root
```

`pm2 save` 保存当前进程清单，`pm2-root.service` 负责服务器重启后恢复
`apple-location`，并在 Node 进程异常退出时自动拉起。确认：

```bash
systemctl is-enabled pm2-root.service
systemctl is-active pm2-root.service
pm2 status
```

## 访问地址

手机使用 Wi-Fi 或流量访问：

```text
https://<你的公网IP>:8444
```

首次访问自签名 HTTPS 证书时，Safari 会显示证书警告。确认地址正确后继续访问，再下载 `virtual-location.mobileconfig`。

网页和管理 API 受 Basic Auth 保护；按浏览器提示填写 `.env` 中的
`ADMIN_USERNAME` / `ADMIN_PASSWORD`。只有 `/api/health` 对外公开。

安装描述文件后：

1. 在“VPN 与设备管理”中安装描述文件。
2. 在“证书信任设置”中完全信任 `Virtual Location Root CA`。
3. 连接 `Virtual Location` VPN。

## 定位劫持网络

VPN 内部地址使用 `10.8.1.0/24`：

```text
服务器内部地址：10.8.1.1
客户端地址池：10.8.1.2 - 10.8.1.254
客户端 DNS：10.8.1.1
WLOC 服务：127.0.0.1:8445
```

dnsmasq 将以下 Apple 定位域名解析到 `10.8.1.1`：

```text
gs-loc.apple.com
gs-loc-new.apple.com
gs-loc-cn.apple.com
gsp-ssl.ls.apple.com
bluedot.is.autonavi.com
bluedot.is.autonavi.com.gds.alibabadns.com
```

iptables 将 VPN 客户端访问的 `10.8.1.1:443` DNAT 到 `127.0.0.1:8445`。如果服务器还运行 Docker，这条规则必须位于 Docker 的 `PREROUTING ... -j DOCKER` 规则之前，否则请求可能被 Docker 的公网 443 映射抢走。TCP `8445` 不需要对公网开放。

仓库提供了可重复执行的 `scripts/apple-location-vpn-nat.sh` 和
`conf/vpn-nat.service`。将脚本安装到 `/usr/local/sbin/`、unit 安装到
`/etc/systemd/system/` 后启用它，可在每次开机时恢复 IP 转发、VPN 客户端
NAT、WLOC DNAT 和 Docker 规则顺序：

```bash
sudo install -m 0755 scripts/apple-location-vpn-nat.sh /usr/local/sbin/apple-location-vpn-nat
sudo install -m 0644 conf/vpn-nat.service /etc/systemd/system/vpn-nat.service
sudo systemctl daemon-reload
sudo systemctl enable --now vpn-nat.service
systemctl is-enabled vpn-nat.service
systemctl is-active vpn-nat.service
```

## 验证

```bash
curl http://127.0.0.1:3000/api/health
curl -k https://127.0.0.1:8444/api/health
ss -ltnp | grep -E ':(3000|8444|8445)\\b'
dig @10.8.1.1 gs-loc.apple.com
dig @10.8.1.1 gs-loc-cn.apple.com
swanctl --list-conns
swanctl --list-sas
```

健康检查返回的 `wloc` 必须为 `true`（否则返回 HTTP 503）。iPhone 连接 VPN 后，`swanctl --list-sas` 应出现活动会话，PM2 日志应出现 `[wloc]` 请求记录。

## 证书和数据备份

```bash
tar -czf backup.tar.gz server/data/ .env
```

尤其要备份：

```text
server/data/keys/ca-key.pem
server/data/keys/server-key.pem
server/data/keys/client-key.pem
server/data/keys/wloc-key.pem
server/data/app.db
```

不要删除现有 Root CA。重新生成 Root CA 会使已经安装的 iPhone 描述文件失效。

`.env`、`server/data/`、下载后的 `.mobileconfig` 和任何导出的 PKCS#12/证书包都属于敏感文件。`.mobileconfig` 内含 VPN 客户端私钥，不能公开分享。

## 安全边界

- TCP `8444` 是网页和 profile 下载入口。
- TCP `3000` 应只允许本机访问或由安全组限制。
- TCP `8445` 只监听 `127.0.0.1`，不应开放公网。
- `/api/vpn/server-bundle` 必须使用 `Authorization: Bearer <SERVER_BUNDLE_TOKEN>`。
- `server-bundle` 包含服务器私钥，只能在可信环境中调用。
- 仓库只应保存占位符；实际用户名、密码和令牌只能放在未被 Git 跟踪的 `.env` 中。

## 限制

VPN 和 WLOC 可以修改上游响应中的 Wi-Fi 和部分蜂窝位置，但不能直接修改 GPS，也不保证覆盖系统缓存、第三方 App 自有接口或 Apple 的其他校验。
