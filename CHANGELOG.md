# Changelog

Versions follow the git history of this repository. Every release is a tag on `master`. **v1.1.0 is the first public release.**

## 1.1.1

- Fix: the remote (Tailscale) address is only accepted from the `100.64.0.0/10` range Tailscale actually assigns. With the daemon stopped, the adapter keeps only a `169.254.x.x` link-local address, which was previously reported as the remote URL — the card and the announced links then pointed at a host no phone can reach. The card now shows "本机未登录 Tailscale" instead, and picks the real address up again on the next restart once the daemon is running.

## 1.1.0

- Remote access over Tailscale: when this machine is signed in to Tailscale, the plugin detects its `100.x.y.z` address and exposes a second token URL, so a phone on another network can reach the same session. The card lists both URLs (LAN + Tailscale) with their own copy buttons, and the desktop file / email / toast announce both.
- `notify.ps1` gained `-RemoteUrl`; the desktop file and mail body now carry a "同一 Wi-Fi" and an "异地（Tailscale）" section instead of a single LAN line.
- `GET /dsh-lan-remote/api/status` now returns `remoteHost`, `remoteUrl` and `tailscale: { available, ip }`.

## 1.0.0

- Initial release: a loopback reverse proxy that exposes the running DeepSeek Harness web GUI to the LAN under the host's own launch token, so a phone drives the same session instead of booting a second harness.
- Floating handset button on the page: shows the token URL, copies it, re-detects the LAN address; draggable, remembers its position, closes when you click elsewhere.
- Announcements on start: a desktop shortcut file and a toast; email is optional.
- Optional SMTP mail with a manual "send now" button and an in-card settings form (server, port, account, app password, recipient). No account is preset; the password is stored with Windows DPAPI.
- HTTP endpoints: `GET /dsh-lan-remote/api/status`, `GET|POST /dsh-lan-remote/api/mail`, `POST /dsh-lan-remote/api/mail/config`, `POST /dsh-lan-remote/api/restart`.
