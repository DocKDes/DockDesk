// Release-readiness checks: licence files, metadata, the .deb, the tarball and the no-root installer. No Docker needed.
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, janitor, waitFor } from './helpers.mjs'

const read = (f) => readFileSync(join(ROOT, f), 'utf8')
const pkg = JSON.parse(read('package.json'))
const haveDpkg = spawnSync('which', ['dpkg-deb'], { stdio: 'ignore' }).status === 0
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })

describe('licence and metadata', () => {
  it('ships an MIT licence naming the author', () => {
    const l = read('LICENSE'); assert.match(l, /^MIT License/); assert.match(l, /Copyright \(c\) 20\d\d Panem Yaswanth Reddy/); assert.match(l, /THE SOFTWARE IS PROVIDED "AS IS"/)
    assert.equal(pkg.license, 'MIT')
  })
  it('credits the bundled terminal library', () => {
    const n = read('THIRD_PARTY_NOTICES.md'); assert.match(n, /xterm\.js/); assert.match(n, /MIT/); assert.match(n, /Christopher Jeffrey/)
    for (const f of ['xterm.js', 'addon-fit.js', 'xterm.css']) assert.ok(existsSync(join(ROOT, 'public/vendor', f)), f)
  })
  it('declares the package details a public release needs', () => {
    assert.match(pkg.author, /Panem Yaswanth Reddy <panemyaswanthreddy@gmail\.com>/)
    assert.equal(pkg.engines.node, '>=18.17'); assert.deepEqual(pkg.os, ['linux']); assert.equal(pkg.bin.dockdesk, 'bin/dockdesk')
    for (const f of pkg.files) assert.ok(existsSync(join(ROOT, f)), `package.json "files" lists a missing path: ${f}`)
  })
  it('keeps the version consistent between package.json and the changelog', () => {
    assert.match(read('CHANGELOG.md'), new RegExp(`^## ${pkg.version.replace(/\./g, '\\.')} \\(`, 'm'))
  })
  it('has a security policy with a private reporting address', () => assert.match(read('SECURITY.md'), /panemyaswanthreddy@gmail\.com/))
  it('has CI and release workflows that run the tests', () => {
    assert.match(read('.github/workflows/ci.yml'), /npm test/); const r = read('.github/workflows/release.yml')
    assert.match(r, /npm test/); assert.match(r, /packaging\/release\.sh/); assert.match(r, /package\.json/)
  })
  it('contains no personal paths in shipped files', () => {
    for (const f of ['server.js', 'pty-shell.py', 'public/app.js', 'public/index.html', 'public/style.css', 'install.sh', 'uninstall.sh', 'README.md', 'packaging/build-deb.sh', 'packaging/release.sh']) {
      const hits = (read(f).match(/\/home\/(?!you\b)[a-z][\w-]*/gi) || []); assert.deepEqual(hits, [], `${f} mentions a real home directory`)
    }
  })
})

