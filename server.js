#!/usr/bin/env node
// DockDesk backend: zero dependencies. Talks to the Docker Engine socket and serves ./public.
'use strict'
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const os = require('node:os')
const { execFile, spawn } = require('node:child_process')
const { StringDecoder } = require('node:string_decoder')

const SOCK = (process.env.DOCKER_HOST || '').startsWith('unix://')
  ? process.env.DOCKER_HOST.slice(7)
  : '/var/run/docker.sock'
const PORT = Number(process.env.DOCKDESK_PORT || 0)
const TOKEN = crypto.randomBytes(24).toString('hex')
const PUBLIC = path.join(__dirname, 'public')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }

// ---------- Docker socket client ----------
function dockerReq(method, url, body, opts = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body)
    const req = http.request(
      {
        socketPath: SOCK,
        method,
        path: url,
        headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...opts.headers }
      },
      (res) => resolve(res)
    )
    req.on('error', reject)
    if (opts.upgrade) req.on('upgrade', (res, socket, head) => resolve({ res, socket, head }))
    req.end(data)
  })
}

async function dk(method, url, body) {
  const res = await dockerReq(method, url, body)
  const chunks = []
  for await (const c of res) chunks.push(c)
  const text = Buffer.concat(chunks).toString()
  if (res.statusCode >= 400) {
    let msg = text
    try { msg = JSON.parse(text).message } catch {}
    throw new Error(msg || `Docker API ${res.statusCode}`)
  }
  try { return text ? JSON.parse(text) : null } catch { return text }
}

const run = (cmd, args, cwd) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { cwd, maxBuffer: 16 << 20 }, (err, out, e2) =>
      err ? reject(new Error((e2 || err.message).trim())) : resolve(out + e2)
    )
  )

// Start/stop the engine. Try without a prompt first (works when the optional polkit rule is installed),
// and fall back to pkexec, which shows the system password dialog.
const NEEDS_AUTH = /interactive authentication|access denied|not authorized|authentication is required/i
async function engineCtl(verb) {
  const units = verb === 'stop' ? ['docker.socket', 'docker.service'] : ['docker.service']
  try {
    return await run('systemctl', ['--no-ask-password', verb, ...units])
  } catch (e) {
    if (!NEEDS_AUTH.test(e.message)) throw e
    return run('pkexec', ['systemctl', verb, ...units])
  }
}

async function dockerGroup() {
  let line
  try { line = (await run('getent', ['group', 'docker'])).trim() } catch { return null }
  const [, , gid, members] = line.split(':')
  return { gid: Number(gid), members: (members || '').split(',').filter(Boolean) }
}
// Regular login users only: UID 1000..59999 with a valid-looking name (excludes root, system accounts, nobody).
async function humanUsers() {
  const out = await run('getent', ['passwd'])
  return out.split('\n').map((l) => l.split(':')).filter((f) => f.length >= 4)
    .map((f) => ({ name: f[0], uid: Number(f[2]), gid: Number(f[3]) }))
    .filter((u) => u.uid >= 1000 && u.uid < 60000 && /^[a-z_][a-z0-9_-]{0,31}$/i.test(u.name))
}

// ---- compose projects created/edited by DockDesk live here; other projects are editable only if a real container points at the file
const PROJECTS_DIR = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'dockdesk', 'projects')
const PROJECT_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/
const realOr = (p) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
async function composeFileAllowed(file) {
  const f = realOr(String(file || ''))
  if (!path.isAbsolute(f) || String(file).includes('\0')) return false
  const root = realOr(PROJECTS_DIR) + path.sep
  if ((f + path.sep).startsWith(root)) return true
  const cs = await dk('GET', '/containers/json?all=1')
  return cs.some((c) => String(c.Labels?.['com.docker.compose.project.config_files'] || '').split(',').some((x) => x && realOr(x) === f))
}
function composeRun(args, stdin, cwd, ms = 30000) {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['compose', ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    const timer = setTimeout(() => proc.kill('SIGTERM'), ms)
    proc.stdout.on('data', (c) => (out += c)); proc.stderr.on('data', (c) => (err += c))
    proc.on('error', (e) => { clearTimeout(timer); resolve({ code: 1, out, err: e.message }) })
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }) })
    proc.stdin.on('error', () => {}) // the command can exit before reading its input (e.g. no compose plugin): that is not a server error
    proc.stdin.end(stdin || '')
  })
}

