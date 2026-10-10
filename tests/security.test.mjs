// Security and input-validation tests. Most need no Docker: they prove requests are refused before anything privileged happens.
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { statSync, readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { startServer, janitor, shim, waitFor, sleep, ROOT } from './helpers.mjs'

// fetch() cannot set Host/Origin the way an attacker's page or DNS-rebinding trick would, so use raw http.
const rawHttp = (base, { path = '/', method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const u = new URL(base)
  const req = http.request({ host: u.hostname, port: u.port, path, method, headers }, (res) => {
    let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => resolve({ status: res.statusCode, text: t }))
  })
  req.on('error', reject)
  req.end(body)
})

describe('access control', () => {
  let J, srv
  before(async () => { J = janitor(); srv = await startServer({ env: { XDG_DATA_HOME: J.tmp('xdg') } }) })
  after(() => { srv?.stop(); J.cleanup() })

  it('refuses a foreign Host header (DNS rebinding)', async () => {
    const r = await rawHttp(srv.base, { path: '/api/ping', method: 'POST', headers: { host: 'evil.example:80', 'x-token': srv.token } })
    assert.equal(r.status, 403)
  })
  it('refuses a foreign Origin header (CSRF), even with a valid token', async () => {
    const host = new URL(srv.base).host
    const r = await rawHttp(srv.base, { path: '/api/ping', method: 'POST', headers: { host, origin: 'http://evil.example', 'x-token': srv.token } })
    assert.equal(r.status, 403)
  })
  it('requires the token for API, streams, downloads and uploads', async () => {
    for (const [path, method] of [['/api/ping', 'POST'], ['/stream/events', 'GET'], ['/download/logs?id=x', 'GET'], ['/download/file?id=x&path=/', 'GET'], ['/download/tar?id=x&path=/', 'GET'], ['/upload?id=x&path=/&name=a', 'POST']]) {
      const r = await srv.raw(path, { method })
      assert.equal(r.status, 401, `${method} ${path} should be 401, got ${r.status}`)
    }
  })
  it('rejects a wrong token', async () => {
    const r = await srv.raw('/api/ping', { method: 'POST', headers: { 'X-Token': 'nope' } })
    assert.equal(r.status, 401)
  })
  it('answers 404 for unknown API methods and for GET on API methods', async () => {
    assert.equal((await srv.raw('/api/definitely.not.real', { method: 'POST', headers: { 'X-Token': srv.token } })).status, 404)
    assert.equal((await srv.raw('/api/ping', { headers: { 'X-Token': srv.token } })).status, 404)
  })
  it('serves the app shell without a token, and never embeds the token in it', async () => {
    const r = await srv.raw('/')
    assert.equal(r.status, 200)
    assert.match(r.text, /DockDesk/)
    assert.ok(!r.text.includes(srv.token))
  })
  it('cannot be tricked into serving files outside public/', async () => {
    for (const p of ['/../server.js', '/%2e%2e/server.js', '/..%2fserver.js', '/public/../server.js', '/server.js', '//etc/passwd']) {
      const r = await srv.raw(p)
      assert.equal(r.status, 404, `${p} -> ${r.status}`)
    }
  })
})