describe('release artifacts', { skip: haveDpkg ? false : 'dpkg-deb is not installed' }, () => {
  let J, rel, deb, tgz
  before(() => {
    J = janitor()
    sh('sh', ['packaging/release.sh'], { cwd: ROOT })
    rel = join(ROOT, 'dist/release'); deb = join(rel, `dockdesk_${pkg.version}_all.deb`); tgz = join(rel, `dockdesk-${pkg.version}.tar.gz`)
  })
  after(() => J.cleanup())

  it('builds a .deb, a tarball and verifiable checksums', () => {
    for (const f of [deb, tgz, join(rel, 'SHA256SUMS')]) assert.ok(existsSync(f), f)
    assert.equal(spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: rel }).status, 0, 'checksums verify')
    assert.ok(statSync(deb).size < 400 * 1024, 'the package stays small')
  })
  it('puts the right metadata in the .deb', () => {
    const info = sh('dpkg-deb', ['-I', deb])
    assert.match(info, new RegExp(`Version: ${pkg.version.replace(/\./g, '\\.')}`)); assert.match(info, /Maintainer: Panem Yaswanth Reddy <panemyaswanthreddy@gmail\.com>/)
    assert.match(info, /Depends: nodejs \(>= 18\.17\)/); assert.match(info, /Recommends: docker\.io \| docker-ce/); assert.match(info, /docker-compose \(>= 2\)/, 'Kali/Debian 13 name Compose v2 "docker-compose"; the version bound keeps Debian 12\'s old v1 out'); assert.match(info, /does\s+not bundle one/)
  })
  it('installs licence, notices, security policy, changelog and a Debian copyright file', () => {
    const files = sh('dpkg-deb', ['-c', deb])
    for (const f of ['usr/share/doc/dockdesk/LICENSE', 'usr/share/doc/dockdesk/THIRD_PARTY_NOTICES.md', 'usr/share/doc/dockdesk/copyright', 'usr/share/doc/dockdesk/changelog.gz', 'usr/share/doc/dockdesk/README.md', 'opt/dockdesk/server.js', 'opt/dockdesk/pty-shell.py', 'usr/bin/dockdesk', 'usr/share/applications/dockdesk.desktop']) assert.ok(files.includes(f), `missing ${f}`)
    assert.ok(!/\/tests\//.test(files), 'tests are not shipped'); assert.ok(!/node_modules|\.git\//.test(files))
  })
  it('the launcher in the .deb starts a working server from the installed location', async () => {
    const dir = J.tmp('deb'); sh('dpkg-deb', ['-x', deb, dir])
    assert.match(readFileSync(join(dir, 'usr/bin/dockdesk'), 'utf8'), /node \/opt\/dockdesk\/server\.js/)
    const { spawn } = await import('node:child_process')
    const p = spawn('node', [join(dir, 'opt/dockdesk/server.js')], { env: { ...process.env, DOCKDESK_NO_OPEN: '1', HOME: join(dir, 'home'), XDG_DATA_HOME: join(dir, 'data') }, stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      let out = ''; p.stdout.on('data', (c) => (out += c)); const m = await waitFor(() => /(http:\/\/127\.0\.0\.1:\d+)\//.exec(out), { what: 'the packaged server to start' })
      assert.equal((await fetch(m[1] + '/')).status, 200); assert.ok(statSync(join(dir, 'opt/dockdesk/public/vendor/xterm.js')).size > 1000)
    } finally { p.kill('SIGTERM') }
  })
  it('the tarball installs without root into a clean home, runs, and uninstalls cleanly', async () => {
    const work = J.tmp('tgz'), home = join(work, 'home'); mkdirSync(home)
    sh('tar', ['xzf', tgz, '-C', work]); const src = join(work, `dockdesk-${pkg.version}`)
    for (const f of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'install.sh']) assert.ok(existsSync(join(src, f)), `tarball lacks ${f}`)
    const env = { ...process.env, HOME: home, XDG_DATA_HOME: '', XDG_CACHE_HOME: '' }
    assert.match(sh('sh', [join(src, 'install.sh')], { env }), /Installed/)
    for (const f of ['.local/bin/dockdesk', '.local/share/dockdesk/server.js', '.local/share/dockdesk/pty-shell.py', '.local/share/dockdesk/public/index.html', '.local/share/applications/dockdesk.desktop']) assert.ok(existsSync(join(home, f)), `install.sh did not create ${f}`)
    assert.match(readFileSync(join(home, '.local/share/applications/dockdesk.desktop'), 'utf8'), new RegExp(`Exec=${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.local/bin/dockdesk`))
    const { spawn } = await import('node:child_process')
    const p = spawn(join(home, '.local/bin/dockdesk'), [], { env: { ...env, DOCKDESK_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    try { let out = ''; p.stdout.on('data', (c) => (out += c)); const m = await waitFor(() => /(http:\/\/127\.0\.0\.1:\d+)\//.exec(out), { what: 'the installed launcher to start' }); assert.equal((await fetch(m[1] + '/')).status, 200) } finally { p.kill('SIGTERM') }
    sh('sh', [join(src, 'uninstall.sh')], { env })
    for (const f of ['.local/bin/dockdesk', '.local/share/dockdesk', '.local/share/applications/dockdesk.desktop']) assert.ok(!existsSync(join(home, f)), `uninstall.sh left ${f}`)
  })
})
