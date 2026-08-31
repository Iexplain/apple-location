# strongSwan VPN 服务器配置指南

本指南介绍如何在一台 Linux 服务器上配置 strongSwan IKEv2 VPN，与本项目生成的描述文件配合使用。

## 架构

```
iPhone (描述文件) ←→ IKEv2 VPN 隧道 ←→ strongSwan 服务器 ←→ 互联网
                                        │
                                        └── DNS 劫持 → 定位 API 返回伪造位置
```

---

## 1. 安装 strongSwan

### Ubuntu / Debian

```bash
sudo apt update
sudo apt install strongswan strongswan-pki libcharon-extra-plugins libcharon-ext-auth-plugins libstrongswan-extra-plugins
```

### CentOS / RHEL

```bash
sudo yum install epel-release
sudo yum install strongswan
```

---

## 2. 部署证书

从你的 apple-location 服务获取服务器证书包：

```bash
# 在 apple-location 服务器上执行
curl https://your-domain.com/api/vpn/server-bundle \
  -H "Authorization: Bearer <admin-token>" -o server-bundle.json
```

将证书文件部署到 strongSwan 服务器：

```bash
# 服务器证书
scp server-cert.pem root@vpn-server:/etc/ipsec.d/certs/server-cert.pem

# 服务器私钥
scp server-key.pem root@vpn-server:/etc/ipsec.d/private/server-key.pem

# CA 证书
scp ca-cert.pem root@vpn-server:/etc/ipsec.d/cacerts/ca-cert.pem
```

设置权限：

```bash
sudo chmod 600 /etc/ipsec.d/private/server-key.pem
sudo chmod 644 /etc/ipsec.d/certs/server-cert.pem /etc/ipsec.d/cacerts/ca-cert.pem
```

---

## 3. 配置 ipsec.conf

编辑 `/etc/ipsec.conf`：

```ini
config setup
    charondebug="ike 1, knl 1, cfg 0"
    uniqueids=no

conn ikev2-apple-location
    auto=add
    type=tunnel
    keyexchange=ikev2

    # 证书认证
    authby=pubkey

    # 服务器端
    left=%any
    leftid=@vpn.yourdomain.com
    leftcert=server-cert.pem
    leftsendcert=always
    leftsubnet=0.0.0.0/0

    # 客户端
    right=%any
    rightid=%any
    rightauth=pubkey
    rightsourceip=10.8.1.0/24
    rightdns=8.8.8.8,8.8.4.4

    # 自动路由
    fragmentation=yes
    rekey=no
    dpdaction=clear
```

> **注意**：将 `vpn.yourdomain.com` 替换为你的实际域名，与 `.env` 中的 `VPN_SERVER_ADDRESS` 一致。
>
> `leftid` 的值必须与描述文件中 `RemoteIdentifier` 完全一致。
>
> `leftcert` 的文件名必须与 `/etc/ipsec.d/certs/` 中的证书文件名一致。

---

## 4. 配置 ipsec.secrets

如果使用证书认证，无需在 ipsec.secrets 中配置客户端密码。但需要确保服务器私钥可读：

编辑 `/etc/ipsec.secrets`：

```ini
: RSA "server-key.pem"
```

---

## 5. 防火墙配置

### UFW (Ubuntu)

```bash
sudo ufw allow 500/udp
sudo ufw allow 4500/udp
sudo ufw allow OpenSSH

# 启用 IP 转发
echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# NAT
sudo iptables -t nat -A POSTROUTING -s 10.8.1.0/24 -o eth0 -j MASQUERADE
sudo iptables -A FORWARD -s 10.8.1.0/24 -j ACCEPT
sudo iptables -A FORWARD -d 10.8.1.0/24 -j ACCEPT
```

### firewalld (CentOS)

```bash
sudo firewall-cmd --permanent --add-port=500/udp
sudo firewall-cmd --permanent --add-port=4500/udp
sudo firewall-cmd --permanent --add-masquerade
sudo firewall-cmd --reload
```

---

## 6. 启动服务