// `docker compose` is a separate plugin; some distros ship none (Debian 12) or call it differently. Say so plainly.
const COMPOSE_MISSING = /is not a docker command|unknown command: docker compose|docker: 'compose'/i
// What to install, for the distro we are running on (from /etc/os-release). null when we don't know the distro.
let composeHintCache
function composeHint() {
  if (composeHintCache !== undefined) return composeHintCache
  const rel = {}
  try { for (const l of fs.readFileSync('/etc/os-release', 'utf8').split('\n')) { const m = /^(\w+)=(["']?)(.*)\2$/.exec(l); if (m) rel[m[1]] = m[3] } } catch {}
  const ids = [rel.ID, ...(rel.ID_LIKE || '').split(/\s+/)].filter(Boolean), has = (...x) => x.some((i) => ids.includes(i))
  const repo = " from Docker's apt repository (this release has no Compose v2 package of its own)"
  let cmd = null, note = ''
  if (rel.ID === 'kali') cmd = 'sudo apt install docker-compose'
  else if (has('ubuntu')) cmd = 'sudo apt install docker-compose-v2'
  else if (rel.ID === 'debian' && Number(rel.VERSION_ID) >= 13) cmd = 'sudo apt install docker-compose'
  else if (has('debian')) { cmd = 'sudo apt install docker-compose-plugin'; note = repo }
  else if (has('fedora', 'rhel', 'centos')) { cmd = 'sudo dnf install docker-compose-plugin'; note = " from Docker's repository" }
  else if (has('arch')) cmd = 'sudo pacman -S docker-compose'
  else if (has('suse', 'opensuse')) cmd = 'sudo zypper install docker-compose'
  else if (has('alpine')) cmd = 'sudo apk add docker-cli-compose'
  return (composeHintCache = cmd ? { distro: rel.PRETTY_NAME || rel.NAME || rel.ID || 'this system', cmd, note } : null)
}
const COMPOSE_GENERIC = 'Install the "docker-compose-v2" package (Ubuntu), "docker-compose" (Debian 13, Kali) or "docker-compose-plugin" (Docker\'s own repository)'
const friendlyCompose = (msg) => {
  if (!COMPOSE_MISSING.test(String(msg))) return msg
  const h = composeHint()
  return `Docker Compose v2 is not installed. ${h ? `On ${h.distro}, install it with: ${h.cmd}${h.note}` : COMPOSE_GENERIC}, then try again.`
}

// Docker event -> the small shape the UI uses (null for noise).
function mapEvent(e) {
  const action = String(e.Action || '').split(':')[0]
  if (/^(exec_|attach|resize|top|export|mount|unmount|connect|disconnect|archive-path|extract-to-dir|copy)/.test(action)) return null
  const a = e.Actor?.Attributes || {}
  const detail = String(e.Action || '').split(':').slice(1).join(':').trim() || undefined
  return { t: e.time, type: e.Type, action, detail, id: e.Actor?.ID, name: a.name || a.image || String(e.Actor?.ID || '').slice(0, 12), exit: a.exitCode, image: a.image }
}

// ---- container files: Docker has no "list a folder" call, so listing runs `ls` inside the container (argv array, no shell);
// downloads/uploads/previews use the archive API, which speaks tar.
const CONTAINER_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/
const cid = (id) => { if (!CONTAINER_ID.test(String(id))) throw new Error('Invalid container'); return String(id) }
const cpath = (p) => { p = String(p ?? '/'); if (!p.startsWith('/') || p.includes('\0') || p.length > 4096) throw new Error('Path must be absolute, like /etc'); return p }
const safeName = (n) => String(n).replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'download'

async function readBodyText(r) { const c = []; for await (const x of r) c.push(x); return Buffer.concat(c).toString() }
async function failFrom(r) { let m = ''; try { m = JSON.parse(await readBodyText(r)).message } catch {} throw new Error(m || `Docker API ${r.statusCode}`) }

async function execCollect(id, cmd, ms = 8000) {
  const ex = await dk('POST', `/containers/${seg(id)}/exec`, { Cmd: cmd, AttachStdout: true, AttachStderr: true, Tty: false, Env: ['LC_ALL=C'] })
  const r = await dockerReq('POST', `/exec/${ex.Id}/start`, { Detach: false, Tty: false })
  if (r.statusCode >= 400) await failFrom(r)
  let out = '', err = '', buf = Buffer.alloc(0)
  const timer = setTimeout(() => r.destroy(new Error('Listing timed out')), ms)
  try {
    for await (const chunk of r) {
      buf = Buffer.concat([buf, chunk])
      while (buf.length >= 8) {
        const len = buf.readUInt32BE(4)
        if (buf.length < 8 + len) break
        const text = buf.subarray(8, 8 + len).toString('utf8')
        buf[0] === 2 ? (err += text) : (out += text)
        buf = buf.subarray(8 + len)
      }
      if (out.length > 4e6) break
    }
  } finally { clearTimeout(timer) }
  return { out, err, code: (await dk('GET', `/exec/${ex.Id}/json`)).ExitCode }
}

async function archiveReq(id, p) {
  const r = await dockerReq('GET', `/containers/${seg(id)}/archive?path=${enc(p)}`)
  if (r.statusCode >= 400) await failFrom(r)
  return r
}

// Yields { meta } for the first real tar entry, then exactly its data as Buffers (PAX/long-name headers are skipped).
async function* tarEntry(r) {
  let buf = Buffer.alloc(0), mode = 'header', skip = 0, remaining = 0
  for await (const chunk of r) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
    for (;;) {
      if (mode === 'header') {
        if (buf.length < 512) break
        const h = buf.subarray(0, 512); buf = buf.subarray(512)
        if (h.every((b) => b === 0)) return
        const type = String.fromCharCode(h[156] || 48)
        const size = parseInt(h.subarray(124, 136).toString().replace(/\0[\s\S]*$/, '').trim() || '0', 8) || 0
        const name = h.subarray(0, 100).toString().replace(/\0[\s\S]*$/, '')
        if ('xgLK'.includes(type)) { mode = 'skip'; skip = Math.ceil(size / 512) * 512; continue }
        yield { meta: { name, size, type } }
        if (type !== '0' || !size) return
        remaining = size; mode = 'data'
      } else if (mode === 'skip') {
        const n = Math.min(skip, buf.length); buf = buf.subarray(n); skip -= n
        if (skip) break
        mode = 'header'
      } else {
        const n = Math.min(remaining, buf.length)
        if (n) { yield buf.subarray(0, n); buf = buf.subarray(n); remaining -= n }
        if (!remaining) return
        break
      }
    }
  }
}

// Yields one header object per tar entry (data is skipped, never buffered). Handles PAX (x) and GNU (L/K) long names.
async function* tarHeaders(r) {
  const cstr = (b) => b.toString('utf8').replace(/\0[\s\S]*$/, '')
  const oct = (b) => parseInt(cstr(b).trim() || '0', 8) || 0
  let buf = Buffer.alloc(0), mode = 'header', left = 0, kind = '', parts = [], pax = {}, longName = null, longLink = null
  for await (const chunk of r) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
    for (;;) {
      if (mode === 'header') {
        if (buf.length < 512) break
        const h = buf.subarray(0, 512); buf = buf.subarray(512)
        if (h.every((b) => b === 0)) return
        const type = String.fromCharCode(h[156] || 48), size = oct(h.subarray(124, 136)), padded = Math.ceil(size / 512) * 512
        if ('xgLK'.includes(type)) { mode = 'collect'; kind = type; left = padded; parts = []; pax.__size = size; continue }
        const prefix = h.subarray(257, 263).toString() === 'ustar\0' ? cstr(h.subarray(345, 500)) : ''
        const name = pax.path ?? longName ?? ((prefix ? prefix + '/' : '') + cstr(h.subarray(0, 100)))
        const e = { name, type, size: pax.size ?? size, mode: oct(h.subarray(100, 108)), uid: oct(h.subarray(108, 116)), gid: oct(h.subarray(116, 124)),
          mtime: pax.mtime ?? oct(h.subarray(136, 148)), link: pax.linkpath ?? longLink ?? cstr(h.subarray(157, 257)), uname: cstr(h.subarray(265, 297)), gname: cstr(h.subarray(297, 329)) }
        pax = {}; longName = longLink = null
        yield e
        if (type === '0' || type === '7') { mode = 'skip'; left = Math.ceil(e.size / 512) * 512; if (!left) mode = 'header' }
      } else if (mode === 'skip' || mode === 'collect') {
        const n = Math.min(left, buf.length)
        if (mode === 'collect') parts.push(buf.subarray(0, n))
        buf = buf.subarray(n); left -= n
        if (left) break
        if (mode === 'collect') {
          const size = pax.__size, text = Buffer.concat(parts).subarray(0, size).toString('utf8')
          if (kind === 'L') longName = text.replace(/\0[\s\S]*$/, '')
          else if (kind === 'K') longLink = text.replace(/\0[\s\S]*$/, '')
          else if (kind === 'x') {
            // records look like "<len> key=value\n"
            for (const m of text.matchAll(/\d+ ([^=\n]+)=([^\n]*)\n/g)) {
              if (m[1] === 'path') pax.path = m[2]; else if (m[1] === 'linkpath') pax.linkpath = m[2]
              else if (m[1] === 'size') pax.size = Number(m[2]) || 0; else if (m[1] === 'mtime') pax.mtime = Math.floor(Number(m[2])) || 0
            }
          }
          delete pax.__size
        }
        mode = 'header'
      } else break
    }
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function lsDate(sec) { // same look as `ls -l`: time for recent files, year for old ones
  const d = new Date(sec * 1000), recent = Math.abs(Date.now() - d.getTime()) < 182 * 864e5
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2)} ${recent ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ` ${d.getFullYear()}`.trim()}`
}
function permString(mode) {
  const c = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx']
  let s = c[(mode >> 6) & 7] + c[(mode >> 3) & 7] + c[mode & 7]
  if (mode & 0o4000) s = s.slice(0, 2) + (s[2] === 'x' ? 's' : 'S') + s.slice(3)
  if (mode & 0o2000) s = s.slice(0, 5) + (s[5] === 'x' ? 's' : 'S') + s.slice(6)
  if (mode & 0o1000) s = s.slice(0, 8) + (s[8] === 'x' ? 't' : 'T')
  return s
}

// Folder listing without running anything inside the container: read the tar headers of the archive Docker serves for the folder.
// This works for stopped containers and for images with no `ls` (scratch, distroless). Trade-off: tar has no "children only" query, so
// a very large subtree is scanned until a limit and the listing may be partial.
const LIST_MAX_HEADERS = 50000, LIST_MAX_MS = 8000
async function archiveList(id, p) {
  const dir = p.length > 1 ? p.replace(/\/+$/, '') : '/'
  const r = await archiveReq(id, dir === '/' ? '/' : dir + '/.') // "/." also follows a symlink that points to a folder
  const entries = [], deadline = Date.now() + LIST_MAX_MS
  let scanned = 0, partial = false
  try {
    for await (const h of tarHeaders(r)) {
      if (++scanned > LIST_MAX_HEADERS || Date.now() > deadline) { partial = true; break }
      // Entry names are relative to the folder, e.g. "./", "./passwd", or "etc/passwd" depending on the Docker version: drop a leading "./", then the folder's own name when it prefixes everything
      let rel = h.name.replace(/^(\.\/|\/)+/, '').replace(/\/+$/, '')
      const base = dir === '/' ? '' : dir.split('/').pop()
      if (base && (rel === base || rel.startsWith(base + '/'))) rel = rel.slice(base.length).replace(/^\//, '')
      if (!rel || rel === '.' || rel.includes('/')) continue
      const link = h.type === '2' ? h.link : null
      entries.push({ type: { 5: 'd', 2: 'l', 3: 'c', 4: 'b', 6: 'p' }[h.type] || '-', perms: permString(h.mode), owner: h.uname || String(h.uid), group: h.gname || String(h.gid), size: h.type === '5' ? 0 : h.size, date: lsDate(h.mtime), name: rel, target: link })
    }
  } finally { r.destroy() }
  entries.sort((a, b) => (b.type === 'd') - (a.type === 'd') || a.name.localeCompare(b.name))
  return { path: p, entries, source: 'archive', partial }
}

function tarHeader(name, size) {
  const b = Buffer.alloc(512)
  b.write(name, 0, 100, 'utf8'); b.write('0000644\0', 100); b.write('0000000\0', 108); b.write('0000000\0', 116)
  b.write(size.toString(8).padStart(11, '0') + '\0', 124); b.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136)
  b.write('        ', 148); b.write('0', 156); b.write('ustar\0', 257); b.write('00', 263)
  let sum = 0; for (const x of b) sum += x
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  return b
}

const enc = encodeURIComponent
const filters = (o) => enc(JSON.stringify(o))
const seg = (s) => enc(String(s))

const handlers = {
  ping: async () => { await dk('GET', '/_ping'); return true },
  info: () => dk('GET', '/info'),
  df: () => dk('GET', '/system/df'),

  'containers.list': () => dk('GET', '/containers/json?all=1'),
  // Containers page: adds StartedAt, which the list endpoint doesn't carry.
  'containers.table': async () => {
    const list = await dk('GET', '/containers/json?all=1')
    return Promise.all(list.map(async (c) => {
      try { const i = await dk('GET', `/containers/${c.Id}/json`); return { ...c, StartedAt: i.State.StartedAt } } catch { return c }
    }))
  },
  // One CPU/memory sample per running container (Docker takes ~1s per sample, so they run in parallel).
  'stats.all': async () => {
    const out = {}
    const list = await dk('GET', '/containers/json')
    await Promise.all(list.map(async (c) => { try { out[c.Id] = summarize(await dk('GET', `/containers/${c.Id}/stats?stream=false`)) } catch {} }))
    return out
  },
  'container.inspect': (id) => dk('GET', `/containers/${seg(id)}/json`),
  'container.action': (id, a) => {
    if (!['start', 'stop', 'restart', 'pause', 'unpause', 'kill'].includes(a)) throw new Error('bad action')
    return dk('POST', `/containers/${seg(id)}/${a}`)
  },
  'container.remove': (id, force) => dk('DELETE', `/containers/${seg(id)}?force=${!!force}`),
  'containers.prune': () => dk('POST', '/containers/prune'),
  // Create + start a container from the "Run" dialog / a lab template.
  // Everything here ends up in a Docker API body, so every field is validated and unknown fields are ignored.
  'container.run': async (spec) => {
    const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
    const name = String(spec.name || '').trim()
    if (name && !NAME.test(name)) throw new Error('Invalid container name')
    const bindIp = spec.bindIp === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1' // default to localhost only
    const network = String(spec.network || 'bridge')
    if (!['bridge', 'host', 'none'].includes(network) && !NAME.test(network)) throw new Error('Invalid network name')
    const restart = String(spec.restart || 'no')
    if (!['no', 'always', 'unless-stopped', 'on-failure'].includes(restart)) throw new Error('Invalid restart policy')
    const ExposedPorts = {}, PortBindings = {}
    for (const p of spec.ports || []) {
      const cp = String(p.container || '').trim(), hp = String(p.host || '').trim()
      if (!cp && !hp) continue
      if (!/^\d{1,5}$/.test(cp)) throw new Error(`Invalid container port: ${cp || '(empty)'}`)
      if (hp && !/^\d{1,5}$/.test(hp)) throw new Error(`Invalid host port: ${hp}`)
      const key = `${cp}/${p.proto === 'udp' ? 'udp' : 'tcp'}`
      ExposedPorts[key] = {}
      ;(PortBindings[key] ||= []).push({ HostIp: bindIp, HostPort: hp })
    }
    const Binds = (spec.volumes || []).filter((v) => v.host && v.container).map((v) => `${String(v.host).trim()}:${String(v.container).trim()}`)
    const Env = (spec.env || []).filter((e) => e.key).map((e) => `${String(e.key).trim()}=${e.value ?? ''}`)
    const CapAdd = (spec.caps || []).map(String).map((c) => c.trim().toUpperCase()).filter(Boolean)
    for (const c of CapAdd) if (!/^[A-Z_]{3,32}$/.test(c)) throw new Error(`Invalid capability: ${c}`)
    const Devices = (spec.devices || []).map(String).map((d) => d.trim()).filter(Boolean).map((d) => {
      if (!/^\/dev\/[\w./-]+$/.test(d) || d.includes('..')) throw new Error(`Invalid device: ${d} (must be under /dev)`)
      return { PathOnHost: d, PathInContainer: d, CgroupPermissions: 'rwm' }
    })
    const mem = Number(spec.memoryMb || 0), cpus = Number(spec.cpus || 0)
    if (!(mem >= 0 && mem <= 4194304) || !(cpus >= 0 && cpus <= 1024)) throw new Error('Invalid memory or CPU limit')
    const Labels = {}
    if (spec.lab && /^[a-z0-9-]{1,40}$/.test(String(spec.lab))) Labels['dockdesk.lab'] = String(spec.lab) // the only label DockDesk sets
    const HostConfig = {
      PortBindings: network === 'host' ? {} : PortBindings, Binds, NetworkMode: network, CapAdd, Devices, Privileged: !!spec.privileged,
      RestartPolicy: { Name: restart === 'no' ? '' : restart, MaximumRetryCount: restart === 'on-failure' ? 5 : 0 },
      Memory: Math.round(mem * 1048576), NanoCpus: Math.round(cpus * 1e9)
    }
    const body = { Image: spec.image, Env, ExposedPorts: network === 'host' ? {} : ExposedPorts, HostConfig, Labels, Tty: !!spec.interactive, OpenStdin: !!spec.interactive }
    const created = await dk('POST', `/containers/create${name ? `?name=${enc(name)}` : ''}`, body)
    try { await dk('POST', `/containers/${created.Id}/start`) } catch (e) {
      await dk('DELETE', `/containers/${created.Id}?force=true&v=true`).catch(() => {}) // don't leave a half-created container (or its anonymous volumes) behind
      throw e
    }
    return { id: created.Id }
  },
  // Rename and/or live-update restart policy and limits of an existing container.
  // Docker's update API can change a memory/CPU limit but never remove one (0 means "leave as is"), so 0 here means "unchanged".
  'container.update': async (id, spec) => {
    const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
    const info = await dk('GET', `/containers/${seg(id)}/json`)
    const cid = info.Id // use the id from here on: after a rename the old name no longer resolves
    if (spec.name !== undefined && spec.name !== info.Name.replace(/^\//, '')) {
      if (!NAME.test(String(spec.name))) throw new Error('Invalid container name')
      await dk('POST', `/containers/${cid}/rename?name=${enc(spec.name)}`)
    }
    const restart = String(spec.restart || 'no')
    if (!['no', 'always', 'unless-stopped', 'on-failure'].includes(restart)) throw new Error('Invalid restart policy')
    const mem = Number(spec.memoryMb || 0), cpus = Number(spec.cpus || 0)
    if (!(mem === 0 || (mem >= 6 && mem <= 4194304))) throw new Error('Memory limit must be at least 6 MB')
    if (!(cpus >= 0 && cpus <= 1024)) throw new Error('Invalid CPU limit')
    const body = { RestartPolicy: { Name: restart, MaximumRetryCount: restart === 'on-failure' ? 5 : 0 } }
    if (mem > 0) { body.Memory = Math.round(mem * 1048576); body.MemorySwap = body.Memory * 2 }
    if (cpus > 0) body.NanoCpus = Math.round(cpus * 1e9)
    await dk('POST', `/containers/${cid}/update`, body)
    return 'ok'
  },
  // Folder picker for the build dialog: subfolders of an absolute path (hidden ones skipped).
  'fs.dirs': (p) => {
    const dir = path.resolve(String(p || os.homedir()))
    const dirs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort().slice(0, 300)
    return { path: dir, parent: path.dirname(dir) === dir ? null : path.dirname(dir), dirs, files: fs.readdirSync(dir).filter((f) => /^(Dockerfile|.*\.Dockerfile|Containerfile)$/.test(f)), tars: fs.readdirSync(dir).filter((f) => /\.(tar|tar\.gz|tgz)$/i.test(f)).slice(0, 200) }
  },

  // df carries per-image container counts and per-volume size/ref-count that the plain list endpoints lack.
  'images.list': async () => (await dk('GET', '/system/df')).Images || [],
  'image.tag': (src, repo, tag) => {
    if (!/^[a-z0-9]+(?:[._:\/-][a-z0-9]+)*$/.test(String(repo))) throw new Error('Name must be lowercase, like myuser/myapp or localhost:5000/myapp')
    if (!/^\w[\w.-]{0,127}$/.test(String(tag))) throw new Error('Invalid tag')
    return dk('POST', `/images/${seg(src)}/tag?repo=${enc(repo)}&tag=${enc(tag)}`)
  },
  // ---- registry credentials ----
  // Credentials are handed to the docker CLI over stdin (never on a command line) and stored by docker itself,
  // exactly as `docker login` would. We never read, return or log the stored secrets, only the registry names.
  'registry.status': () => {
    const cfg = path.join(process.env.DOCKER_CONFIG || path.join(os.homedir(), '.docker'), 'config.json')
    let j = {}
    try { j = JSON.parse(fs.readFileSync(cfg, 'utf8')) } catch {}
    const helpers = j.credHelpers ? Object.keys(j.credHelpers) : []
    return { registries: [...new Set([...Object.keys(j.auths || {}), ...helpers])], store: j.credsStore || null }
  },
  'registry.login': (server, user, password) => new Promise((resolve, reject) => {
    server = String(server || '').trim(); user = String(user || '').trim()
    if (server && !/^[a-zA-Z0-9.-]+(:\d{1,5})?(\/[\w./-]*)?$/.test(server)) return reject(new Error('Invalid registry address'))
    if (!/^[\w.@+-]{1,128}$/.test(user)) return reject(new Error('Invalid username'))
    if (typeof password !== 'string' || !password || password.length > 4096 || /[\r\n]/.test(password)) return reject(new Error('Invalid password'))
    const proc = spawn('docker', ['login', ...(server ? [server] : []), '-u', user, '--password-stdin'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    proc.stdout.on('data', (c) => (out += c)); proc.stderr.on('data', (c) => (out += c))
    proc.on('error', reject)
    proc.on('close', (code) => code === 0 ? resolve('ok') : reject(new Error(out.replace(/^.*WARNING!.*$/gm, '').trim().split('\n').filter(Boolean).pop() || 'Login failed')))
    proc.stdin.on('error', () => {}) // docker may exit early (bad registry address): ignore the broken pipe, the exit code reports the failure
    proc.stdin.end(password + '\n')
  }),
  'registry.logout': (server) => {
    server = String(server || '').trim()
    if (server && !/^[a-zA-Z0-9.:\/_-]+$/.test(server)) throw new Error('Invalid registry address')
    return run('docker', ['logout', ...(server ? [server] : [])])
  },
  'image.history': (id) => dk('GET', `/images/${seg(id)}/history`),
  'image.inspect': (id) => dk('GET', `/images/${seg(id)}/json`),
  'image.remove': (id, force) => dk('DELETE', `/images/${seg(id)}?force=${!!force}`),
  'images.prune': (all) => dk('POST', `/images/prune?filters=${filters({ dangling: [all ? 'false' : 'true'] })}`),

  'volumes.list': async () => (await dk('GET', '/system/df')).Volumes || [],
  'volume.inspect': (n) => dk('GET', `/volumes/${seg(n)}`),
  'volume.create': (name) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(String(name))) throw new Error('Invalid volume name (letters, digits, _ . - only)')
    return dk('POST', '/volumes/create', { Name: name })
  },
  'volume.remove': (n) => dk('DELETE', `/volumes/${seg(n)}`),
  'volumes.prune': () => dk('POST', `/volumes/prune?filters=${filters({ all: ['true'] })}`),

  'networks.list': async () => {
    const list = await dk('GET', '/networks')
    return Promise.all(list.map((n) => dk('GET', `/networks/${seg(n.Id)}`).catch(() => n)))
  },
  'network.inspect': (id) => dk('GET', `/networks/${seg(id)}`),
  'network.create': (name, subnet) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(String(name))) throw new Error('Invalid network name (letters, digits, _ . - only)')
    const body = { Name: name, Driver: 'bridge', CheckDuplicate: true }
    if (subnet) {
      if (!/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(String(subnet))) throw new Error('Subnet must look like 10.20.0.0/24')
      body.IPAM = { Config: [{ Subnet: subnet }] }
    }
    return dk('POST', '/networks/create', body)
  },
  'network.remove': (id) => dk('DELETE', `/networks/${seg(id)}`),
  'networks.prune': () => dk('POST', '/networks/prune'),

  'compose.action': (project, workdir, files, action) => {
    const verbs = { up: ['up', '-d'], down: ['down'], stop: ['stop'], start: ['start'], restart: ['restart'] }
    if (!verbs[action]) throw new Error('bad action')
    const args = ['compose', '-p', project]
    for (const f of (files || '').split(',').filter(Boolean)) args.push('-f', f)
    return run('docker', [...args, ...verbs[action]], workdir || undefined).catch((e) => { throw new Error(friendlyCompose(e.message)) })
  },
  // Open a local service in the default browser (loopback http only).
  'open.url': (url) => {
    if (!/^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}(\/[\w\-./?=&%]*)?$/.test(String(url))) throw new Error('refusing to open that URL')
    return run('xdg-open', [url])
  },
  // Why can't we reach Docker? Distinguishes "not running / not installed" from "no permission".
  // Recent events from the daemon's buffer, so the Activity page isn't empty when the app starts.
  'events.history': async (sinceSec) => {
    const since = Math.max(0, Math.floor(Number(sinceSec) || 0)), until = Math.floor(Date.now() / 1000)
    const r = await dockerReq('GET', `/events?since=${since}&until=${until}&filters=${filters({ type: ['container', 'image', 'volume', 'network'] })}`)
    const out = []
    await new Promise((resolve) => { r.on('data', ndjson((e) => { const m = mapEvent(e); if (m) out.push(m) })); r.on('end', resolve); r.on('error', resolve) })
    return out.slice(-400)
  },
  // ---- compose editor ----
  'compose.validate': async (yaml) => {
    yaml = String(yaml || '')
    if (!yaml.trim()) throw new Error('The compose file is empty')
    if (yaml.length > 256 * 1024) throw new Error('Compose file is too large')
    fs.mkdirSync(PROJECTS_DIR, { recursive: true, mode: 0o700 })
    const a = await composeRun(['-f', '-', 'config', '--services'], yaml, PROJECTS_DIR)
    if (a.code !== 0) throw new Error(friendlyCompose(a.err.trim()).split('\n').filter((l) => !/level=warning/.test(l)).join('\n') || 'Invalid compose file')
    return { services: a.out.split('\n').map((x) => x.trim()).filter(Boolean), warnings: a.err.split('\n').filter((l) => l.trim()).map((l) => l.replace(/^time=\S+ level=warning msg=/, '').replace(/^"|"$/g, '')) }
  },
  'compose.save': (name, yaml) => {
    if (!PROJECT_NAME.test(String(name))) throw new Error('Project name: lowercase letters, digits, - and _ only')
    yaml = String(yaml || '')
    if (!yaml.trim() || yaml.length > 256 * 1024) throw new Error('Compose file is empty or too large')
    const dir = path.join(PROJECTS_DIR, name), file = path.join(dir, 'compose.yaml')
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    fs.writeFileSync(file, yaml, { mode: 0o600 }) // may contain secrets
    return { dir, file }
  },
  'compose.read': async (file) => {
    if (!(await composeFileAllowed(file))) throw new Error('DockDesk can only open compose files of its own projects or of running compose projects')
    let st
    try { st = fs.statSync(file) } catch (e) { throw new Error(e.code === 'ENOENT' ? `That compose file no longer exists: ${file}` : e.message) }
    if (!st.isFile() || st.size > 256 * 1024) throw new Error('Not a compose file (or too large)')
    let writable = true
    try { fs.accessSync(file, fs.constants.W_OK) } catch { writable = false }
    return { file, dir: path.dirname(file), text: fs.readFileSync(file, 'utf8'), writable }
  },
  'compose.write': async (file, yaml) => {
    if (!(await composeFileAllowed(file))) throw new Error('DockDesk can only edit compose files of its own projects or of running compose projects')
    yaml = String(yaml || '')
    if (!yaml.trim() || yaml.length > 256 * 1024) throw new Error('Compose file is empty or too large')
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.dockdesk.bak') // one-step undo
    fs.writeFileSync(file, yaml)
    return 'ok'
  },
  'container.ls': async (id, p) => {
    id = cid(id); p = cpath(p)
    let r
    // `ls` can't run in a stopped container or one with no ls: list from the archive instead (see archiveList)
    const NO_LS = /not running|executable file not found|not found in \$PATH/i
    try { r = await execCollect(id, ['ls', '-lA', p.endsWith('/') ? p : p + '/']) } catch (e) {
      if (NO_LS.test(e.message)) return archiveList(id, p)
      throw e
    }
    if (r.code !== 0) {
      const msg = (r.err || r.out).trim().split('\n').pop() || 'Could not list that folder'
      if (NO_LS.test(msg) || r.code === 126 || r.code === 127) return archiveList(id, p)
      throw new Error(msg)
    }
    const re = /^([-dlcbps])([rwxsStT-]{9})[.+@]?\s+\d+\s+(\S+)\s+(\S+)\s+(\d+(?:,\s*\d+)?)\s+(\w{3}\s+\d+\s+(?:\d{2}:\d{2}|\d{4}))\s+(.*)$/
    const entries = []
    for (const line of r.out.split('\n')) {
      const m = re.exec(line); if (!m) continue
      const link = m[1] === 'l' ? m[7].split(' -> ') : null
      entries.push({ type: m[1], perms: m[2], owner: m[3], group: m[4], size: Number(m[5].split(',')[0]) || 0, date: m[6], name: link ? link[0] : m[7], target: link?.[1] || null })
    }
    entries.sort((a, b) => (b.type === 'd') - (a.type === 'd') || a.name.localeCompare(b.name))
    return { path: p, entries }
  },
  // Text preview of one file (first 256 kB).
  'container.cat': async (id, p) => {
    const r = await archiveReq(cid(id), cpath(p)), MAX = 256 * 1024
    let meta = null, got = 0, truncated = false
    const parts = []
    for await (const part of tarEntry(r)) {
      if (part.meta) { meta = part.meta; if (meta.type !== '0') { r.destroy(); return { kind: meta.type === '5' ? 'dir' : 'other', size: meta.size } } continue }
      parts.push(part); got += part.length
      if (got >= MAX) { truncated = meta.size > MAX; r.destroy(); break }
    }
    const data = Buffer.concat(parts).subarray(0, MAX)
    const binary = data.subarray(0, 8000).includes(0)
    return { kind: 'file', size: meta?.size ?? 0, truncated, binary, text: binary ? '' : data.toString('utf8') }
  },
  'engine.diag': async () => {
    let exists = false, access = false
    try { fs.statSync(SOCK); exists = true } catch {}
    try { fs.accessSync(SOCK, fs.constants.R_OK | fs.constants.W_OK); access = true } catch {}
    const groups = (await run('id', ['-nG']).catch(() => '')).trim().split(/\s+/)
    const ver = async (args) => (await run('docker', args).catch(() => '')).trim().split('\n')[0] || null
    // Added to the docker group (so /etc/group says yes) but this login session predates it: the app can restart itself with the group applied.
    const me = os.userInfo(), g = await dockerGroup()
    const groupPending = !groups.includes('docker') && !!g && (g.members.includes(me.username) || g.gid === me.gid)
    return { socket: SOCK, exists, access, inDockerGroup: groups.includes('docker'), groupPending, canRelaunch: groupPending && !process.env.DOCKDESK_NO_OPEN, user: me.username, compose: await ver(['compose', 'version', '--short']), composeHint: composeHint(), buildx: (await ver(['buildx', 'version'])) }
  },
  // Docker Hub search via the daemon (so it honours the daemon's registry/proxy config).
  'hub.search': (term) => {
    if (!/^[\w./:-]{2,100}$/.test(String(term))) throw new Error('Invalid search term')
    return dk('GET', `/images/search?term=${enc(term)}&limit=12`)
  },
  // ---- docker group management ----
  // Membership of the docker group is root-equivalent, so this is deliberately narrow:
  // the group is hard-coded, only real local users can be targeted, and every change goes
  // through pkexec (an admin password prompt) -- never through the passwordless engine rule.
  'group.list': async () => {
    const g = await dockerGroup()
    const me = os.userInfo().username
    // Group membership is fixed when a login session starts. `id` run from this process shows what THIS session has,
    // which can differ from what /etc/group now says until the user logs out and back in.
    const sessionHas = (await run('id', ['-nG']).catch(() => '')).trim().split(/\s+/).includes('docker')
    return { group: 'docker', exists: !!g, users: g ? (await humanUsers()).map((u) => ({ name: u.name, uid: u.uid, you: u.name === me, primary: u.gid === g.gid, member: u.gid === g.gid || g.members.includes(u.name), sessionHas: u.name === me ? sessionHas : null })) : [] }
  },
  'group.set': async (user, member) => {
    if (typeof member !== 'boolean') throw new Error('Invalid request')
    const g = await dockerGroup()
    if (!g) throw new Error('The docker group does not exist on this system')
    const u = (await humanUsers()).find((x) => x.name === String(user))
    if (!u) throw new Error('That is not a regular local user')
    if (u.gid === g.gid) throw new Error('docker is this user\'s primary group; change it with usermod')
    if (g.members.includes(u.name) === member) return 'unchanged'
    await run('pkexec', ['gpasswd', member ? '-a' : '-d', u.name, 'docker'])
    return 'ok'
  },
  // Group membership is fixed at login, so a user who was just added to `docker` has no access until they log in again.
  // `sg docker` starts a process with the group applied right now: relaunch DockDesk that way, then close this copy.
  'app.relaunch': async () => {
    if (process.env.DOCKDESK_NO_OPEN) throw new Error('Headless mode: restart DockDesk yourself with: sg docker -c dockdesk')
    const g = await dockerGroup(), me = os.userInfo()
    if (!g || !(g.members.includes(me.username) || g.gid === me.gid)) throw new Error('Your user is not in the docker group yet')
    const quote = (x) => { if (/['\0\n]/.test(x)) throw new Error('Cannot restart from a path with a quote in it'); return `'${x}'` } // both paths are ours, never user input
    const child = spawn('sg', ['docker', '-c', `exec ${quote(process.execPath)} ${quote(__filename)}`], { detached: true, stdio: 'ignore', env: { ...process.env, DOCKDESK_WAIT_PID: String(process.pid) } })
    await new Promise((resolve, reject) => {
      child.once('error', (e) => reject(new Error(e.code === 'ENOENT' ? 'The "sg" command is missing, so DockDesk cannot restart itself. Log out and back in instead.' : e.message)))
      child.once('exit', () => reject(new Error('Could not restart with the docker group. Log out and back in instead.')))
      setTimeout(resolve, 800) // still alive after this long: it started
    })
    child.removeAllListeners('exit'); child.unref()
    setTimeout(() => (appWindow ? appWindow.kill('SIGTERM') : process.exit(0)), 300) // closing the window ends this process (see openApp)
    setTimeout(() => process.exit(0), 3000).unref()
    return 'ok'
  },
  // Docker can't remove a memory/CPU limit from an existing container, so recreate it with the same settings minus the limit.
  // The old container is only deleted once the new one is running; any failure puts the original back.
  'container.removeLimits': async (id, what) => {
    const clearMem = !!what?.memory, clearCpu = !!what?.cpus
    if (!clearMem && !clearCpu) throw new Error('Choose which limit to remove')
    const info = await dk('GET', `/containers/${seg(cid(id))}/json`), hc = info.HostConfig
    if (info.Config.Labels?.['com.docker.compose.project']) throw new Error('This container belongs to a Compose project: remove the limit in its compose file and run Up again.')
    if (hc.AutoRemove) throw new Error("A container started with --rm can't be recreated: it would be deleted when stopped.")
    const name = info.Name.replace(/^\//, ''), wasRunning = !!info.State.Running
    const body = structuredClone(info.Config)
    body.HostConfig = structuredClone(hc)
    if (clearMem) { body.HostConfig.Memory = 0; body.HostConfig.MemorySwap = 0 }
    if (clearCpu) { body.HostConfig.NanoCpus = 0; body.HostConfig.CpuQuota = 0; body.HostConfig.CpuPeriod = 0 }
    // keep the exact image the container was using, even if its tag has moved on since
    body.Image = info.Config.Image
    try { if ((await dk('GET', `/images/${seg(body.Image)}/json`)).Id !== info.Image) body.Image = info.Image } catch { body.Image = info.Image }
    if (body.Hostname === info.Id.slice(0, 12)) delete body.Hostname // that default hostname is the old container's id
    // anonymous volumes live only in Mounts: bind them explicitly so the new container keeps the data
    const covered = new Set([...(hc.Binds || []).map((b) => b.split(':')[1]), ...(hc.Mounts || []).map((m) => m.Target), ...Object.keys(hc.Tmpfs || {})])
    for (const m of info.Mounts || []) if (m.Type === 'volume' && m.Name && !covered.has(m.Destination)) (body.HostConfig.Binds ||= []).push(`${m.Name}:${m.Destination}${m.RW === false ? ':ro' : ''}`)
    const nets = info.NetworkSettings?.Networks || {}, ep = (n) => ({ Aliases: (n.Aliases || []).filter((a) => a !== info.Id.slice(0, 12)), IPAMConfig: n.IPAMConfig || undefined, Links: n.Links || undefined })
    const shared = /^(host|none|container:)/.test(hc.NetworkMode || '')
    const first = hc.NetworkMode in nets ? hc.NetworkMode : Object.keys(nets)[0]
    if (!shared && first) body.NetworkingConfig = { EndpointsConfig: { [first]: ep(nets[first]) } }
    const tmp = `${name}-dockdesk-old-${crypto.randomBytes(3).toString('hex')}`
    if (wasRunning) await dk('POST', `/containers/${info.Id}/stop`)
    await dk('POST', `/containers/${info.Id}/rename?name=${enc(tmp)}`)
    let created
    try {
      created = await dk('POST', `/containers/create?name=${enc(name)}`, body)
      if (!shared) for (const n of Object.keys(nets)) if (n !== first) await dk('POST', `/networks/${seg(n)}/connect`, { Container: created.Id, EndpointConfig: ep(nets[n]) })
      if (wasRunning) await dk('POST', `/containers/${created.Id}/start`)
    } catch (e) {
      if (created) await dk('DELETE', `/containers/${created.Id}?force=true`).catch(() => {})
      await dk('POST', `/containers/${info.Id}/rename?name=${enc(name)}`).catch(() => {})
      if (wasRunning) await dk('POST', `/containers/${info.Id}/start`).catch(() => {})
      throw new Error(`Could not recreate the container, the original was put back: ${e.message}`)
    }
    try { await dk('DELETE', `/containers/${info.Id}?force=true`) } catch (e) { throw new Error(`The container was recreated without the limit, but the old copy "${tmp}" could not be removed: ${e.message}`) }
    return { id: created.Id }
  },
  'daemon.start': () => engineCtl('start'),
  'daemon.stop': () => engineCtl('stop'),
  // Text of the optional polkit rule that removes the password prompt (shown in Settings).
  'engine.rule': () => fs.readFileSync(path.join(__dirname, 'dockdesk-polkit.rules'), 'utf8')
}

// ---------- Streaming (SSE out, POST in) ----------
function sse(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
  res.write(': connected\n\n') // flushes the headers now, so the browser sees the stream as open before the first event
  return (k, d) => res.write(`data: ${JSON.stringify({ k, d })}\n\n`)
}

// Split Docker's multiplexed (non-TTY) log stream into text.
function demux(onText) {
  let buf = Buffer.alloc(0)
  return (chunk) => {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= 8) {
      const len = buf.readUInt32BE(4)
      if (buf.length < 8 + len) break
      onText(buf.subarray(8, 8 + len).toString('utf8'))
      buf = buf.subarray(8 + len)
    }
  }
}

function ndjson(onObj) {
  let buf = ''
  return (chunk) => {
    buf += chunk.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      if (line.trim()) try { onObj(JSON.parse(line)) } catch {}
    }
  }
}

// Cumulative bytes read/written to block devices (cgroup v1 and v2 both report io_service_bytes_recursive).
const blkOp = (s, op) => (s.blkio_stats?.io_service_bytes_recursive || []).filter((b) => String(b.op).toLowerCase() === op).reduce((a, b) => a + (b.value || 0), 0)

function summarize(s) {
  const cpuD = s.cpu_stats.cpu_usage.total_usage - (s.precpu_stats?.cpu_usage?.total_usage || 0)
  const sysD = s.cpu_stats.system_cpu_usage - (s.precpu_stats?.system_cpu_usage || 0)
  const cpus = s.cpu_stats.online_cpus || 1
  const cache = s.memory_stats.stats?.inactive_file ?? s.memory_stats.stats?.cache ?? 0
  const nets = Object.values(s.networks || {})
  return {
    cpu: sysD > 0 && cpuD > 0 ? (cpuD / sysD) * cpus * 100 : 0,
    memUsed: Math.max(0, (s.memory_stats.usage || 0) - cache),
    memLimit: s.memory_stats.limit || 0,
    netRx: nets.reduce((a, n) => a + n.rx_bytes, 0),
    netTx: nets.reduce((a, n) => a + n.tx_bytes, 0),
    pids: s.pids_stats?.current || 0,
    blkRead: blkOp(s, 'read'),
    blkWrite: blkOp(s, 'write')
  }
}

// Interactive sessions (container exec or host shell): sid -> { write(data), resize(cols, rows) }
const execSessions = new Map()

async function stream(kind, q, req, res) {
  const send = sse(res)
  const cleanups = []
  req.on('close', () => cleanups.forEach((f) => f()))
  try {
    if (kind === 'logs') {
      const info = await dk('GET', `/containers/${seg(q.id)}/json`)
      const tail = q.tail === 'all' ? 'all' : String(Math.min(100000, Math.max(0, Number(q.tail ?? 300) || 0)))
      const r = await dockerReq('GET', `/containers/${seg(q.id)}/logs?follow=1&stdout=1&stderr=1&tail=${tail}&timestamps=${q.ts === '1' ? 1 : 0}`)
      r.on('data', info.Config.Tty ? (c) => send('data', c.toString('utf8')) : demux((t) => send('data', t)))
      r.on('end', () => send('end'))
      cleanups.push(() => r.destroy())
    } else if (kind === 'stats') {
      const r = await dockerReq('GET', `/containers/${seg(q.id)}/stats?stream=1`)
      r.on('data', ndjson((o) => send('data', summarize(o))))
      r.on('end', () => send('end'))
      cleanups.push(() => r.destroy())
    } else if (kind === 'pull') {
      const m = /^(.*?)(?::([^:/]+))?$/.exec(q.image)
      const r = await dockerReq('POST', `/images/create?fromImage=${enc(m[1])}&tag=${enc(m[2] || 'latest')}`)
      let failed = r.statusCode >= 400
      r.on('data', ndjson((o) => {
        if (o.error || (failed && o.message)) { failed = true; send('error', o.error || o.message); res.end() } else send('data', o)
      }))
      r.on('end', () => { if (!failed) send('end'); res.end() })
      cleanups.push(() => r.destroy())
    } else if (kind === 'exec') {
      const ex = await dk('POST', `/containers/${seg(q.id)}/exec`, {
        Cmd: ['/bin/sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'],
        AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true
      })
      const { socket, head } = await dockerReq(
        'POST', `/exec/${ex.Id}/start`, { Detach: false, Tty: true },
        { upgrade: true, headers: { Connection: 'Upgrade', Upgrade: 'tcp' } }
      )
      execSessions.set(q.sid, {
        write: (d) => socket.write(d),
        resize: (cols, rows) => dk('POST', `/exec/${ex.Id}/resize?h=${rows}&w=${cols}`).catch(() => {})
      })
      const dec = new StringDecoder('utf8')
      if (head?.length) send('data', dec.write(head))
      socket.on('data', (c) => send('data', dec.write(c)))
      socket.on('close', () => { send('end'); execSessions.delete(q.sid) })
      cleanups.push(() => { socket.destroy(); execSessions.delete(q.sid) })
    } else if (kind === 'events') {
      // One stream for the whole UI: container/image/volume/network changes, so pages refresh on change instead of polling hard.
      // `since` replays recent events first, so nothing that happens between the history snapshot and this stream (or during a reconnect) is missed
      const since = Math.max(0, Math.floor(Number(q.since)) || 0)
      const r = await dockerReq('GET', `/events?${since ? `since=${since}&` : ''}filters=${filters({ type: ['container', 'image', 'volume', 'network'] })}`)
      r.on('data', ndjson((e) => { const m = mapEvent(e); if (m) send('data', m) }))
      r.on('end', () => send('end'))
      cleanups.push(() => r.destroy())
    } else if (kind === 'compose') {
      const project = String(q.project || ''), file = String(q.file || ''), verb = String(q.verb || '')
      if (!PROJECT_NAME.test(project)) throw new Error('Invalid project name')
      if (!(await composeFileAllowed(file))) throw new Error('That compose file is not one DockDesk may use')
      const verbs = { up: ['up', '-d'], down: ['down'], pull: ['pull'], restart: ['restart'], stop: ['stop'] }
      if (!verbs[verb]) throw new Error('Unknown action')
      const proc = spawn('docker', ['compose', '--progress=plain', '-p', project, '-f', file, ...verbs[verb]], { cwd: path.dirname(file), stdio: ['ignore', 'pipe', 'pipe'] })
      const d1 = new StringDecoder('utf8'), d2 = new StringDecoder('utf8')
      let seen = ''
      proc.stdout.on('data', (c) => send('data', d1.write(c)))
      proc.stderr.on('data', (c) => { const t = d2.write(c); seen = (seen + t).slice(-2000); send('data', t) })
      proc.on('error', (e) => send('error', e.message))
      proc.on('close', (code) => { code === 0 ? send('end') : send('error', COMPOSE_MISSING.test(seen) ? friendlyCompose(seen) : `docker compose ${verb} failed (exit code ${code})`); res.end() })
      cleanups.push(() => proc.kill('SIGTERM'))
    } else if (kind === 'save') {
      // docker save -> a .tar file in a folder the user picked (written 0600: images can contain secrets)
      const ref = String(q.ref || '')
      if (!/^(sha256:)?[a-f0-9]{12,64}$/.test(ref) && !/^[a-z0-9][\w.\/:@-]{0,255}$/i.test(ref)) throw new Error('Invalid image name')
      const dir = path.resolve(String(q.dir || ''))
      if (!fs.statSync(dir).isDirectory()) throw new Error('Folder not found')
      const name = String(q.name || '')
      if (!/^\w[\w.-]{0,100}\.tar$/.test(name)) throw new Error('File name must end in .tar and use letters, digits, . _ -')
      const dest = path.join(dir, name)
      if (fs.existsSync(dest) && q.overwrite !== '1') throw new Error(`${name} already exists in that folder`)
      const r = await dockerReq('GET', `/images/${seg(ref)}/get`)
      if (r.statusCode >= 400) await failFrom(r)
      const ws = fs.createWriteStream(dest, { mode: 0o600 })
      let n = 0, last = 0, finished = false
      r.on('data', (c) => { n += c.length; if (Date.now() - last > 200) { last = Date.now(); send('data', { bytes: n }) } })
      r.pipe(ws)
      ws.on('finish', () => { finished = true; send('end', { path: dest, bytes: n }); res.end() })
      const fail = (e) => { send('error', e.message); res.end() }
      r.on('error', fail); ws.on('error', fail)
      cleanups.push(() => { r.destroy(); ws.destroy(); if (!finished) fs.unlink(dest, () => {}) }) // never leave a half-written file behind
    } else if (kind === 'load') {
      // docker load from a .tar / .tar.gz on disk, streamed to the daemon
      const file = path.resolve(String(q.path || ''))
      const st = fs.statSync(file)
      if (!st.isFile()) throw new Error('Pick an image archive (.tar or .tar.gz)')
      const rs = fs.createReadStream(file)
      let sent = 0, last = 0
      rs.on('data', (c) => { sent += c.length; if (Date.now() - last > 200) { last = Date.now(); send('data', { bytes: sent, total: st.size }) } })
      const dreq = http.request({ socketPath: SOCK, method: 'POST', path: '/images/load', headers: { 'Content-Type': 'application/x-tar' } }, (r) => {
        let failed = r.statusCode >= 400
        r.on('data', ndjson((o) => {
          if (o.error || (failed && o.message)) { failed = true; send('error', o.error || o.message) } else if (o.stream) send('data', { line: String(o.stream).trim() })
        }))
        r.on('end', () => { if (!failed) send('end', { bytes: st.size }); res.end() })
      })
      dreq.on('error', (e) => { send('error', e.message); res.end() })
      rs.pipe(dreq)
      cleanups.push(() => { rs.destroy(); dreq.destroy() })
    } else if (kind === 'push') {
      const ref = String(q.ref || '')
      if (!/^[a-z0-9]+(?:[._:\/-][a-z0-9]+)*(?::\w[\w.-]{0,127})?$/.test(ref)) throw new Error('Invalid image name')
      const proc = spawn('docker', ['push', ref], { stdio: ['ignore', 'pipe', 'pipe'] })
      const d1 = new StringDecoder('utf8'), d2 = new StringDecoder('utf8')
      proc.stdout.on('data', (c) => send('data', d1.write(c)))
      proc.stderr.on('data', (c) => send('data', d2.write(c)))
      proc.on('error', (e) => send('error', e.message))
      proc.on('close', (code) => { code === 0 ? send('end') : send('error', `Push failed (exit code ${code})`); res.end() })
      cleanups.push(() => proc.kill('SIGTERM'))
    } else if (kind === 'build') {
      // Uses the docker CLI (BuildKit, .dockerignore and caching behave exactly as on the command line). No shell involved.
      const dir = path.resolve(String(q.dir || ''))
      if (!fs.statSync(dir).isDirectory()) throw new Error('Build folder not found')
      const file = String(q.file || 'Dockerfile')
      if (file.includes('/') || file.includes('..') || !fs.existsSync(path.join(dir, file))) throw new Error(`No ${file} in that folder`)
      const tag = String(q.tag || '').trim()
      if (tag && !/^[a-z0-9][a-z0-9._\/:-]{0,127}$/.test(tag)) throw new Error('Tag must be lowercase, like myapp:1.0')
      const args = ['build', '--progress=plain', '-f', path.join(dir, file), ...(tag ? ['-t', tag] : []), ...(q.nocache === '1' ? ['--no-cache'] : []), dir]
      const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      const d1 = new StringDecoder('utf8'), d2 = new StringDecoder('utf8')
      proc.stdout.on('data', (c) => send('data', d1.write(c)))
      proc.stderr.on('data', (c) => send('data', d2.write(c)))
      proc.on('error', (e) => send('error', e.message))
      proc.on('close', (code) => { code === 0 ? send('end') : send('error', `Build failed (exit code ${code})`); res.end() })
      cleanups.push(() => proc.kill('SIGTERM'))
    } else if (kind === 'shell') {
      // Host shell on a real pty via a tiny python helper (no native Node modules needed).
      const proc = spawn('python3', [path.join(__dirname, 'pty-shell.py')], { stdio: ['pipe', 'pipe', 'inherit'], cwd: os.homedir() })
      const dec = new StringDecoder('utf8')
      proc.on('error', (e) => send('error', e.message))
      proc.stdin.on('error', () => {}) // the shell may already have exited when a late keystroke arrives
      proc.stdout.on('data', (c) => send('data', dec.write(c)))
      proc.on('close', () => { send('end'); execSessions.delete(q.sid) })
      execSessions.set(q.sid, { write: (d) => proc.stdin.write(d), resize: (cols, rows) => proc.stdin.write(`\x1b[8;${rows};${cols}t`) })
      cleanups.push(() => { proc.kill('SIGHUP'); execSessions.delete(q.sid) })
    } else {
      send('error', 'unknown stream')
    }
  } catch (e) {
    send('error', e.message)
  }
}

// ---------- HTTP server ----------
const files = new Map()
for (const f of fs.readdirSync(PUBLIC, { recursive: true })) {
  const full = path.join(PUBLIC, f)
  if (fs.statSync(full).isFile()) files.set('/' + f.split(path.sep).join('/'), full)
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  // DNS-rebinding / CSRF guard: only our own origin, and a per-launch token for anything that acts.
  const host = req.headers.host || ''
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return res.writeHead(403).end('bad host')
  if (req.headers.origin && req.headers.origin !== `http://${host}`) return res.writeHead(403).end('bad origin')

  const authed = (req.headers['x-token'] || u.searchParams.get('t')) === TOKEN
  if (authed) dropLaunchFile() // first authenticated request means the browser has the token; the file is no longer needed
  try {
    if (u.pathname.startsWith('/download/') || u.pathname === '/upload') {
      if (!authed) return res.writeHead(401).end('unauthorized')
      return await transfer(u, req, res)
    }
    if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/stream/')) {
      if (!authed) return res.writeHead(401).end('unauthorized')
      if (u.pathname.startsWith('/stream/')) {
        return stream(u.pathname.slice(8), Object.fromEntries(u.searchParams), req, res)
      }
      const method = u.pathname.slice(5)
      if (method === 'exec.write' || method === 'exec.resize') {
        const b = JSON.parse(await readBody(req))
        const s = execSessions.get(b.sid)
        if (!s) return res.writeHead(404).end('no session')
        if (method === 'exec.write') s.write(String(b.data))
        else await s.resize(b.cols | 0, b.rows | 0)
        return res.writeHead(204).end()
      }
      const h = handlers[method]
      if (!h || req.method !== 'POST') return res.writeHead(404).end('unknown')
      const args = JSON.parse((await readBody(req)) || '[]')
      const out = await h(...args)
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out ?? null))
      return
    }
    // static
    const p = u.pathname === '/' ? '/index.html' : u.pathname
    const file = files.get(p)
    if (!file) return res.writeHead(404).end('not found')
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: e.message }))
  }
})

