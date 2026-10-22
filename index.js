/**
 * Host half: publish this harness's own web GUI to the LAN.
 *
 * The desktop host pins the web server to loopback, so another device can only
 * reach the same running session through a reverse proxy. The connection layer
 * binds its auth cookie to the request authority (`host:port`) and answers 403
 * to any other Host, so the proxy must rewrite Host and Origin to the upstream
 * authority; the browser's cookie is then minted against, and replayed for,
 * exactly that authority. Nothing is reissued: the token URL comes from the
 * harness's own per-process launch token, so both sides share one session.
 */
import http from 'node:http'
import net from 'node:net'
import { networkInterfaces } from 'node:os'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(HERE, 'data')
const CONFIG_PATH = join(DATA_DIR, 'config.json')
const NOTIFY_SCRIPT = join(HERE, 'notify.ps1')
const LOG_PREFIX = 'dsh-lan-remote:'

const STATUS_ROUTE = '/dsh-lan-remote/api/status'
const RESTART_ROUTE = '/dsh-lan-remote/api/restart'
const MAIL_ROUTE = '/dsh-lan-remote/api/mail'
const MAIL_CONFIG_ROUTE = '/dsh-lan-remote/api/mail/config'

const MAIL_CONFIG_PATH = join(DATA_DIR, 'notify.config.json')
const MAIL_AUTH_PATH = join(DATA_DIR, 'auth.bin')
const MAIL_CONFIG_SCRIPT = join(HERE, 'mail-config.ps1')

const DEFAULT_PORT = 62991
const PORT_SCAN = 20
const WAIT_FOR_WEB_SERVER_MS = 30_000

const DEFAULT_CONFIG = {
  enabled: true,
  listen: '0.0.0.0',
  port: DEFAULT_PORT,
  address: null,
  notify: { desktopFile: true, toast: true, mail: true, mailConfig: null },
}

// Interface names that never carry a reachable LAN address.
const VIRTUAL_HINTS = [
  'cfw', 'tun', 'tap', 'tailscale', 'wireguard', 'wg', 'utun', 'ppp', 'ipsec',
  'docker', 'veth', 'vmnet', 'vboxnet', 'vbox', 'vethernet', 'br-', 'zt',
  'wsl', 'virtual', 'loopback', 'npcap', 'clash', 'meta',
]

const state = {
  running: false,
  starting: false,
  url: null,
  lanHost: null,
  remoteHost: null,
  remoteUrl: null,
  tailscale: null,
  listenHost: null,
  listenPort: null,
  targetHost: null,
  targetPort: null,
  startedAt: null,
  error: null,
  notify: null,
  proxy: null,
}

function log(...args) {
  console.log(LOG_PREFIX, ...args)
}

function warn(...args) {
  console.error(LOG_PREFIX, ...args)
}

function authority(host, port) {
  const literal = String(host)
  return literal.includes(':') ? `[${literal}]:${port}` : `${literal}:${port}`
}

function rewriteAuthority(text, from, to) {
  return typeof text === 'string' && text.includes(from) ? text.split(from).join(to) : text
}

function isVirtualInterface(name) {
  const lower = String(name).toLowerCase()
  return VIRTUAL_HINTS.some((hint) => lower.includes(hint))
}

function isPrivateIPv4(address) {
  const [a, b] = address.split('.').map(Number)
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

/** Candidate IPv4 LAN addresses, preferred order: 192.168, 10, 172.16-31. */
function lanAddresses() {
  const found = []
  const interfaces = networkInterfaces()
  for (const [name, entries] of Object.entries(interfaces)) {
    if (isVirtualInterface(name)) continue
    for (const entry of entries ?? []) {
      if (entry.internal) continue
      if (entry.family !== 'IPv4' && entry.family !== 4) continue
      const address = entry.address
      if (address.startsWith('169.254.')) continue
      if (!isPrivateIPv4(address)) continue
      found.push({ name, address })
    }
  }
  const rank = (address) => {
    if (address.startsWith('192.168.')) return 0
    if (address.startsWith('10.')) return 1
    return 2
  }
  return found.sort((left, right) => rank(left.address) - rank(right.address))
}

/** True for the 100.64.0.0/10 CGNAT range Tailscale hands out to nodes. */
function isTailscaleIPv4(address) {
  const parts = address.split('.')
  if (parts.length !== 4) return false
  const first = Number(parts[0])
  const second = Number(parts[1])
  if (!Number.isInteger(first) || !Number.isInteger(second)) return false
  return first === 100 && second >= 64 && second <= 127
}

/** The Tailscale IPv4 of this machine, if the client is up and signed in. */
function tailscaleAddress() {
  const interfaces = networkInterfaces()
  for (const [name, entries] of Object.entries(interfaces)) {
    if (!/tailscale/i.test(name)) continue
    for (const entry of entries ?? []) {
      if (entry.internal) continue
      if (entry.family !== 'IPv4' && entry.family !== 4) continue
      if (!entry.address) continue
      // While the daemon is stopped the interface keeps only a 169.254
      // link-local address, which is useless across the tailnet.
      if (!isTailscaleIPv4(entry.address)) continue
      return entry.address
    }
  }
  return null
}

async function readConfig() {
  try {
    const raw = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      notify: { ...DEFAULT_CONFIG.notify, ...(raw.notify ?? {}) },
    }
  } catch {
    return { ...DEFAULT_CONFIG, notify: { ...DEFAULT_CONFIG.notify } }
  }
}