describe('launch token never reaches a command line', () => {
  let J, dir, proc, out = '', args = '', launchPath, runDir
  before(async () => {
    J = janitor(); dir = J.tmp('launch'); runDir = join(dir, 'run'); mkdirSync(runDir, { mode: 0o700 })
    const fake = shim(dir, 'chromium', { body: 'sleep 20' }) // stands in for the browser and records exactly what it was given
    proc = spawn('node', [join(ROOT, 'server.js')], { env: { ...process.env, PATH: fake.bin + ':' + process.env.PATH, XDG_RUNTIME_DIR: runDir, XDG_CACHE_HOME: join(dir, 'cache'), DOCKDESK_NO_OPEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
    proc.stdout.on('data', (c) => (out += c))
    args = await waitFor(() => (existsSync(fake.log) ? readFileSync(fake.log, 'utf8') : ''), { what: 'the browser to be launched' })
    launchPath = /--app=file:\/\/(.+)/.exec(args)?.[1]
  })
  after(() => { proc?.kill('SIGTERM'); J.cleanup() })

  it('opens a private file:// page, not an http:// URL with the token', () => {
    assert.ok(launchPath, `browser args were: ${args}`)
    assert.ok(!/https?:\/\//.test(args), 'no http URL on the command line')
  })
  it('keeps the token out of the arguments and out of stdout', () => {
    const token = /t=(\w+)/.exec(readFileSync(launchPath, 'utf8'))?.[1]
    assert.ok(token, 'launch file should hold the token')
    assert.ok(!args.includes(token), 'token must not be in browser args')
    assert.equal(out, '', 'nothing may be printed when stdout is not a terminal')
  })
  it('stores the redirect in a 0600 file inside a 0700 directory', () => {
    assert.equal(statSync(launchPath).mode & 0o777, 0o600)
    assert.equal(statSync(join(launchPath, '..')).mode & 0o777, 0o700)
  })
  it('deletes the launch file after the first authenticated request', async () => {
    const url = /url=([^"]+)/.exec(readFileSync(launchPath, 'utf8'))[1]
    const r = await fetch(url)
    assert.equal(r.status, 200)
    await waitFor(() => !existsSync(launchPath), { what: 'launch file removal' })
  })
})

describe('every run gets its own browser profile', () => {
  let J
  before(() => { J = janitor() })
  after(() => J.cleanup())
  // Starts the server with a stand-in browser and returns what the browser was given.
  const launch = async (dir, cache = join(dir, 'cache')) => {
    const runDir = join(dir, 'run'); mkdirSync(runDir, { recursive: true, mode: 0o700 })
    const fake = shim(dir, 'chromium', { body: 'sleep 20' })
    const proc = spawn('node', [join(ROOT, 'server.js')], { env: { ...process.env, PATH: fake.bin + ':' + process.env.PATH, XDG_RUNTIME_DIR: runDir, XDG_CACHE_HOME: cache, DOCKDESK_NO_OPEN: '' }, stdio: 'ignore' })
    const args = await waitFor(() => (existsSync(fake.log) ? readFileSync(fake.log, 'utf8') : ''), { what: 'the browser to be launched' })
    return { proc, args, profile: /--user-data-dir=(.+)/.exec(args)?.[1], exited: new Promise((ok) => proc.on('exit', (code) => ok(code))) }
  }
  it('uses a folder named after the server process, so two copies can never share (or be handed to) one browser', async () => {
    const cache = join(J.tmp('cache'), 'c')
    const a = await launch(J.tmp('a'), cache), b = await launch(J.tmp('b'), cache)
    try {
      assert.equal(a.profile, join(cache, 'dockdesk', `profile-${a.proc.pid}`)); assert.equal(b.profile, join(cache, 'dockdesk', `profile-${b.proc.pid}`))
      assert.notEqual(a.profile, b.profile)
    } finally { a.proc.kill('SIGTERM'); b.proc.kill('SIGTERM') }
  })
  it('removes its profile when it stops, also on Ctrl+C / kill, and exits cleanly', async () => {
    const dir = J.tmp('gone'), { proc, profile, exited } = await launch(dir)
    mkdirSync(profile, { recursive: true }); writeFileSync(join(profile, 'x'), 'x') // what the browser would have created
    proc.kill('SIGINT')
    assert.equal(await exited, 0)
    assert.ok(!existsSync(profile), 'the throwaway profile is deleted')
  })
  it('sweeps profiles of runs that are gone, and nothing else', async () => {
    const dir = J.tmp('sweep'), cache = join(dir, 'cache'), root = join(cache, 'dockdesk')
    const mk = (n) => { mkdirSync(join(root, n), { recursive: true }); writeFileSync(join(root, n, 'f'), 'x') }
    for (const n of ['profile-2147483000', `profile-${process.pid}`, 'profile', 'profile-abc', 'profile-1x']) mk(n) // dead run, live run (this test process), the old shared profile, two lookalikes
    const { proc } = await launch(dir, cache)
    try {
      await waitFor(() => !existsSync(join(root, 'profile-2147483000')), { what: 'the dead run\'s profile to be removed' })
      for (const n of [`profile-${process.pid}`, 'profile', 'profile-abc', 'profile-1x']) assert.ok(existsSync(join(root, n, 'f')), `${n} must be left alone`)
    } finally { proc.kill('SIGTERM') }
  })
  it('copes with a cache folder that does not exist yet', async () => {
    const { proc, args } = await launch(J.tmp('fresh'))
    try { assert.match(args, /--app=file:\/\//) } finally { proc.kill('SIGTERM') }
  })
})

describe('input validation (refused before anything privileged runs)', () => {
  let J, srv
  before(async () => { J = janitor(); srv = await startServer({ env: { XDG_DATA_HOME: J.tmp('xdg') } }) })
  after(() => { srv?.stop(); J.cleanup() })
  const rejects = (method, args, re) => assert.rejects(srv.call(method, ...args), re)

  it('container.run refuses unsafe or invalid options', async () => {
    const base = { image: 'x' }
    await rejects('container.run', [{ ...base, name: '../x' }], /Invalid container name/)
    await rejects('container.run', [{ ...base, caps: ['NET ADMIN;id'] }], /Invalid capability/)
    await rejects('container.run', [{ ...base, devices: ['/etc/passwd'] }], /Invalid device/)
    await rejects('container.run', [{ ...base, devices: ['/dev/../etc/shadow'] }], /Invalid device/)
    await rejects('container.run', [{ ...base, network: 'a b' }], /Invalid network/)
    await rejects('container.run', [{ ...base, restart: 'sometimes' }], /Invalid restart/)
    await rejects('container.run', [{ ...base, memoryMb: 99999999999 }], /Invalid memory/)
    await rejects('container.run', [{ ...base, ports: [{ host: 'x', container: '80' }] }], /Invalid host port/)
    await rejects('container.run', [{ ...base, ports: [{ host: '80', container: 'abc' }] }], /Invalid container port/)
  })
  it('container.update, volume, network and tag names are validated', async () => {
    await rejects('volume.create', ['bad name!'], /Invalid volume name/)
    await rejects('network.create', ['bad name!'], /Invalid network name/)
    await rejects('network.create', ['ok-name', 'not-a-cidr'], /Subnet/)
    await rejects('image.tag', ['x', 'Bad Name', '1'], /lowercase/)
    await rejects('image.tag', ['x', 'good/name', 'bad tag'], /Invalid tag/)
    await rejects('image.scan', ['--output=/etc/x; id'], /Invalid image reference/)
    await rejects('image.scan', ['-flag'], /Invalid image reference/)
    await rejects('container.write', ['../x', '/etc/hosts', 'x'], /Invalid container/)
    await rejects('compose.service', ['ok', '/tmp', '/etc/hosts', 'web', 'restart'], /not one DockDesk may use/)
    await rejects('compose.service', ['ok', '/tmp', '', '--rm', 'restart'], /Invalid service/)
    await rejects('compose.env.write', ['/etc/hosts', 'A=1'], /not one DockDesk may use/)
    await rejects('compose.graph', ['/etc/hosts'], /not one DockDesk may use/)
  })
  it('open.url only ever opens local http addresses', async () => {
    for (const u of ['http://evil.com/x', 'https://localhost:3000', 'javascript:alert(1)', 'file:///etc/passwd', 'http://localhost:3000/a b', 'http://localhost:99999999999', 'http://localhost.evil.com:80', 'http://127.0.0.1@evil.com:80/'])
      await rejects('open.url', [u], /refusing to open/)
  })
  it('hub.search and registry.login reject malformed input', async () => {
    await rejects('hub.search', ['a b;c'], /Invalid search term/)
    await rejects('registry.login', ['bad host!', 'user', 'pw'], /Invalid registry/)
    await rejects('registry.login', ['', 'bad user', 'pw'], /Invalid username/)
    await rejects('registry.login', ['', 'user', 'line\nbreak'], /Invalid password/)
    await rejects('registry.login', ['', 'user', ''], /Invalid password/)
    await rejects('registry.logout', ['bad host!'], /Invalid registry/)
  })
  it('compose.save and compose.validate refuse bad names and empty files', async () => {
    for (const n of ['../x', 'UPPER', '', 'a b', 'x/y', '-lead']) await rejects('compose.save', [n, 'services: {}'], /Project name/)
    await rejects('compose.validate', [''], /empty/)
    await rejects('compose.save', ['ok-name', ''], /empty or too large/)
  })
  it('file endpoints refuse relative paths and malformed container ids', async () => {
    await rejects('container.ls', ['abc', 'relative/path'], /absolute/)
    await rejects('container.ls', ['abc; id', '/'], /Invalid container/)
    await rejects('container.cat', ['abc', 'etc/passwd'], /absolute/)
    await rejects('container.ls', ['abc', '/\0x'], /absolute/)
    const h = { 'X-Token': srv.token }
    assert.equal((await srv.raw(`/download/file?id=${encodeURIComponent('a;b')}&path=/etc/passwd`, { headers: h })).status, 500)
    assert.equal((await srv.raw('/download/file?id=abc&path=relative', { headers: h })).status, 500)
    const up = await srv.raw('/upload?id=abc&path=/tmp&name=..%2Fevil', { method: 'POST', headers: h, body: 'x' })
    assert.match(up.json.error, /Invalid file name/)
  })
  it('refuses uploads that claim to be larger than 512 MB before reading them', async () => {
    const host = new URL(srv.base).host
    const r = await rawHttp(srv.base, { path: '/upload?id=abc&path=/tmp&name=huge.bin', method: 'POST', headers: { host, 'x-token': srv.token, 'content-length': '600000000' } })
    assert.equal(r.status, 500)
    assert.match(r.text, /512 MB/)
  })
})

describe('docker group management never changes anything by itself', () => {
  let J, srv, fake
  const me = userInfo()
  const hasDockerGroup = (() => { try { execFileSync('getent', ['group', 'docker'], { stdio: 'pipe' }); return true } catch { return false } })()
  before(async () => {
    J = janitor()
    const dir = J.tmp('pk'); fake = shim(dir, 'pkexec') // pkexec is replaced by a recorder, so nothing real can happen
    srv = await startServer({ pathPrefix: fake.bin, env: { XDG_DATA_HOME: J.tmp('xdg') } })
  })
  after(() => { srv?.stop(); J.cleanup() })
  const skip = !hasDockerGroup ? 'no docker group on this system' : false

  it('only regular local users can be targeted', { skip }, async () => {
    for (const u of ['root', 'daemon', 'nobody', 'yaswanth; id', '-a', 'ghost-user-xyz', '']) await assert.rejects(srv.call('group.set', u, true), /not a regular local user/, `user ${JSON.stringify(u)}`)
    await assert.rejects(srv.call('group.set', me.username, 'yes'), /Invalid request/)
    assert.ok(!existsSync(fake.log), 'pkexec must not have been called by rejected requests')
  })
  it('a real change goes through pkexec with an argument list and the hard-coded group', { skip: skip || (me.uid < 1000 ? 'run as a regular user' : false) }, async () => {
    const list = await srv.call('group.list')
    const self = list.users.find((u) => u.you)
    if (!self || self.primary) return // nothing to toggle safely
    await srv.call('group.set', me.username, !self.member)
    const argv = readFileSync(fake.log, 'utf8').trim().split('\n')
    assert.deepEqual(argv, ['gpasswd', self.member ? '-d' : '-a', me.username, 'docker'])
  })
  it('setting the state a user already has is a no-op', { skip: skip || (me.uid < 1000 ? 'run as a regular user' : false) }, async () => {
    const self = (await srv.call('group.list')).users.find((u) => u.you)
    if (!self || self.primary) return
    const before = existsSync(fake.log) ? readFileSync(fake.log, 'utf8') : ''
    assert.equal(await srv.call('group.set', me.username, self.member), 'unchanged')
    assert.equal(existsSync(fake.log) ? readFileSync(fake.log, 'utf8') : '', before)
  })
})

describe('a missing Compose plugin is explained, not shown as a raw error', () => {
  let J, srv
  before(async () => {
    J = janitor()
    // a docker that lacks the compose plugin: `docker compose …` fails exactly like on Debian 12; everything else is passed through
    const real = (() => { try { return execFileSync('which', ['docker'], { encoding: 'utf8' }).trim() } catch { return '/bin/false' } })()
    // `login` also fails instantly, without reading the password we pipe to it
    const fake = shim(J.tmp('nocompose'), 'docker', { body: `case "$1" in compose) echo "docker: 'compose' is not a docker command." >&2; exit 1;; login) echo "Error: unreachable registry" >&2; exit 1;; esac\nexec ${real} "$@"` })
    srv = await startServer({ pathPrefix: fake.bin, env: { XDG_DATA_HOME: J.tmp('xdg') } })
  })
  after(() => { srv?.stop(); J.cleanup() })
  it('reports compose as absent in the engine diagnostics', async () => assert.equal((await srv.call('engine.diag')).compose, null))
  it('names the install command for this distro in the diagnostics and the error', async () => {
    const d = await srv.call('engine.diag')
    if (d.composeHint) {
      assert.match(d.composeHint.cmd, /^sudo (apt install|dnf install|pacman -S|zypper install|apk add) \S*compose\S*$/)
      await assert.rejects(srv.call('compose.validate', 'services:\n  a:\n    image: x\n'), (e) => e.message.includes(d.composeHint.cmd) && e.message.includes(d.composeHint.distro))
    } else assert.equal(d.composeHint, null)
    assert.equal(typeof d.groupPending, 'boolean')
  })
  it('tells the user how to install it when validating or running a compose file', async () => {
    await assert.rejects(srv.call('compose.validate', 'services:\n  a:\n    image: x\n'), /Docker Compose v2 is not installed.*docker-compose/s)
    await assert.rejects(srv.call('compose.action', 'proj', '', '', 'up'), /Docker Compose v2 is not installed/)
  })
  // Regression: a command that exits before reading its stdin used to raise an unhandled EPIPE and kill the whole server
  // (found by CI on Node 18). Hammer both stdin-fed commands and prove the server survives and keeps answering.
  const alive = async () => { assert.equal(srv.proc.exitCode, null, 'the server process must still be running'); assert.equal((await srv.raw('/')).status, 200) }
  it('survives compose commands that exit before reading their input', async () => {
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => srv.call('compose.validate', 'services:\n  a:\n    image: x\n'.repeat(500))))
    assert.ok(results.every((r) => r.status === 'rejected' && /Docker Compose v2 is not installed/.test(r.reason.message)), results.map((r) => r.reason?.message).find((m) => !/Docker Compose v2/.test(m || '')) || 'every call should get the friendly message')
    await alive()
  })
  it('survives registry logins that exit before reading the password', async () => {
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => srv.call('registry.login', '', 'someone', 'x'.repeat(3000))))
    assert.ok(results.every((r) => r.status === 'rejected' && /unreachable registry|Login failed/.test(r.reason.message)), results.map((r) => r.reason?.message).find((m) => !/unreachable|Login failed/.test(m || '')) || 'every call should fail with the command\'s message')
    await alive()
  })
})
