// Vulnerability scans and long jobs: a stand-in scanner is placed first on PATH, so no real Trivy, Grype or Docker image is needed.
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startServer, shim, janitor, waitFor } from './helpers.mjs'

const J = janitor()
const ID = 'a'.repeat(64)
const FOUND = JSON.stringify({ Results: [{ Target: 't', Vulnerabilities: [
  { VulnerabilityID: 'CVE-1', PkgName: 'zlib', InstalledVersion: '1', FixedVersion: '2', Severity: 'HIGH', Title: 'bad' },
  { VulnerabilityID: 'CVE-2', PkgName: 'curl', InstalledVersion: '1', Severity: 'LOW' }] }] })

describe('scan', () => {
  let srv, dir, mode = 'ok'
  before(async () => {
    dir = J.tmp('scan')
    // `--version` succeeds; otherwise behave like the mode file says: print progress and JSON, or hang. The pid is written BEFORE the first progress line,
    // because the test stops the stream at that line and then looks for the pid (on a slow runner it used to look too early).
    const sh = shim(dir, 'trivy', { body: `case "$1" in --version) exit 0;; esac
if [ "$(cat "${dir}/mode")" = hang ]; then echo $$ > "${dir}/pid"; echo "downloading database" >&2; exec sleep 60; fi
echo "downloading database" >&2
cat <<'JSON'
${FOUND}
JSON` })
    writeFileSync(join(dir, 'mode'), 'ok')
    srv = await startServer({ pathPrefix: sh.bin, env: { XDG_DATA_HOME: join(dir, 'data') } })
  })
  after(() => { srv?.stop(); J.cleanup() })

  it('streams progress, returns normalised results and saves them (0600) by image id', async () => {
    const r = await srv.sse('scan', { ref: 'busybox:latest', id: ID })
    assert.equal(r.final?.k, 'end')
    assert.ok(r.data.some((d) => /downloading database/.test(d)), 'scanner progress reaches the page')
    assert.equal(r.final.d.tool, 'trivy')
    assert.equal(r.final.d.total, 2)
    assert.equal(r.final.d.counts.HIGH, 1)
    assert.equal(r.final.d.items[0].id, 'CVE-1') // most severe first
    const f = join(dir, 'data', 'dockdesk', 'scans', `${ID}.json`)
    assert.equal(statSync(f).mode & 0o777, 0o600)
    const last = await srv.call('scan.last', ID)
    assert.equal(last.total, 2)
    assert.ok(last.at > 0)
  })
  it('only image ids are saved, and scan.last ignores anything else', async () => {
    await srv.sse('scan', { ref: 'busybox:latest', id: '../../etc/passwd' })
    assert.equal(await srv.call('scan.last', '../../etc/passwd'), null)
    assert.equal(await srv.call('scan.last', 'busybox:latest'), null)
  })
  it('refuses an invalid image reference on the stream too', async () => {
    const r = await srv.sse('scan', { ref: '--output=/etc/x', id: ID })
    assert.equal(r.final?.k, 'error')
    assert.match(r.final.d, /Invalid image reference/)
  })
  it('closing the stream (Cancel) stops the scanner', async () => {
    writeFileSync(join(dir, 'mode'), 'hang')
    const pidFile = join(dir, 'pid')
    await srv.sse('scan', { ref: 'busybox:latest', id: 'b'.repeat(64) }, { until: (d) => d.length > 0 }) // aborts after the first progress line
    const pid = Number(readFileSync(pidFile, 'utf8'))
    await waitFor(() => { try { process.kill(pid, 0); return false } catch { return true } }, { what: 'scanner to be stopped', timeout: 10000 })
    assert.ok(!existsSync(join(dir, 'data', 'dockdesk', 'scans', `${'b'.repeat(64)}.json`)), 'a cancelled scan saves nothing')
  })
})