async function ensureDataDir() {
  try {
    await mkdir(DATA_DIR, { recursive: true })
  } catch {
    // A read-only install still works: the proxy needs no writable state.
  }
}

async function isPortFree(host, port) {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, host, () => probe.close(() => resolve(true)))
  })
}

async function pickPort(host, preferred) {
  for (let port = preferred; port < preferred + PORT_SCAN; port += 1) {
    if (await isPortFree(host, port)) return port
  }
  throw new Error(`no free port in ${preferred}..${preferred + PORT_SCAN - 1} on ${host}`)
}

function forwardHeaders(request, targetAuthority) {
  const headers = { ...request.headers }
  // The authority the browser actually used, which is what it put in Origin and
  // Referer. It is not the listen address (`0.0.0.0` is never a browser host).
  const clientAuthority = typeof headers.host === 'string' ? headers.host : null
  headers.host = targetAuthority
  if (clientAuthority) {
    for (const key of ['origin', 'referer']) {
      if (typeof headers[key] === 'string') {
        headers[key] = rewriteAuthority(headers[key], clientAuthority, targetAuthority)
      }
    }
  }
  for (const key of [
    'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
    'x-real-ip', 'forwarded', 'cf-connecting-ip',
  ]) {
    delete headers[key]
  }
  return headers
}

function responseHeaders(upstream, targetAuthority, clientAuthority) {
  const headers = { ...upstream }
  if (!clientAuthority) return headers
  for (const key of ['location', 'content-location', 'refresh']) {
    const value = headers[key]
    if (typeof value === 'string') {
      headers[key] = rewriteAuthority(value, targetAuthority, clientAuthority)
    } else if (Array.isArray(value)) {
      headers[key] = value.map((item) => rewriteAuthority(item, targetAuthority, clientAuthority))
    }
  }
  return headers
}

function createProxy({ listenHost, listenPort, targetHost, targetPort }) {
  const targetAuthority = authority(targetHost, targetPort)

  const sockets = new Set()
  const server = http.createServer((request, response) => {
    const clientAuthority = typeof request.headers.host === 'string' ? request.headers.host : null
    const upstream = http.request(
      {
        host: targetHost,
        port: targetPort,
        method: request.method,
        path: request.url,
        headers: forwardHeaders(request, targetAuthority),
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          responseHeaders(upstreamResponse.headers, targetAuthority, clientAuthority),
        )
        upstreamResponse.pipe(response)
      },
    )
    upstream.on('error', (error) => {
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        response.end(`dsh-lan-remote: upstream unavailable: ${error.message}`)
      } else {
        response.destroy()
      }
    })
    request.on('aborted', () => upstream.destroy())
    request.pipe(upstream)
  })

  server.on('upgrade', (request, socket, head) => {
    const upstream = net.connect(targetPort, targetHost, () => {
      const headers = forwardHeaders(request, targetAuthority)
      const lines = [`${request.method} ${request.url} HTTP/1.1`]
      for (const [key, value] of Object.entries(headers)) {
        if (value === undefined) continue
        lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (head?.length) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })

  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.on('clientError', (error, socket) => socket.destroy())
  server.__lanSockets = sockets
  return { server, targetAuthority }
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server) {
      resolve()
      return
    }
    const sockets = server.__lanSockets
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const destroyAll = () => {
      if (!sockets) return
      for (const socket of sockets) {
        try {
          socket.destroy()
        } catch {
          /* already gone */
        }
      }
    }
    const timer = setTimeout(() => {
      destroyAll()
      finish()
    }, 1500)
    server.close(() => finish())
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    destroyAll()
  })
}

