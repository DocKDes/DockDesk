// Opt-in: registry sign-in, tag, push and sign-out against a real password-protected local registry.
// Run with DD_TEST_REGISTRY=1 (needs `htpasswd`; pulls the ~25 MB registry:2 image if you don't have it, and removes it afterwards).
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import net from 'node:net'
import { startServer, janitor, docker, dockerTry, dockerAvailable, waitFor, PREFIX } from './helpers.mjs'

const skip = process.env.DD_TEST_REGISTRY !== '1' ? 'set DD_TEST_REGISTRY=1 to run' : !dockerAvailable() ? 'Docker is not reachable' : spawnSync('which', ['htpasswd'], { stdio: 'ignore' }).status !== 0 ? 'htpasswd (apache2-utils) is not installed' : false

describe('registry credentials against a real local registry', { skip }, () => {
  let J, srv, work, port, regName, pulledRegistry = false, IMG
  const USER = 'labuser', PASS = 'S3cret-pass!'
  const free = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })

  before(async () => {
    J = janitor(); IMG = J.image(); work = J.tmp('reg')
    if (!dockerTry('images', '-q', 'registry:2')) { docker('pull', 'registry:2'); pulledRegistry = true }
    mkdirSync(join(work, 'auth')); mkdirSync(join(work, 'cfg'))
    writeFileSync(join(work, 'auth/htpasswd'), spawnSync('htpasswd', ['-Bbn', USER, PASS], { encoding: 'utf8' }).stdout)
    port = await free(); regName = `${PREFIX}-reg`
    docker('run', '-d', '--name', regName, '-p', `127.0.0.1:${port}:5000`, '-v', `${join(work, 'auth')}:/auth:ro`, '-e', 'REGISTRY_AUTH=htpasswd', '-e', 'REGISTRY_AUTH_HTPASSWD_REALM=ddtest', '-e', 'REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd', 'registry:2')
    await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/v2/`)).status === 401, { what: 'the registry' })
    // a scratch DOCKER_CONFIG so your real ~/.docker/config.json is never touched
    srv = await startServer({ env: { DOCKER_CONFIG: join(work, 'cfg') } })
  })
  after(() => { srv?.stop(); J.cleanup(); if (pulledRegistry) dockerTry('rmi', 'registry:2') })

  const reg = () => `localhost:${port}`
  it('starts signed out', async () => assert.deepEqual((await srv.call('registry.status')).registries, []))
  it('rejects a wrong password with Docker\'s own message', async () => {
    await assert.rejects(srv.call('registry.login', reg(), USER, 'wrong'), /401|unauthorized|incorrect/i)
  })
  it('signs in; the secret never appears in any response and is stored by Docker with mode 600', async () => {
    assert.equal(await srv.call('registry.login', reg(), USER, PASS), 'ok')
    const status = await srv.call('registry.status'); assert.deepEqual(status.registries, [reg()]); assert.ok(!JSON.stringify(status).includes(PASS))
    assert.equal(statSync(join(work, 'cfg/config.json')).mode & 0o777, 0o600)
    assert.ok(!readFileSync(join(work, 'cfg/config.json'), 'utf8').includes(PASS), 'the plain password is never written')
  })
  it('tags and pushes an image, which then shows up in the registry catalog', async () => {
    const ctx = join(work, 'ctx'); mkdirSync(ctx); writeFileSync(join(ctx, 'a'), 'a'); writeFileSync(join(ctx, 'Dockerfile'), 'FROM scratch\nCOPY a /a\n')
    docker('build', '-q', '-t', `${PREFIX}/pushme:1`, ctx)
    await srv.call('image.tag', `${PREFIX}/pushme:1`, `${reg()}/${PREFIX}/pushme`, '1')
    const r = await srv.sse('push', { ref: `${reg()}/${PREFIX}/pushme:1` }, { ms: 60000 }); assert.equal(r.final.k, 'end', JSON.stringify(r.final))
    const cat = await (await fetch(`http://127.0.0.1:${port}/v2/_catalog`, { headers: { Authorization: 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64') } })).json()
    assert.ok(cat.repositories.includes(`${PREFIX}/pushme`))
  })
  it('refuses to push after signing out', async () => {
    await srv.call('registry.logout', reg()); assert.deepEqual((await srv.call('registry.status')).registries, [])
    const r = await srv.sse('push', { ref: `${reg()}/${PREFIX}/pushme:1` }, { ms: 60000 }); assert.equal(r.final.k, 'error'); assert.match(r.data.join(''), /no basic auth|unauthorized|denied/i)
  })
})
