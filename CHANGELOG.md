# Changelog

Versions follow the git history of this repository. Every release is a tag on `master`.

## 1.0.0

- Initial release: a loopback reverse proxy that exposes the running DeepSeek Harness web GUI to the LAN under the host's own launch token, so a phone drives the same session instead of booting a second harness.
- Floating handset button on the page: shows the token URL, copies it, re-detects the LAN address; draggable, remembers its position, closes when you click elsewhere.
- Announcements on start: a desktop shortcut file and a toast; email is optional.
- Optional SMTP mail with a manual "send now" button and an in-card settings form (server, port, account, app password, recipient). No account is preset; the password is stored with Windows DPAPI.
- HTTP endpoints: `GET /dsh-lan-remote/api/status`, `GET|POST /dsh-lan-remote/api/mail`, `POST /dsh-lan-remote/api/mail/config`, `POST /dsh-lan-remote/api/restart`.