async function waitForWebServer(ctx) {
  const deadline = Date.now() + WAIT_FOR_WEB_SERVER_MS
  while (Date.now() < deadline) {
    const port = Number(ctx.webServer?.port ?? 0)
    if (port > 0) return port
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return 0
}

function urlFor(connection, lanHost, listenPort) {
  const base = `http://${authority(lanHost, listenPort)}/`
  try {
    const authed = connection?.authenticatedUrl?.(base)
    if (typeof authed === 'string' && authed) return authed
    state.error = state.error ?? 'connection service unavailable: cannot mint the token URL'
  } catch (error) {
    state.error = `cannot mint the token URL: ${error.message}`
  }
  return base
}

function runPowerShell(args) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
      { windowsHide: true, timeout: 60_000 },
      (error, stdout, stderr) => {
        resolve({ error: error?.message ?? null, stdout: String(stdout ?? '').trim(), stderr: String(stderr ?? '').trim() })
      },
    )
  })
}

/** Run a PowerShell script and hand it a JSON payload on stdin (keeps secrets off the command line). */
function runPowerShellStdin(scriptPath, args, payload) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      { windowsHide: true },
    )
    const timer = setTimeout(() => {
      child.kill()
      finish({ code: -1, stdout: stdout.trim(), stderr: 'timeout' })
    }, 60_000)
    timer.unref?.()
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => finish({ code: -1, stdout: '', stderr: error.message }))
    child.on('close', (code) => finish({ code, stdout: stdout.trim(), stderr: stderr.trim() }))
    child.stdin?.end(payload === undefined ? '' : JSON.stringify(payload))
  })
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('payload too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  return JSON.parse(text)
}

/** Best-effort reading of the stored SMTP settings, never including the password. */
async function mailState() {
  const empty = {
    configured: false,
    smtpServer: 'smtp.qq.com',
    port: 587,
    user: '',
    to: '',
    authSet: existsSync(MAIL_AUTH_PATH),
    error: null,
  }
  if (!existsSync(MAIL_CONFIG_SCRIPT)) return { ...empty, error: 'mail-config.ps1 missing' }
  const result = await runPowerShellStdin(MAIL_CONFIG_SCRIPT, ['-Action', 'get'], {})
  if (!result.stdout) return { ...empty, error: result.stderr || 'no output' }
  try {
    const parsed = JSON.parse(result.stdout)
    return { ...empty, ...parsed, error: parsed.error ?? null }
  } catch {
    return { ...empty, error: 'unreadable mail config' }
  }
}

function readMailResult(stdout) {
  const text = String(stdout ?? '')
  const ok = /MAIL_OK\s+(\S+)/.exec(text)
  if (ok) return { ok: true, to: ok[1], error: null }
  const fail = /MAIL_FAIL\s+(.+)/.exec(text)
  if (fail) return { ok: false, to: null, error: fail[1].trim() }
  const skip = /MAIL_SKIP\s+(.+)/.exec(text)
  if (skip) return { ok: false, to: null, error: skip[1].trim() }
  return { ok: false, to: null, error: 'no result from notify.ps1' }
}

async function handleMail(request, response) {
  if (request.method === 'GET') {
    jsonResponse(response, 200, await mailState())
    return
  }
  if (request.method !== 'POST') {
    response.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'GET, POST' })
    response.end(JSON.stringify({ error: 'method-not-allowed' }))
    return
  }
  if (!state.url) {
    jsonResponse(response, 409, { ok: false, error: '地址尚未就绪，请稍后重试' })
    return
  }
  const config = await readConfig()
  const mailConfig = fallbackMailConfig(config)
  if (!mailConfig || !existsSync(mailConfig)) {
    jsonResponse(response, 409, { ok: false, error: '尚未配置 SMTP，请先在"邮件设置"里填写' })
    return
  }
  if (!existsSync(MAIL_AUTH_PATH)) {
    jsonResponse(response, 409, { ok: false, error: '缺少授权码，请先在"邮件设置"里填写密码/授权码' })
    return
  }
  const result = await runPowerShell([
    '-File', NOTIFY_SCRIPT,
    '-Url', state.url,
    ...(state.remoteUrl ? ['-RemoteUrl', state.remoteUrl] : []),
    '-DesktopFile', '0',
    '-Toast', '0',
    '-Mail', '1',
    '-MailConfig', mailConfig,
    '-LogFile', join(DATA_DIR, 'notify.log'),
  ])
  const mail = readMailResult(result.stdout)
  log('manual mail', { ok: mail.ok, to: mail.to, error: mail.error })
  jsonResponse(response, mail.ok ? 200 : 500, { ...mail, stderr: result.stderr || null })
}

