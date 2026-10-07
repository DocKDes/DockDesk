// Shared helpers for the DockDesk test suite. No dependencies: Node's built-in test runner only.
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const RUN = Math.random().toString(36).slice(2, 8)
export const PREFIX = `ddtest-${RUN}` // everything the tests create starts with this, so cleanup can never touch your own objects
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const dockerAvailable = () => spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
export const composeAvailable = () => spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0
export function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
export const dockerTry = (...args) => { try { return docker(...args) } catch { return '' } }
const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean)

export async function waitFor(fn, { timeout = 15000, every = 250, what = 'condition' } = {}) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v } catch (e) { last = e }
    await sleep(every)
  }
  throw new Error(`Timed out waiting for ${what}${last ? ': ' + last.message : ''}`)
}

// Creates temp dirs and cleans up every Docker object whose name starts with PREFIX (plus any volume created during the run).
export function janitor() {
  const volumesBefore = new Set(lines(dockerTry('volume', 'ls', '-q')))
  const dirs = []
  let pulled = null
  return {
    tmp(label = 't') { const d = mkdtempSync(join(tmpdir(), `${PREFIX}-${label}-`)); dirs.push(d); return d },
    // A small local image that has a shell, sleep and ls. Pulls alpine only if nothing suitable exists (and removes it afterwards).
    image() {
      if (process.env.DD_TEST_IMAGE) return process.env.DD_TEST_IMAGE
      const have = lines(dockerTry('images', '--format', '{{.Repository}}:{{.Tag}}'))
      const pick = ['busybox:latest', 'alpine:latest', 'alpine:3'].find((t) => have.includes(t)) || have.find((t) => /alpine/.test(t) && !t.includes('<none>'))
      if (pick) return pick
      docker('pull', 'alpine:3'); pulled = 'alpine:3'
      return 'alpine:3'
    },
    cleanup() {
      for (const id of lines(dockerTry('ps', '-aq', '--filter', `name=${PREFIX}`))) dockerTry('rm', '-fv', id)
      for (const id of lines(dockerTry('network', 'ls', '-q', '--filter', `name=${PREFIX}`))) dockerTry('network', 'rm', id)
      for (const t of lines(dockerTry('images', '--format', '{{.Repository}}:{{.Tag}}'))) if (t.startsWith(PREFIX + '/') || t.startsWith(`localhost:`) && t.includes(PREFIX)) dockerTry('rmi', '-f', t)
      for (const v of lines(dockerTry('volume', 'ls', '-q'))) {
        const mine = v.startsWith(PREFIX) || (!volumesBefore.has(v) && !dockerTry('ps', '-aq', '--filter', `volume=${v}`))
        if (mine) dockerTry('volume', 'rm', v)
      }
      if (pulled) dockerTry('rmi', pulled)
      for (const d of dirs) rmSync(d, { recursive: true, force: true })
    }
  }
}

// Starts a real DockDesk server on a random port and returns small helpers to talk to it.
export async function startServer({ env = {}, pathPrefix } = {}) {
  const e = { ...process.env, DOCKDESK_NO_OPEN: '1', ...env }
  if (pathPrefix) e.PATH = pathPrefix + ':' + e.PATH
  const proc = spawn('node', [join(ROOT, 'server.js')], { env: e, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  proc.stderr.on('data', (c) => (stderr += c))
  const [, base, token] = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start: ' + stderr)), 10000)
    proc.stdout.on('data', (d) => { const m = /(http:\/\/127\.0\.0\.1:\d+)\/\?t=(\w+)/.exec(String(d)); if (m) { clearTimeout(t); resolve(m) } })
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited early (${c}): ${stderr}`)) })
  })
  const headers = { 'X-Token': token }
  const api = {
    base, token, proc,
    url: `${base}/?t=${token}`,
    // POST /api/<method>; returns the JSON result, or throws Error(message) on failure
    async call(method, ...args) {
      const r = await fetch(`${base}/api/${method}`, { method: 'POST', headers, body: JSON.stringify(args) })
      const text = await r.text()
      let j = null; try { j = text ? JSON.parse(text) : null } catch { j = text }
      if (!r.ok) throw new Error(j?.error || text || r.statusText)
      return j
    },
    // like call() but returns { status, body } so negative tests can look at the status
    async raw(path, opts = {}) {
      const r = await fetch(base + path, opts)
      const text = await r.text()
      let json = null; try { json = JSON.parse(text) } catch {}
      return { status: r.status, text, json, headers: r.headers }
    },
    // GET /stream/<kind> (server-sent events). Stops at the first end/error event, after `ms`, or when `until(data)` is true.
    async sse(kind, params = {}, { ms = 60000, until } = {}) {
      const u = new URL(`${base}/stream/${kind}`)
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
      u.searchParams.set('t', token)
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), ms)
      const data = []; let final = null, buf = ''
      try {
        const res = await fetch(u, { signal: ctrl.signal })
        for await (const chunk of res.body) {
          buf += Buffer.from(chunk).toString()
          let i
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const ev = buf.slice(0, i); buf = buf.slice(i + 2)
            if (!ev.startsWith('data: ')) continue
            const m = JSON.parse(ev.slice(6))
            if (m.k === 'data') { data.push(m.d); if (until?.(data)) { ctrl.abort(); return { data, final } } } else { final = m; ctrl.abort(); return { data, final } }
          }
        }
      } catch (err) { if (err.name !== 'AbortError') throw err } finally { clearTimeout(timer) }
      return { data, final }
    },
    stop() { proc.kill('SIGTERM') }
  }
  return api
}

// A fake executable placed first on PATH, recording its arguments to a file (so tests can prove what would have been run).
export function shim(dir, name, { body = '' } = {}) {
  const bin = join(dir, 'bin'); mkdirSync(bin, { recursive: true })
  const log = join(dir, `${name}.args`)
  writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${log}"\n${body}\n`)
  chmodSync(join(bin, name), 0o755)
  return { bin, log }
}
export const exists = existsSync
