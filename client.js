// Client half: a small handset button pinned above the composer area, which
// opens a card with the LAN address, a copy action and a re-probe action.
// The button can be dragged; its position is remembered in localStorage.
window.__ModuleLoader__.load({
  id: 'dsh-lan-remote',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const ROUTE = '/dsh-lan-remote/api/status'
    const RESTART_ROUTE = '/dsh-lan-remote/api/restart'
    const MAIL_ROUTE = '/dsh-lan-remote/api/mail'
    const MAIL_CONFIG_ROUTE = '/dsh-lan-remote/api/mail/config'
    const POS_KEY = 'dsh-lan-remote:pos'

    const mutedColor = 'var(--dsw-alias-label-secondary, #6b7280)'
    const successColor = 'var(--dsw-alias-state-success-primary, #16a34a)'
    const errorColor = 'var(--dsw-alias-state-error-primary, #dc2626)'
    const warnColor = 'var(--dsw-alias-state-warn-primary, #d97706)'

    const FONT = '13px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

    // Always injected (also while collapsed) so the host skin cannot paint a
    // focus ring, white border or background onto the handset button.
    const OVERLAY_CSS = [
      '@keyframes dsh-lan-remote-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
      '.dsh-lan-remote-iconbtn:hover{background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.06))!important}',
      '.dsh-lan-remote-action:hover{filter:brightness(1.08)}',
      '.dsh-lan-remote-action:active{filter:brightness(.94)}',
      'html body button.dsh-lan-remote-handset,html body button.dsh-lan-remote-handset:hover,html body button.dsh-lan-remote-handset:active,html body button.dsh-lan-remote-handset:focus,html body button.dsh-lan-remote-handset:focus-visible{outline:0 none!important;outline-offset:0!important;border:0 none!important;box-shadow:none!important;-webkit-tap-highlight-color:transparent!important;-webkit-appearance:none!important;appearance:none!important}',
      'html body button.dsh-lan-remote-handset{background:transparent!important;color:#ffffff!important;box-shadow:none!important}',
      'html body button.dsh-lan-remote-handset:hover,html body button.dsh-lan-remote-handset:active{background:transparent!important;color:#ffffff!important;box-shadow:none!important}',
    ].join('')

    const iconPhone = h(
      'svg',
      { viewBox: '0 0 24 24', width: 21, height: 21, fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' },
      h('path', {
        d: 'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z',
      }),
    )

    const iconRefresh = h(
      'svg',
      { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' },
      h('path', {
        d: 'M17.65 6.35A7.958 7.958 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
      }),
    )

    const iconCopy = h(
      'svg',
      { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' },
      h('path', {
        d: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
      }),
    )

    const iconClose = h(
      'svg',
      { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' },
      h('path', {
        d: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
      }),
    )

    const iconMail = h(
      'svg',
      { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' },
      h('path', {
        d: 'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z',
      }),
    )

    const iconGear = h(
      'svg',
      { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' },
      h('path', {
        d: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
      }),
    )

    function readPos() {
      try {
        const raw = window.localStorage.getItem(POS_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (typeof parsed?.left === 'number' && typeof parsed?.bottom === 'number') return parsed
      } catch {
        /* ignore */
      }
      return null
    }

    function useStatus() {
      const [data, setData] = useState(null)
      const [failed, setFailed] = useState(false)
      const alive = useRef(true)

      const load = useCallback(async () => {
        try {
          const response = await fetch(ROUTE, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(String(response.status))
          const body = await response.json()
          if (alive.current) {
            setData(body)
            setFailed(false)
          }
        } catch {
          if (alive.current) setFailed(true)
        }
      }, [])

      useEffect(() => {
        alive.current = true
        void load()
        const timer = setInterval(() => { void load() }, 4000)
        return () => {
          alive.current = false
          clearInterval(timer)
        }
      }, [load])

      return { data, failed, reload: load }
    }

    function LanRemoteCard() {
      const { data, failed, reload } = useStatus()
      const [open, setOpen] = useState(false)
      const [copied, setCopied] = useState(false)
      const [copiedRemote, setCopiedRemote] = useState(false)
      const [busy, setBusy] = useState(false)
      const [feedback, setFeedback] = useState(null)
      const [hover, setHover] = useState(false)
      const [pos, setPos] = useState(() => readPos() ?? { left: 16, bottom: 120 })
      const [view, setView] = useState('main')
      const [mail, setMail] = useState(null)
      const [mailBusy, setMailBusy] = useState(false)
      const [mailMsg, setMailMsg] = useState(null)
      const [form, setForm] = useState({ smtpServer: 'smtp.qq.com', port: '587', user: '', to: '', password: '' })

      const drag = useRef(null)
      const feedbackTimer = useRef(null)
      const panelRef = useRef(null)
      const buttonRef = useRef(null)

      const running = Boolean(data?.running)
      const url = data?.url ?? ''
      const remoteUrl = data?.remoteUrl ?? ''
      const tailscale = data?.tailscale ?? null
      const error = data?.error ?? null
      const dot = failed ? errorColor : running ? successColor : warnColor
      const statusText = failed
        ? 'Host 未响应'
        : running
          ? `监听 ${data.listenHost}:${data.listenPort} → ${data.targetHost}:${data.targetPort}`
          : error ?? '尚未启动'

      const flash = useCallback((kind) => {
        setFeedback(kind)
        if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
        feedbackTimer.current = setTimeout(() => setFeedback(null), 2200)
      }, [])

      useEffect(() => () => {
        if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
      }, [])

      useEffect(() => {
        try {
          window.localStorage.setItem(POS_KEY, JSON.stringify(pos))
        } catch {
          /* ignore */
        }
      }, [pos])

      // Close the card when the pointer goes down anywhere outside of it.
      useEffect(() => {
        if (!open) return undefined
        const onPointer = (event) => {
          const target = event.target
          if (panelRef.current?.contains(target)) return
          if (buttonRef.current?.contains(target)) return
          setOpen(false)
        }
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointer, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('pointerdown', onPointer, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [open])

      // Drag the handset button: a movement below 4px still counts as a click.
      const onPointerDown = useCallback((event) => {
        if (event.button !== 0) return
        const startX = event.clientX
        const startY = event.clientY
        const origin = { left: pos.left, bottom: pos.bottom }
        let moved = false
        drag.current = { moved: false }
        const node = event.currentTarget
        try { node.setPointerCapture(event.pointerId) } catch { /* ignore */ }

        const onMove = (moveEvent) => {
          const dx = moveEvent.clientX - startX
          const dy = moveEvent.clientY - startY
          if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return
          moved = true
          if (drag.current) drag.current.moved = true
          const maxLeft = Math.max(0, window.innerWidth - 60)
          const maxBottom = Math.max(0, window.innerHeight - 60)
          setPos({
            left: Math.min(maxLeft, Math.max(0, origin.left + dx)),
            bottom: Math.min(maxBottom, Math.max(0, origin.bottom - dy)),
          })
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
          try { node.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
          drag.current = null
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
      }, [pos.left, pos.bottom])

      const onClick = useCallback(() => {
        if (drag.current?.moved) return
        setOpen((value) => !value)
      }, [])

      const copy = useCallback(async (text, which) => {
        if (!text) return
        try {
          await navigator.clipboard.writeText(text)
          const setter = which === 'remote' ? setCopiedRemote : setCopied
          setter(true)
          setTimeout(() => setter(false), 1600)
        } catch {
          flash('fail')
        }
      }, [flash])

      const probe = useCallback(async () => {
        if (busy) return
        setBusy(true)
        setFeedback(null)
        try {
          const response = await fetch(RESTART_ROUTE, { method: 'POST', headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(String(response.status))
          flash('ok')
        } catch {
          flash('fail')
        } finally {
          setBusy(false)
          void reload()
        }
      }, [busy, flash, reload])

      const loadMail = useCallback(async () => {
        try {
          const response = await fetch(MAIL_ROUTE, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(String(response.status))
          const body = await response.json()
          setMail(body)
          setForm((prev) => ({
            ...prev,
            smtpServer: body.smtpServer || prev.smtpServer,
            port: String(body.port || prev.port),
            user: body.user || prev.user,
            to: body.to || prev.to,
          }))
        } catch {
          setMail({ configured: false, authSet: false, error: '无法读取邮件设置' })
        }
      }, [])

      useEffect(() => {
        if (!open) return
        void loadMail()
      }, [open, loadMail])

      const saveMail = useCallback(async () => {
        if (mailBusy) return
        setMailBusy(true)
        setMailMsg(null)
        try {
          const response = await fetch(MAIL_CONFIG_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              smtpServer: form.smtpServer,
              port: Number(form.port) || 587,
              user: form.user,
              to: form.to,
              password: form.password,
            }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok || body.ok !== true) throw new Error(body.error || String(response.status))
          setMail(body)
          setForm((prev) => ({ ...prev, password: '' }))
          setMailMsg({ kind: 'ok', text: '✓ 已保存' + (body.authSet ? '（含授权码）' : '') })
        } catch (error) {
          setMailMsg({ kind: 'fail', text: '✗ 保存失败：' + (error?.message ?? '未知错误') })
        } finally {
          setMailBusy(false)
        }
      }, [form, mailBusy])

      const sendMail = useCallback(async () => {
        if (mailBusy) return
        if (!url) {
          setMailMsg({ kind: 'fail', text: '✗ 地址尚未就绪' })
          return
        }
        setMailBusy(true)
        setMailMsg(null)
        try {
          const response = await fetch(MAIL_ROUTE, { method: 'POST', headers: { accept: 'application/json' } })
          const body = await response.json().catch(() => ({}))
          if (!response.ok || body.ok !== true) throw new Error(body.error || String(response.status))
          setMailMsg({ kind: 'ok', text: `✓ 已发送到 ${body.to ?? '收件箱'}` })
        } catch (error) {
          setMailMsg({ kind: 'fail', text: '✗ 发送失败：' + (error?.message ?? '未知错误') })
        } finally {
          setMailBusy(false)
        }
      }, [mailBusy, url])

      const handsetStyle = {
        position: 'fixed',
        left: pos.left + 'px',
        bottom: pos.bottom + 'px',
        zIndex: 2147482800,
        width: '46px',
        height: '46px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        padding: 0,
        borderRadius: '999px',
        border: '0 none',
        outline: '0 none',
        background: 'transparent',
        color: '#ffffff',
        opacity: hover ? 1 : 0.82,
        cursor: 'grab',
        touchAction: 'none',
        pointerEvents: 'auto',
        boxShadow: 'none',
        WebkitTapHighlightColor: 'transparent',
        WebkitAppearance: 'none',
        appearance: 'none',
        transform: hover ? 'scale(1.06)' : 'none',
        transition: 'transform .12s ease, opacity .12s ease, background .12s ease, color .12s ease, box-shadow .12s ease',
      }

      const panelStyle = {
        position: 'fixed',
        left: Math.min(pos.left, Math.max(8, window.innerWidth - 348)) + 'px',
        bottom: pos.bottom + 56 + 'px',
        zIndex: 2147482801,
        display: 'flex',
        flexDirection: 'column',
        gap: '9px',
        width: '336px',
        maxWidth: 'calc(100vw - 24px)',
        padding: '12px 14px 13px',
        boxSizing: 'border-box',
        borderRadius: '14px',
        background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
        border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))',
        boxShadow: '0 14px 38px rgba(0,0,0,.22)',
        color: 'var(--dsw-alias-label-primary, #111827)',
        font: FONT,
        pointerEvents: 'auto',
        animation: 'dsh-lan-remote-in .14s ease-out',
      }

      const headerStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }
      const titleStyle = { fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '7px' }
      const dotStyle = {
        width: '8px',
        height: '8px',
        borderRadius: '999px',
        background: dot,
        boxShadow: `0 0 0 3px ${dot}22`,
        flex: 'none',
      }
      const iconButton = (danger) => ({
        width: '30px',
        height: '30px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        borderRadius: '999px',
        border: 'none',
        background: 'transparent',
        color: danger ? errorColor : mutedColor,
        cursor: 'pointer',
        transition: 'background .12s ease, color .12s ease',
      })
      const urlStyle = {
        width: '100%',
        boxSizing: 'border-box',
        padding: '7px 9px',
        borderRadius: '9px',
        border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))',
        background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,.03))',
        color: 'var(--dsw-alias-label-primary, #111827)',
        font: '12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        resize: 'none',
        wordBreak: 'break-all',
      }
      const actionRow = { display: 'flex', gap: '8px', alignItems: 'stretch' }
      const sectionLabel = {
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '.02em',
        opacity: 0.68,
        marginTop: '2px',
      }
      const actionButton = (primary) => ({
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        flex: primary ? '1 1 auto' : 'none',
        minHeight: '34px',
        padding: '0 12px',
        borderRadius: '9px',
        border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))',
        background: primary
          ? 'var(--dsw-alias-brand-primary, #2563eb)'
          : 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,.03))',
        color: primary ? '#ffffff' : 'var(--dsw-alias-label-primary, #111827)',
        fontSize: '12.5px',
        fontWeight: 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'filter .12s ease',
      })
      const hintStyle = { fontSize: '11px', color: mutedColor, lineHeight: 1.55 }
      const feedbackStyle = {
        fontSize: '11.5px',
        lineHeight: 1.4,
        color: feedback === 'ok' ? successColor : errorColor,
        minHeight: '16px',
      }

      const handset = h(
        'button',
        {
          type: 'button',
          ref: buttonRef,
          className: 'dsh-lan-remote-handset',
          style: handsetStyle,
          title: open ? '收起局域网地址' : '局域网远程访问（可拖动）',
          'aria-label': '局域网远程访问',
          onPointerDown,
          onClick,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
        },
        h('span', { style: { display: 'inline-flex', position: 'relative' } },
          iconPhone,
          h('span', {
            style: {
              position: 'absolute',
              right: '-4px',
              top: '-3px',
              width: '9px',
              height: '9px',
              borderRadius: '999px',
              background: dot,
              border: '2px solid rgba(255,255,255,.72)',
              boxSizing: 'content-box',
            },
          }),
        ),
      )

      const styleNode = h('style', null, OVERLAY_CSS)

      const fieldStyle = {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        fontSize: '11.5px',
        color: mutedColor,
      }
      const inputStyle = {
        width: '100%',
        boxSizing: 'border-box',
        padding: '6px 9px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))',
        background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,.03))',
        color: 'var(--dsw-alias-label-primary, #111827)',
        font: '12px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        outline: 'none',
      }
      const field = (label, key, props = {}) => h(
        'label',
        { style: fieldStyle },
        label,
        h('input', {
          style: inputStyle,
          value: form[key],
          onChange: (event) => {
            // Capture the value before the updater runs: React resets
            // event.currentTarget after the handler returns, so reading it
            // inside the updater throws and unmounts the whole overlay.
            const next = event.currentTarget.value
            setForm((prev) => ({ ...prev, [key]: next }))
          },
          ...props,
        }),
      )
      const mailInfo = mail === null
        ? ''
        : mail.configured
          ? `邮件通知：${mail.to}${mail.authSet ? ' ✓' : '（未保存授权码）'}`
          : '邮件通知：未配置'

      if (!open) return h(React.Fragment, null, styleNode, handset)

      const feedbackText = feedback === 'ok' ? '✓ 已重新探测，地址已更新' : feedback === 'fail' ? '✗ 探测失败，请稍后重试' : ''

      const mailForm = h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        field('SMTP 服务器', 'smtpServer', { placeholder: 'smtp.qq.com' }),
        field('端口', 'port', { inputMode: 'numeric', placeholder: '587' }),
        field('账号（发件邮箱）', 'user', { placeholder: 'you@example.com' }),
        field('授权码 / 密码', 'password', { type: 'password', placeholder: '留空则沿用已保存的授权码' }),
        field('收件邮箱', 'to', { placeholder: 'you@example.com' }),
        h('div', { style: actionRow },
          h('button', {
            type: 'button',
            className: 'dsh-lan-remote-action',
            style: actionButton(true),
            disabled: mailBusy,
            onClick: saveMail,
          }, mailBusy ? '处理中…' : '保存'),
          h('button', {
            type: 'button',
            className: 'dsh-lan-remote-action',
            style: actionButton(false),
            disabled: mailBusy || !running,
            title: '用当前地址发一封测试邮件',
            onClick: sendMail,
          }, '测试发送'),
          h('button', {
            type: 'button',
            className: 'dsh-lan-remote-action',
            style: actionButton(false),
            onClick: () => { setView('main'); setMailMsg(null) },
          }, '返回'),
        ),
        h('div', {
          style: {
            ...feedbackStyle,
            color: mailMsg?.kind === 'ok' ? successColor : errorColor,
          },
        }, mailMsg?.text ?? ''),
        h('div', { style: hintStyle }, 'QQ 邮箱：设置 → 账户 → 开启 SMTP 服务 → 生成授权码（16 位），填到"授权码"一栏。其他邮箱填各自的 SMTP 服务器与端口（587 一般配 STARTTLS）。'),
      )

      const mainBody = h(
        React.Fragment,
        null,
        h('div', { style: hintStyle }, statusText),
        running ? h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          h('div', { style: sectionLabel }, '局域网（同一 Wi-Fi）'),
          h('textarea', {
            style: { ...urlStyle, height: '56px' },
            readOnly: true,
            value: url,
            onFocus: (event) => event.currentTarget.select(),
          }),
          h('div', { style: actionRow },
            h('button', {
              type: 'button',
              className: 'dsh-lan-remote-action',
              style: actionButton(true),
              onClick: () => copy(url, 'lan'),
            }, copied ? '✓ 已复制' : h('span', { style: { display: 'inline-flex', gap: '5px', alignItems: 'center' } }, iconCopy, '复制地址')),
            h('button', {
              type: 'button',
              className: 'dsh-lan-remote-action',
              style: actionButton(false),
              disabled: busy,
              title: '重新探测本机局域网地址',
              onClick: probe,
            }, h('span', {
              style: {
                display: 'inline-flex',
                gap: '5px',
                alignItems: 'center',
                opacity: busy ? 0.6 : 1,
              },
            }, iconRefresh, busy ? '探测中…' : '重新探测')),
          ),
          remoteUrl ? h(
            React.Fragment,
            null,
            h('div', { style: sectionLabel }, '异地（Tailscale）'),
            h('textarea', {
              style: { ...urlStyle, height: '56px' },
              readOnly: true,
              value: remoteUrl,
              onFocus: (event) => event.currentTarget.select(),
            }),
            h('div', { style: actionRow },
              h('button', {
                type: 'button',
                className: 'dsh-lan-remote-action',
                style: actionButton(true),
                onClick: () => copy(remoteUrl, 'remote'),
              }, copiedRemote ? '✓ 已复制' : h('span', { style: { display: 'inline-flex', gap: '5px', alignItems: 'center' } }, iconCopy, '复制异地地址')),
            ),
          ) : h('div', { style: hintStyle }, tailscale?.available === false
            ? '异地访问：本机未登录 Tailscale。安装 Tailscale 并用同一账号登录后，这里会自动出现异地地址（手机端也要装 Tailscale 并登录）。'
            : '异地访问：正在获取 Tailscale 地址…'),
          h('div', { style: actionRow },
            h('button', {
              type: 'button',
              className: 'dsh-lan-remote-action',
              style: actionButton(false),
              disabled: mailBusy,
              title: '把当前地址发到已配置的邮箱',
              onClick: sendMail,
            }, h('span', { style: { display: 'inline-flex', gap: '5px', alignItems: 'center' } }, iconMail, mailBusy ? '发送中…' : '发送邮件')),
            h('button', {
              type: 'button',
              className: 'dsh-lan-remote-action',
              style: actionButton(false),
              title: '配置 SMTP 服务器与授权码',
              onClick: () => { setView('mail'); setMailMsg(null) },
            }, h('span', { style: { display: 'inline-flex', gap: '5px', alignItems: 'center' } }, iconGear, '邮件设置')),
          ),
          h('div', {
            style: {
              ...feedbackStyle,
              color: mailMsg?.kind === 'ok' ? successColor : errorColor,
            },
          }, mailMsg?.text ?? feedbackText),
          h('div', { style: hintStyle }, mailInfo),
        ) : h('div', { style: hintStyle }, '反向代理尚未运行。若刚启动 harness，请稍等几秒；仍无响应可重新探测。'),
        h('div', { style: hintStyle }, '同一 Wi-Fi 用第一条地址；不在同一网络时，手机先打开 Tailscale 并登录同一账号，再用第二条异地地址。地址对应当前桌面会话，可直接在手机上操作，30 天内免再次认证。'),
      )

      return h(
        'div',
        { style: { position: 'fixed', inset: 0, zIndex: 2147482800, pointerEvents: 'none' } },
        styleNode,
        h('div', { ref: panelRef, style: panelStyle },
          h('div', { style: headerStyle },
            h('span', { style: titleStyle }, h('span', { style: dotStyle }), view === 'mail' ? '邮件通知' : '局域网远程访问'),
            h('button', {
              type: 'button',
              className: 'dsh-lan-remote-iconbtn',
              style: iconButton(false),
              title: '收起（也可点击下方听筒）',
              'aria-label': '收起',
              onClick: () => { setOpen(false); setView('main') },
            }, iconClose),
          ),
          view === 'mail' ? mailForm : mainBody,
        ),
        handset,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'dsh-lan-remote', order: 45 }, LanRemoteCard),
        )
      },
    }
  },
})