async function handleMailConfig(request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'POST' })
    response.end(JSON.stringify({ error: 'method-not-allowed' }))
    return
  }
  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    jsonResponse(response, 400, { ok: false, error: error.message })
    return
  }
  if (!existsSync(MAIL_CONFIG_SCRIPT)) {
    jsonResponse(response, 500, { ok: false, error: 'mail-config.ps1 missing' })
    return
  }
  const payload = {
    smtpServer: String(body.smtpServer ?? '').trim(),
    port: Number(body.port ?? 0) || 587,
    user: String(body.user ?? '').trim(),
    to: String(body.to ?? '').trim(),
    password: String(body.password ?? ''),
  }
  if (!payload.user || !payload.to) {
    jsonResponse(response, 400, { ok: false, error: '账号与收件邮箱不能为空' })
    return
  }
  await ensureDataDir()
  const result = await runPowerShellStdin(MAIL_CONFIG_SCRIPT, ['-Action', 'save'], payload)
  let parsed = null
  try { parsed = JSON.parse(result.stdout) } catch { /* fall through */ }
  if (!parsed) {
    jsonResponse(response, 500, { ok: false, error: result.stderr || 'cannot save settings' })
    return
  }
  if (parsed.ok) log('mail settings saved', { user: parsed.user, to: parsed.to, authSet: parsed.authSet })
  jsonResponse(response, parsed.ok ? 200 : 500, parsed)
}

function fallbackMailConfig(config) {
  if (config.notify.mailConfig) return config.notify.mailConfig
  const local = join(DATA_DIR, 'notify.config.json')
  if (existsSync(local)) return local
  return null
}

async function announce(url, config, remoteUrl) {
  if (!existsSync(NOTIFY_SCRIPT)) {
    state.notify = { skipped: 'notify.ps1 missing' }
    return
  }
  const mailConfig = config.notify.mail ? fallbackMailConfig(config) : null
  const args = [
    '-File', NOTIFY_SCRIPT,
    '-Url', url,
    '-DesktopFile', config.notify.desktopFile ? '1' : '0',
    '-Toast', config.notify.toast ? '1' : '0',
    '-Mail', mailConfig ? '1' : '0',
    '-LogFile', join(DATA_DIR, 'notify.log'),
  ]
  if (remoteUrl) args.push('-RemoteUrl', remoteUrl)
  if (mailConfig) args.push('-MailConfig', mailConfig)
  const result = await runPowerShell(args)
  state.notify = {
    at: new Date().toISOString(),
    desktopFile: config.notify.desktopFile,
    toast: config.notify.toast,
    mail: Boolean(mailConfig),
    error: result.error,
    output: result.stdout || null,
    stderr: result.stderr || null,
  }
  if (result.error) warn('notify failed:', result.error)
  else log('announced', { mail: Boolean(mailConfig) })
}

async function stopProxy() {
  const server = state.proxy
  state.proxy = null
  state.running = false
  state.starting = false
  await closeServer(server)
}