```bash
sudo systemctl restart strongswan
sudo systemctl enable strongswan
sudo systemctl status strongswan
```

查看日志：

```bash
sudo journalctl -u strongswan -f
```

---

## 7. 测试连接

1. 在 iPhone 上访问你的 apple-location 网站
2. 注册账号 → 设置位置 → 下载描述文件
3. 设置 → 通用 → VPN 与设备管理 → 安装描述文件
4. 设置 → 通用 → 关于本机 → 证书信任设置 → 信任 WKT6-2 Root CA
5. 设置 → VPN → 连接 "WKT6 定位 2"

如果连接成功，服务器日志会显示类似：

```
charon: IKEv2 connection established with <client-ip>
```

---

## 8. 定位劫持（可选高级配置）

VPN 连接建立后，所有 iPhone 网络流量通过 VPN 隧道。要实现定位伪装，需要劫持 Apple 的定位 API 请求。

### 原理

iOS 的 `locationd` 服务会通过以下方式获取位置：
1. **GPS** — 无法通过 VPN 修改
2. **Wi-Fi 定位** — 请求 Apple 的服务器（如 `gs-loc.apple.com`），通过周边 Wi-Fi MAC 地址查询位置
3. **蜂窝定位** — 通过运营商基站

Wi-Fi 定位是最常见的可劫持目标。

### 方式 A：DNS 劫持 + 自建定位 API

在 strongSwan 配置中将 `rightdns` 改为你的服务器 IP，然后在服务器上搭建 DNS 服务，将 Apple 的定位 API 域名解析到本地。

#### 1. 修改 ipsec.conf

```ini
    rightdns=10.8.1.1
```

#### 2. 安装 dnsmasq

```bash
sudo apt install dnsmasq
```

编辑 `/etc/dnsmasq.conf`：

```ini
# 监听 VPN 接口
interface=lo
listen-address=10.8.1.1

# 劫持 Apple 定位 API
address=/gs-loc.apple.com/10.8.1.1
address=/gs-loc-new.apple.com/10.8.1.1
address=/init-kt.apple.com/10.8.1.1

# 其他 DNS 转发到公共 DNS
server=8.8.8.8
server=8.8.4.4
```

#### 3. 自建定位 API

在 `10.8.1.1` 上搭建一个 HTTPS 服务，监听 Apple 定位 API 的请求，返回包含伪造坐标的响应。

Apple 的 Wi-Fi 定位 API 请求格式（`gs-loc.apple.com/location/wloc`）是二进制 plist 格式。你需要：
1. 解析请求中的 Wi-Fi MAC 地址
2. 返回你设置的伪造坐标

这部分需要额外的开发工作，超出本项目的范围。可以参考开源项目如 [apple_loc_cli](https://github.com/acheong08/Apple-iCloud-ID-Sender) 等了解协议细节。

### 方式 B：使用现成的虚拟定位工具

一些现成的工具已经实现了完整的定位劫持：
- **iAnyGo** / **iTools** — 桌面端工具，通过 USB 修改设备定位
- **3uTools** — 类似 iTools

这些工具不依赖 VPN，但需要连接电脑。

---

## 常见问题

### Q: VPN 连接失败 "Server certificate verification failed"

服务器证书的 CN 或 SAN 不匹配。检查：
1. `VPN_SERVER_ADDRESS` 与服务器证书的 CN/SAN 一致
2. `ipsec.conf` 中的 `leftid` 与描述文件中的 `RemoteIdentifier` 一致
3. CA 证书已正确部署到 `/etc/ipsec.d/cacerts/`

### Q: iPhone 提示 "未受信任的描述文件"

这是正常的。未签名的描述文件会显示警告，但仍可安装。如需签名，需要 Apple Developer 账号。

### Q: VPN 连接成功但定位没变

VPN 只建立了隧道，定位劫持需要额外配置（见第 8 节）。或者使用支持 GPS 修改的越狱插件。

### Q: 如何重置证书

删除 `server/data/certs/` 和 `server/data/keys/` 目录，重启服务即可重新生成。注意：已安装旧描述文件的 iPhone 需要重新下载安装。