// Binary transfers to and from containers (they can't go through the JSON API).
async function transfer(u, req, res) {
  const q = Object.fromEntries(u.searchParams)
  if (u.pathname === '/download/tar' || u.pathname === '/download/file') {
    const id = cid(q.id), p = cpath(q.path), base = safeName(path.posix.basename(p) || 'root')
    const r = await archiveReq(id, p)
    if (u.pathname === '/download/tar') {
      res.writeHead(200, { 'Content-Type': 'application/x-tar', 'Content-Disposition': `attachment; filename="${base}.tar"` })
      req.on('close', () => r.destroy())
      return void r.pipe(res)
    }
    let started = false
    for await (const part of tarEntry(r)) {
      if (part.meta) {
        if (part.meta.type !== '0') { r.destroy(); throw new Error('That is not a regular file. Use the folder download instead.') }
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': part.meta.size, 'Content-Disposition': `attachment; filename="${base}"` })
        started = true; continue
      }
      if (!res.write(part)) await new Promise((ok) => res.once('drain', ok))
    }
    return void (started ? res.end() : (() => { throw new Error('File not found') })())
  }
  if (u.pathname === '/download/logs') {
    const id = cid(q.id)
    const info = await dk('GET', `/containers/${seg(id)}/json`)
    const tail = q.tail === 'all' || !q.tail ? 'all' : String(Math.min(1e6, Math.max(1, Number(q.tail) || 1000)))
    const r = await dockerReq('GET', `/containers/${seg(id)}/logs?stdout=1&stderr=1&tail=${tail}&timestamps=${q.timestamps === '1' ? 1 : 0}`)
    if (r.statusCode >= 400) await failFrom(r)
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${safeName(info.Name.replace(/^\//, ''))}.log"` })
    const dec = new StringDecoder('utf8')
    const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g
    const write = (b) => { const t = q.raw === '1' ? dec.write(b) : dec.write(b).replace(ANSI, ''); if (t) res.write(t) } // colour codes are stripped unless raw=1
    req.on('close', () => r.destroy())
    if (info.Config.Tty) { r.on('data', write) } else {
      let buf = Buffer.alloc(0)
      r.on('data', (c) => { buf = Buffer.concat([buf, c]); while (buf.length >= 8) { const len = buf.readUInt32BE(4); if (buf.length < 8 + len) break; write(buf.subarray(8, 8 + len)); buf = buf.subarray(8 + len) } })
    }
    return void r.on('end', () => res.end())
  }
  if (u.pathname === '/upload' && req.method === 'POST') {
    const id = cid(q.id), dir = cpath(q.path), name = String(q.name || '')
    if (!name || name === '.' || name === '..' || /[\/\0]/.test(name) || Buffer.byteLength(name) > 100) throw new Error('Invalid file name')
    const len = Number(req.headers['content-length'])
    if (!Number.isFinite(len) || len < 0 || len > 512 * 1024 * 1024) throw new Error('File must be smaller than 512 MB')
    const result = await new Promise((resolve, reject) => {
      const dreq = http.request({ socketPath: SOCK, method: 'PUT', path: `/containers/${seg(id)}/archive?path=${enc(dir)}`, headers: { 'Content-Type': 'application/x-tar' } }, async (r) => {
        const body = await readBodyText(r)
        if (r.statusCode >= 400) { let m = ''; try { m = JSON.parse(body).message } catch {} reject(new Error(m || `Docker API ${r.statusCode}`)) } else resolve(true)
      })
      dreq.on('error', reject)
      req.on('aborted', () => dreq.destroy(new Error('Upload cancelled')))
      dreq.write(tarHeader(name, len))
      req.pipe(dreq, { end: false })
      req.on('end', () => { dreq.write(Buffer.alloc(((512 - (len % 512)) % 512) + 1024)); dreq.end() })
    })
    return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: result }))
  }
  res.writeHead(404).end('unknown')
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let s = ''
    req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy() })
    req.on('end', () => resolve(s))
    req.on('error', reject)
  })

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/?t=${TOKEN}`
  // The token must never appear on a command line (readable by every local user via /proc),
  // so only print it when a human is driving this from a terminal, or in headless mode.
  if (process.env.DOCKDESK_NO_OPEN || process.stdout.isTTY) console.log(url)
  if (process.env.DOCKDESK_NO_OPEN) return
  // Restarted by the old copy (see app.relaunch): wait for it to exit first, otherwise the browser hands this window to the old browser process and returns at once
  const old = Number(process.env.DOCKDESK_WAIT_PID) || 0
  const gone = (pid) => { try { process.kill(pid, 0); return false } catch (e) { return e.code !== 'EPERM' } }
  const wait = async () => { for (let i = 0; old && i < 50 && !gone(old); i++) await new Promise((r) => setTimeout(r, 200)); if (old) await new Promise((r) => setTimeout(r, 500)) }
  wait().then(() => openApp(url))
})

// The browser is pointed at a private (0600) file in a private (0700) directory. That page just redirects
// to the real URL, so the token lives only in a file nobody else can read, and the file is deleted on first use.
let launchFile = null
function makeLaunchFile(url) {
  const dir = process.env.XDG_RUNTIME_DIR
    ? path.join(process.env.XDG_RUNTIME_DIR, 'dockdesk')
    : path.join(os.homedir(), '.cache', 'dockdesk')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.chmodSync(dir, 0o700)
  launchFile = path.join(dir, `launch-${crypto.randomBytes(8).toString('hex')}.html`)
  fs.writeFileSync(launchFile, `<!doctype html><meta charset="utf-8"><title>DockDesk</title><meta http-equiv="refresh" content="0;url=${url}">`, { mode: 0o600 })
  return launchFile
}
const dropLaunchFile = () => { if (launchFile) { try { fs.unlinkSync(launchFile) } catch {} launchFile = null } }
process.on('exit', dropLaunchFile)

let appWindow = null
function openApp(url) {
  const target = 'file://' + makeLaunchFile(url)
  const browsers = ['chromium', 'chromium-browser', 'google-chrome', 'brave-browser', 'microsoft-edge']
  const profile = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'dockdesk', 'profile')
  const tryNext = (i) => {
    if (i >= browsers.length) return execFile('xdg-open', [target], () => {})
    const child = appWindow = execFile(browsers[i], [`--app=${target}`, '--class=DockDesk', '--no-first-run', `--user-data-dir=${profile}`], () => {})
    child.on('error', () => tryNext(i + 1))
    // When the app window closes, shut the server down so nothing lingers in the background.
    child.on('exit', (code) => { if (code === 0 || code === null) process.exit(0) })
  }
  tryNext(0)
}