async function startProxy(ctx) {
  if (state.running || state.starting) return snapshot()
  state.starting = true
  try {
    const config = await readConfig()
    if (config.enabled === false) {
      state.error = 'disabled by config'
      return snapshot()
    }
    await ensureDataDir()
    await writeFile(
      join(DATA_DIR, 'config.example.json'),
      JSON.stringify({ ...DEFAULT_CONFIG, _comment: 'copy to config.json to override' }, null, 2),
      'utf8',
    ).catch(() => {})

    const targetPort = await waitForWebServer(ctx)
    if (!targetPort) throw new Error('web server did not come up')
    const targetHost = String(ctx.webServer?.host ?? '127.0.0.1')

    const candidates = lanAddresses()
    const lanHost = config.address ?? candidates[0]?.address
    if (!lanHost) throw new Error('no private IPv4 address found; connect to a network first')
    if (config.address && !candidates.some((entry) => entry.address === config.address)) {
      warn(`configured address ${config.address} is not a current private IPv4 address`)
    }

    const listenHost = config.listen ?? '0.0.0.0'
    const listenPort = await pickPort(listenHost, Number(config.port ?? DEFAULT_PORT))
    const { server } = createProxy({ listenHost, listenPort, targetHost, targetPort })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(listenPort, listenHost, () => {
        server.off('error', reject)
        resolve()
      })
    })

    state.proxy = server
    state.running = true
    state.lanHost = lanHost
    state.listenHost = listenHost
    state.listenPort = listenPort
    state.targetHost = targetHost
    state.targetPort = targetPort
    state.startedAt = new Date().toISOString()
    state.error = null
    const connection = ctx.connection ?? ctx.get?.('connection')
    state.url = urlFor(connection, lanHost, listenPort)
    const remoteHost = tailscaleAddress()
    state.remoteHost = remoteHost
    state.tailscale = remoteHost
      ? { available: true, ip: remoteHost }
      : { available: false, ip: null }
    // The listen socket is 0.0.0.0, so the Tailscale address is reachable too;
    // it only needs its own token URL for the phone to open out of the house.
    state.remoteUrl = remoteHost ? urlFor(connection, remoteHost, listenPort) : null
    log(`listening on ${listenHost}:${listenPort} -> ${authority(targetHost, targetPort)}`)
    log(`url ${state.url}`)
    if (state.remoteUrl) log(`remote url ${state.remoteUrl}`)
    void announce(state.url, config, state.remoteUrl).catch((error) => warn('announce failed:', error.message))
    return snapshot()
  } catch (error) {
    state.error = error.message
    state.running = false
    warn('start failed:', error.message)
    return snapshot()
  } finally {
    state.starting = false
  }
}

function snapshot() {
  return {
    running: state.running,
    url: state.url,
    lanHost: state.lanHost,
    remoteHost: state.remoteHost,
    remoteUrl: state.remoteUrl,
    tailscale: state.tailscale,
    listenHost: state.listenHost,
    listenPort: state.listenPort,
    targetHost: state.targetHost,
    targetPort: state.targetPort,
    startedAt: state.startedAt,
    error: state.error,
    notify: state.notify,
  }
}

function jsonResponse(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

function handleStatus(request, response) {
  if (request.method !== 'GET') {
    response.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'GET' })
    response.end(JSON.stringify({ error: 'method-not-allowed' }))
    return
  }
  jsonResponse(response, 200, snapshot())
}

async function handleRestart(request, response, ctx) {
  if (request.method !== 'POST') {
    response.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'POST' })
    response.end(JSON.stringify({ error: 'method-not-allowed' }))
    return
  }
  try {
    await stopProxy()
    state.url = null
    state.remoteUrl = null
    state.remoteHost = null
    state.startedAt = null
    await startProxy(ctx)
    jsonResponse(response, 200, snapshot())
  } catch (error) {
    state.error = error.message
    warn('restart failed:', error.message)
    jsonResponse(response, 500, { ...snapshot(), error: error.message })
  }
}

export const inject = ['webServer', 'connection']

export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({ kind: 'exact', path: STATUS_ROUTE, handler: handleStatus }),
  )
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: RESTART_ROUTE,
      handler: (request, response) => handleRestart(request, response, ctx),
    }),
  )
  ctx.effect(() =>
    ctx.webServer.register({ kind: 'exact', path: MAIL_ROUTE, handler: handleMail }),
  )
  ctx.effect(() =>
    ctx.webServer.register({ kind: 'exact', path: MAIL_CONFIG_ROUTE, handler: handleMailConfig }),
  )
  ctx.effect(() => () => {
    void stopProxy()
  })

  void startProxy(ctx)

  // A network change moves the LAN address; re-announce only when it changed.
  ctx.effect(() => {
    const timer = setInterval(() => {
      if (!state.running) return
      const current = lanAddresses()[0]?.address
      if (current && state.lanHost && current !== state.lanHost) {
        warn(`LAN address changed ${state.lanHost} -> ${current}; restarting proxy`)
        void (async () => {
          await stopProxy()
          state.url = null
          await startProxy(ctx)
        })()
      }
    }, 60_000)
    timer.unref?.()
    return () => clearInterval(timer)
  })
}
