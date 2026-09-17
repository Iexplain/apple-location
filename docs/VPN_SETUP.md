# strongSwan VPN 服务器配置指南

本指南介绍如何在一台 Linux 服务器上配置 strongSwan IKEv2 VPN，与本项目生成的描述文件配合使用。项目支持直接使用公网 IP，不需要域名。

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

服务器证书和私钥已经由项目生成。若从 API 获取证书包，需要使用 `.env` 中的 `SERVER_BUNDLE_TOKEN`：

```bash
# 在 apple-location 服务器上执行
curl -k https://203.0.113.10:8444/api/vpn/server-bundle \
  -H "Authorization: Bearer <SERVER_BUNDLE_TOKEN>" -o server-bundle.json
```

将证书文件部署到 strongSwan 服务器：

```bash
# 服务器证书
scp server-cert.pem root@vpn-server:/etc/swanctl/x509/server-cert.pem

# 服务器私钥
scp server-key.pem root@vpn-server:/etc/swanctl/private/server-key.pem

# CA 证书
scp ca-cert.pem root@vpn-server:/etc/swanctl/x509ca/ca-cert.pem
```

设置权限：

```bash
sudo chmod 600 /etc/swanctl/private/server-key.pem
sudo chmod 644 /etc/swanctl/x509/server-cert.pem /etc/swanctl/x509ca/ca-cert.pem
```

---

## 3. 配置 swanctl

当前项目使用 strongSwan 的 swanctl 配置格式。将仓库中的 `conf/swanctl-apple-location.conf` 复制到 `/etc/swanctl/conf.d/`，并确认其中的公网 IP 与 `.env` 中的 `VPN_SERVER_ADDRESS` 一致：

```ini
connections {
    apple-location {
        version = 2
        proposals = aes256-sha256-modp2048
        pools = vpn_pool
        fragmentation = no
        local {
            auth = pubkey
            certs = server-cert.pem
            # 203.0.113.10 是文档示例；替换成自己的公网 IP。
            id = 203.0.113.10
        }
        remote {
            auth = pubkey
            # Explicitly trust the CA that issued the client certificate.
            cacerts = ca.crt
            id = apple-location-client
        }
        children {
            net {
                local_ts = 0.0.0.0/0
                esp_proposals = aes256-sha256
                dpd_action = clear
            }
        }
    }
}

pools {
    vpn_pool {
        addrs = 10.8.1.2-10.8.1.254
        dns = 10.8.1.1
    }
}

secrets {
    private-server { file = server-key.pem }
}
```

`id` 必须与描述文件中的 `RemoteIdentifier` 完全一致。服务器证书必须包含公网 IP 的 IP SAN，而不是 DNS SAN。

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

1. 在 iPhone 上访问 `https://<你的公网IP>:8444`
2. 设置位置 → 下载描述文件
3. 设置 → 通用 → VPN 与设备管理 → 安装描述文件
4. 设置 → 通用 → 关于本机 → 证书信任设置 → 信任 Virtual Location Root CA
5. 设置 → VPN → 连接 "Virtual Location"

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

### DNS 劫持 + 内置 WLOC 定位 API

在 swanctl 地址池中将客户端 DNS 设置为 `10.8.1.1`，然后在服务器上搭建 DNS 服务，将 Apple/高德的定位 API 域名解析到该 VPN 内部地址。

#### 1. 确认 swanctl 的客户端 DNS

```ini
    dns = 10.8.1.1
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
address=/gs-loc-cn.apple.com/10.8.1.1
address=/gsp-ssl.ls.apple.com/10.8.1.1
address=/bluedot.is.autonavi.com/10.8.1.1
address=/bluedot.is.autonavi.com.gds.alibabadns.com/10.8.1.1

# 其他 DNS 转发到公共 DNS
server=8.8.8.8
server=8.8.4.4
```

#### 3. 内置 WLOC 定位 API

项目内置 WLOC HTTPS 服务，监听 `127.0.0.1:8445`。iptables 将 VPN 客户端访问的 `10.8.1.1:443` 转发到该端口。

Apple 的 Wi-Fi 定位 API（`/clls/wloc`）使用带长度前缀的 protobuf 格式。内置 WLOC 服务会把原始请求转发给固定的 Apple/高德定位上游，并只替换有效响应中的经纬度和精度字段。

服务启动后会从 `server/data/app.db` 读取网页上设置的坐标，保留上游响应的字段结构，并替换其中 Wi-Fi 和部分蜂窝位置消息的经纬度与精度。

WLOC 证书由私有 Root CA 签发，叶子证书有效期不超过 397 天。iPhone 必须在“证书信任设置”中对 Root CA 开启完全信任，否则 VPN 可能连接成功，但 WLOC HTTPS 握手会失败。

如果服务器运行 Docker，WLOC DNAT 必须插入 Docker 规则之前：

```bash
sudo iptables -t nat -I PREROUTING 1 \
  -s 10.8.1.0/24 -d 10.8.1.1/32 -p tcp --dport 443 \
  -j DNAT --to-destination 127.0.0.1:8445
```

添加后使用 `iptables -t nat -vnL PREROUTING --line-numbers` 确认 WLOC 规则排在 `DOCKER` 规则前面，并按发行版的方式持久化规则。

### 方式 B：使用现成的虚拟定位工具

一些现成的工具已经实现了完整的定位劫持：
- **iAnyGo** / **iTools** — 桌面端工具，通过 USB 修改设备定位
- **3uTools** — 类似 iTools

这些工具不依赖 VPN，但需要连接电脑。

---

## 常见问题

### Q: VPN 连接失败 "Server certificate verification failed"

服务器证书的 CN 或 SAN 不匹配。检查：
1. `VPN_SERVER_ADDRESS` 与服务器证书的 CN/IP SAN 一致
2. swanctl 配置中的 `id` 与描述文件中的 `RemoteIdentifier` 一致
3. CA 证书已正确部署到 `/etc/swanctl/x509ca/`

### Q: iPhone 提示 "未受信任的描述文件"

这是正常的。未签名的描述文件会显示警告，但仍可安装。如需签名，需要 Apple Developer 账号。

### Q: VPN 连接成功但定位没变

VPN 只建立了隧道，定位劫持需要额外配置（见第 8 节）。或者使用支持 GPS 修改的越狱插件。

只有日志出现新的 `[wloc] → <纬度>,<经度>` 才能确认定位请求真正被处理。VPN 显示已连接本身不足以证明虚拟定位已经生效。

### Q: 如何重置证书

不要删除现有 Root CA。只在确认需要轮换时删除 server/client/WLOC 证书和私钥，然后重启服务；已安装旧描述文件的 iPhone 需要重新下载安装。
