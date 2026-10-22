# dsh-lan-remote

Expose the running DeepSeek Harness web GUI to your LAN so a phone can drive **the same** session (not a second harness instance). With Tailscale on both machines it also works when the phone is on another network.

[![license](https://img.shields.io/badge/license-MIT-0f172a)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1%2B-2f6fed)](https://github.com/deepseek-ai/deepseek-harness)
[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-topic-2f6fed)](https://github.com/topics/dsh-plugin)

English | [中文](README.zh.md)

The desktop build binds its web server to `127.0.0.1` and rejects wildcard addresses such as `0.0.0.0`. This plugin leaves that binding alone and starts a reverse proxy on `0.0.0.0:<port>` that forwards to the host's loopback port, so the phone talks to the instance the desktop app is already using.

## Features

- Reverse proxy: LAN port → `127.0.0.1:<webServer.port>`, rewriting `Host` / `Origin` / `Referer` to pass the host's auth fence (WebSocket upgrades forwarded too).
- Two URLs: the card shows both the LAN URL (same Wi-Fi) and the Tailscale URL (any network), each with its own copy button. The remote URL appears as soon as this machine is signed in to Tailscale.
- Floating handset button: bottom-right of the page, draggable, remembers its position; opens a card showing the current URL, a copy button and a re-detect action.
- Announcements: on start it writes a desktop file and shows a toast; email is optional (manual button or automatic on start).
- Mail settings: fill in your own SMTP server, port, account, app password and recipient from the card. Stored under the plugin's `data/` directory (password encrypted with Windows DPAPI). **No preset account ships with the plugin.**
- Status endpoints: `GET /dsh-lan-remote/api/status`, `GET/POST /dsh-lan-remote/api/mail`, `POST /dsh-lan-remote/api/mail/config`, `POST /dsh-lan-remote/api/restart`.

## Install

```bash
dsh plugin --profile <profile> add github:1731988818/dsh-lan-remote
```

`dsh plugin add` writes it into the profile's `dependencies` and `dsh.profile.bundles`, so it starts with the harness after a reload; `dsh plugin remove` unregisters it. You can also link the directory into `<profile>/node_modules/` and register it yourself.

## Configuration

Override defaults in `<profile>/cordis.patch.yml`:

```yaml
- id: dsh-lan-remote
  config:
    enabled: true
    listen: 0.0.0.0        # proxy listen address
    port: 62991            # proxy port (tries the next 20 when busy)
    address: null          # pin a LAN IPv4, null = auto detect
    notify:
      desktopFile: true
      toast: true
      mail: true           # send a mail on start
      mailConfig: null     # mail config path, defaults to data/notify.config.json
```

## Remote access (Tailscale)

The proxy listens on `0.0.0.0`, so any address on any local interface works. Tailscale provides a way to reach it from another network without a public IP or a tunnel service:

1. Install [Tailscale](https://tailscale.com/download) on both the computer and the phone, signed in to **the same account**.
2. On the computer, `tailscale status` should show it online; note its `100.x.y.z` address (the plugin reads it automatically — that's the "异地（Tailscale）" entry in the card).
3. Keep Tailscale connected on the phone and open the second URL.

Emails and the desktop file also list both addresses. If the card shows no remote URL, Tailscale isn't running or signed in on this machine; after signing in, reopen the card or press re-detect.

## Notes

- The `?token=` in the URL is a credential equivalent to a login session; don't share or screenshot it.
- Plain HTTP by default — use it on trusted networks or inside your Tailscale tailnet only; add TLS or a tunnel for the public internet.
- The Tailscale URL sits behind the same auth fence: a bare IP returns 401, so the full token URL is required.
- The phone needs the full token URL once; the browser then keeps a 30-day session.
- After sleep or a network switch, press the re-detect button to refresh the address.

MIT
