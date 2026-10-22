# dsh-lan-remote

把正在运行的 DeepSeek Harness Web GUI 暴露到局域网，让手机访问**同一个**会话（不是另起一个 harness）；本机与手机都装 Tailscale 时，不在同一网络也能连。

[![license](https://img.shields.io/badge/license-MIT-0f172a)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1%2B-2f6fed)](https://github.com/deepseek-ai/deepseek-harness)
[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-topic-2f6fed)](https://github.com/topics/dsh-plugin)

[English](README.md) | 中文

DeepSeek Harness 桌面版把 web 服务绑定在 `127.0.0.1`，且拒绝 `0.0.0.0` 之类的通配地址。本插件不改变宿主绑定，而是在 `0.0.0.0:<端口>` 上起一个反向代理，把请求转发到宿主正在监听的 loopback 端口，因此手机打开的就是桌面端当前那一个实例。

## 功能

- 反向代理：LAN 端口 → `127.0.0.1:<webServer.port>`，自动改写 `Host` / `Origin` / `Referer` 并通过宿主的认证围栏（WebSocket upgrade 同样转发）。
- 两条地址：卡片里同时给出「局域网（同一 Wi-Fi）」与「异地（Tailscale）」两个带 token 的地址，各自可一键复制。异地地址在本机 Tailscale 已登录时自动出现。
- 浮动听筒按钮：页面右下角（可拖动，位置记忆），点开后显示当前访问地址、复制按钮与「重新探测」。
- 地址通知：插件启动时写桌面文件、弹通知气泡；可选发送邮件（手动按钮或启动时自动发）。
- 邮件设置：卡片内「邮件设置」自行填写 SMTP 服务器、端口、发件账号、授权码与收件地址，保存在插件目录 `data/` 下（授权码用 Windows DPAPI 加密）。**不含任何预置账号**，每个使用者填自己的。
- 状态接口：`GET /dsh-lan-remote/api/status`、`GET/POST /dsh-lan-remote/api/mail`、`POST /dsh-lan-remote/api/mail/config`、`POST /dsh-lan-remote/api/restart`。

## 安装

```bash
dsh plugin --profile <profile> add github:1731988818/dsh-lan-remote
```

`dsh plugin add` 会把它写进 profile 的 `dependencies` 和 `dsh.profile.bundles`，重载后插件随 harness 启动；`dsh plugin remove` 反过来注销。也可以把目录链接到 `<profile>/node_modules/` 后自行登记。

## 配置

在 `<profile>/cordis.patch.yml` 中可覆盖默认值：

```yaml
- id: dsh-lan-remote
  config:
    enabled: true
    listen: 0.0.0.0        # 反代监听地址
    port: 62991            # 反代端口（被占用时自动顺延 20 个）
    address: null          # 固定使用的 LAN IPv4，null 为自动探测
    notify:
      desktopFile: true
      toast: true
      mail: true           # 启动时是否自动发邮件
      mailConfig: null     # 邮件配置文件路径，默认 data/notify.config.json
```

## 异地访问（Tailscale）

反代监听的是 `0.0.0.0`，因此本机任何一块网卡上的地址都能用。Tailscale 提供了一条不用公网 IP、不用内网穿透的组网通道：

1. 电脑与手机都安装 [Tailscale](https://tailscale.com/download)，用**同一个账号**登录。
2. 电脑上确认 `tailscale status` 里自己是在线状态，记下本机 `100.x.y.z` 地址（插件会自动读取，卡片里「异地（Tailscale）」那一条就是它）。
3. 手机打开 Tailscale（保持连接），用第二条地址访问即可。

发邮件、桌面文件里也会同时写上两条地址，出门前在手机上看一眼就行。若插件没显示异地地址，说明本机 Tailscale 未登录或未启动，登录后打开卡片会自动刷新（或点「重新探测」）。

## 注意

- 地址里的 `?token=` 是访问凭证，等同于登录态，不要外发或截图分享。
- 默认明文 HTTP，仅建议在可信局域网或 Tailscale 私网内使用；跨公网请自行加 TLS 或改用隧道。
- Tailscale 地址同样受这一层认证保护：裸 IP 访问返回 401，必须用带 token 的完整地址。
- 手机端首次访问需要带 token 的完整地址，访问一次后浏览器会保持 30 天登录态。
- 电脑睡眠/切换网络后，点「重新探测」即可刷新地址。

MIT
