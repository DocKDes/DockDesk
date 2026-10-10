// "Download and verify": a stand-in release server, no Docker and no internet. The download must match SHA256SUMS, stay on release
// addresses, respect size limits, never install anything, and never write a bad file.
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { startServer, janitor, waitFor } from './helpers.mjs'
import { openPage, uiSkipReason } from './cdp.mjs'

const J = janitor()
const DEB = Buffer.from('pretend this is a .deb ' + 'x'.repeat(5000))
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const NAME = 'dockdesk_99.0.0_all.deb'

describe('update download', () => {
  let srv, rel, relPort, cache, mode = {}, version = '99.0.0', upd
  const start = async (kind = 'deb') => {
    if (srv) srv.stop()
    srv = await startServer({ env: { XDG_CACHE_HOME: cache, DOCKDESK_UPDATE_URL: `http://127.0.0.1:${upd.address().port}/latest`, DOCKDESK_RELEASE_URL: `http://127.0.0.1:${relPort}/releases`, DOCKDESK_INSTALL_KIND: kind } })
  }
  const dl = () => join(cache, 'dockdesk', 'updates')
  before(async () => {
    cache = J.tmp('upd')
    upd = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ version })) })
    await new Promise((ok) => upd.listen(0, '127.0.0.1', ok))
    rel = http.createServer((q, r) => {
      const send = (code, body, h = {}) => { r.writeHead(code, h); r.end(body) }
      if (q.url.endsWith('/SHA256SUMS')) return send(200, mode.sums ?? `${sha(DEB)}  ${NAME}\n${'0'.repeat(64)}  dockdesk-99.0.0.tar.gz\n`)
      if (q.url.endsWith(NAME)) return mode.redirect ? send(302, '', { Location: mode.redirect }) : mode.big ? send(200, Buffer.alloc(17 << 20)) : send(200, mode.tamper ? Buffer.concat([DEB, Buffer.from('!')]) : DEB)
      send(404, 'no')
    })
    await new Promise((ok) => rel.listen(0, '127.0.0.1', ok))
    relPort = rel.address().port
    await start()
  })
  after(() => { srv?.stop(); upd?.close(); rel?.close(); J.cleanup() })

  it('downloads, checks the checksum, saves the file privately, and installs nothing', async () => {
    mode = {}
    const r = await srv.call('update.download')
    assert.equal(r.version, '99.0.0'); assert.equal(r.name, NAME); assert.equal(r.sha256, sha(DEB))
    assert.equal(r.install, `sudo apt install ${r.file}`)
    assert.equal(r.file, join(dl(), NAME))
    assert.deepEqual(readFileSync(r.file), DEB)
    assert.equal(statSync(r.file).mode & 0o777, 0o600); assert.equal(statSync(dl()).mode & 0o777, 0o700)
    assert.ok(['verified', 'unavailable'].includes(r.attestation.state), 'attestation is checked when gh exists, and said to be unchecked when not')
    assert.deepEqual(readdirSync(dl()), [NAME], 'only the file, no leftovers')
  })
  it('a file that does not match its published checksum is refused and not saved', async () => {
    await start(); mode = { tamper: true }
    await assert.rejects(() => srv.call('update.download'), /does not match its published checksum/)
    assert.deepEqual(readdirSync(dl()), [NAME], 'no partial or bad file left behind')
    assert.deepEqual(readFileSync(join(dl(), NAME)), DEB, 'the earlier good download is untouched')
  })
  it('a release whose SHA256SUMS does not list the file is refused', async () => {
    mode = { sums: `${'a'.repeat(64)}  something-else.deb\n` }
    await assert.rejects(() => srv.call('update.download'), /does not list/)
  })
  it('a redirect away from GitHub-style release addresses is refused', async () => {
    mode = { redirect: `http://localhost:${relPort}/evil` } // a different host name than the release address
    await assert.rejects(() => srv.call('update.download'), /not a GitHub release address/)
  })
  it('an oversized file is not downloaded', async () => {
    mode = { big: true, sums: `${'b'.repeat(64)}  ${NAME}\n` }
    await assert.rejects(() => srv.call('update.download'), /larger than expected/)
  })
  it('only a plain x.y.z version is used to build the address', async () => {
    mode = {}; version = '99.0.0/../../evil'
    await assert.rejects(() => srv.call('update.download'), /Unexpected answer/)
    version = '99.0.0-beta.1'
    await assert.rejects(() => srv.call('update.download'), /Unexpected answer/)
  })
  it('refuses when there is nothing newer', async () => {
    version = '0.0.1'
    await assert.rejects(() => srv.call('update.download'), /already have the latest/)
    version = '99.0.0'
  })
  it('only deb and install.sh installs download; npm and source installs are told how to update', async () => {
    await start('npm'); await assert.rejects(() => srv.call('update.download'), /npm install -g dockdesk@latest/)
    await start('source'); await assert.rejects(() => srv.call('update.download'), /git pull/)
  })
  it('the install.sh flavour fetches the .tar.gz', async () => {
    await start('script'); mode = {}
    await assert.rejects(() => srv.call('update.download'), /(does not match|not published)/) // the stand-in serves no tarball, and its SHA256SUMS hash is a dummy
  })

  it('the Settings page offers Download and verify, shows each check, the saved file and the install command', { skip: uiSkipReason() || false }, async () => {
    await start('deb'); mode = {}
    const page = await openPage(srv.url)
    try {
      await page.waitFor(`!!document.querySelector('#nav [data-p=settings]')`)
      await page.click('#nav [data-p=settings]')
      await page.waitFor(`!!document.querySelector('[data-call*=checkupdate]')`)
      await page.click('[data-call*=checkupdate]')
      await page.waitFor(`!!document.querySelector('[data-call*=downloadupdate]')`)
      await page.click('[data-call*=downloadupdate]')
      await page.waitFor(`/Checksum matches/.test(document.body.textContent)`)
      const text = await page.text('#page')
      assert.match(text, /Build attestation/)
      assert.match(text, new RegExp(`Saved to .*${NAME}`))
      assert.match(text, /sudo apt install .*dockdesk_99\.0\.0_all\.deb/)
      assert.match(text, /Nothing was installed/)
      assert.deepEqual(page.exceptions, [])
      // a bad download shows the refusal and no install command
      mode = { tamper: true }; await srv.call('update.check')
      await page.click('[data-call*=downloadupdate]')
      await waitFor(async () => /does not match its published checksum/.test(await page.text('#page')))
      assert.doesNotMatch(await page.text('#page'), /sudo apt install \//)
    } finally { await page.close() }
  })
})
