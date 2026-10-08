// API tests against a real Docker engine. Everything created is named ddtest-<run id>… and removed afterwards.
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import http from 'node:http'
import { spawnSync, execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, createHash } from 'node:crypto'
import { startServer, janitor, docker, dockerTry, dockerAvailable, composeAvailable, waitFor, sleep, PREFIX } from './helpers.mjs'

const NETWORK = process.env.DD_TEST_NETWORK === '1' // a few tests need the internet; opt in with DD_TEST_NETWORK=1
const md5 = (b) => createHash('md5').update(b).digest('hex')

describe('DockDesk API against real Docker', { skip: dockerAvailable() ? false : 'Docker is not reachable' }, () => {
  let J, srv, IMG, work, main, mainId, tinyTag
  const hdr = () => ({ 'X-Token': srv.token })

  before(async () => {
    J = janitor(); IMG = J.image(); work = J.tmp('api')
    srv = await startServer({ env: { XDG_DATA_HOME: join(work, 'xdg') } })
    // a long-running container with files to browse and coloured, mixed stdout/stderr logs
    main = `${PREFIX}-main`
    const script = 'mkdir -p "/tmp/demo/sub folder"; printf "line one\\nline two\\n" > /tmp/demo/notes.txt; printf "spaced\\n" > "/tmp/demo/my file.txt"; head -c 2000 /dev/urandom > /tmp/demo/blob.bin; ln -s /tmp/demo/notes.txt /tmp/demo/link; : > /tmp/demo/empty.txt; seq 1 100000 > /tmp/demo/big.txt; i=0; while true; do i=$((i+1)); printf "\\033[31mERROR\\033[0m failed line $i\\n"; echo "warn on stderr $i" >&2; sleep 0.2; done'
    docker('run', '-d', '--name', main, '--stop-timeout', '1', '--entrypoint', 'sh', IMG, '-c', script)
    mainId = docker('inspect', main, '--format', '{{.Id}}')
    // a tiny image built from scratch (no pull needed)
    const ctx = join(work, 'tiny'); mkdirSync(ctx)
    writeFileSync(join(ctx, 'hello.txt'), 'hello from a tiny image\n'); writeFileSync(join(ctx, 'Dockerfile'), 'FROM scratch\nCOPY hello.txt /hello.txt\n')
    tinyTag = `${PREFIX}/tiny:1`
    docker('build', '-q', '-t', tinyTag, ctx)
    await waitFor(() => dockerTry('exec', main, 'test', '-f', '/tmp/demo/big.txt') !== undefined && spawnSync('docker', ['exec', main, 'test', '-s', '/tmp/demo/big.txt']).status === 0, { what: 'fixture files' })
  })
  after(() => { srv?.stop(); J.cleanup() })

  describe('engine', () => {
    it('answers ping, info and df with the expected shape', async () => {
      assert.equal(await srv.call('ping'), true)
      const info = await srv.call('info'); assert.ok(info.ServerVersion && info.NCPU > 0 && info.MemTotal > 0)
      const df = await srv.call('df'); assert.equal(typeof df.LayersSize, 'number'); assert.ok(Array.isArray(df.Images))
    })
    it('diagnoses access and exposes the polkit rule text', async () => {
      const d = await srv.call('engine.diag'); assert.equal(d.exists, true); assert.equal(d.access, true); assert.match(d.socket, /\.sock$/)
      if (composeAvailable()) assert.match(d.compose, /^v?\d+\.\d+/, 'compose version is reported when the plugin exists')
      const rule = await srv.call('engine.rule'); assert.match(rule, /polkit\.addRule/); assert.match(rule, /docker\.service/); assert.match(rule, /isInGroup\("docker"\)/)
    })
    it('lists the docker group read-only', async () => {
      const g = await srv.call('group.list'); assert.equal(g.group, 'docker'); assert.ok(Array.isArray(g.users))
    })
    it('keeps its event stream open immediately and filters noise', async () => {
      const u = `${srv.base}/stream/events?t=${srv.token}`, ctrl = new AbortController()
      const t0 = Date.now(), res = await fetch(u, { signal: ctrl.signal }), first = await res.body.getReader().read()
      ctrl.abort()
      assert.ok(Date.now() - t0 < 2000, 'headers must be flushed before the first event')
      assert.match(Buffer.from(first.value).toString(), /connected/)
    })
    it('streams a start event for a new container, without exec/mount noise', async () => {
      const name = `${PREFIX}-ev`
      setTimeout(() => dockerTry('run', '-d', '--name', name, '--stop-timeout', '1', '--entrypoint', 'sleep', IMG, '30'), 600)
      const r = await srv.sse('events', {}, { ms: 15000, until: (d) => d.some((e) => e.name === name && e.action === 'start') })
      assert.ok(r.data.some((e) => e.name === name && e.action === 'start'))
      assert.ok(!r.data.some((e) => /^(exec_|mount|connect)/.test(e.action)))
    })
    it('replays recent events on request, so a reconnect or a late connection misses nothing', async () => {
      const r = await srv.sse('events', { since: String(Math.floor(Date.now() / 1000) - 120) }, { ms: 8000, until: (d) => d.some((e) => e.name === main && e.action === 'start') })
      assert.ok(r.data.some((e) => e.name === main && e.action === 'start'), 'an event from before the stream opened must be replayed')
      const none = await srv.sse('events', { since: 'garbage; rm' }, { ms: 800 })
      assert.equal(none.final, null, 'a malformed since is ignored, not an error')
    })
    it('returns recent history for the Activity page', async () => {
      const h = await srv.call('events.history', Math.floor(Date.now() / 1000) - 600)
      assert.ok(h.some((e) => e.name === main && e.action === 'start'), 'fixture start should be in history')
      assert.ok(h.every((e) => !/^(exec_|mount|unmount|connect|disconnect|archive-path|extract-to-dir|copy)/.test(e.action)))
    })
  })

  describe('containers', () => {
    it('lists containers, with start times and live stats', async () => {
      const list = await srv.call('containers.list'); const c = list.find((x) => x.Id === mainId)
      assert.ok(c && c.State === 'running' && typeof c.Labels === 'object')
      const t = (await srv.call('containers.table')).find((x) => x.Id === mainId); assert.match(t.StartedAt, /^\d{4}-/)
      const stats = await srv.call('stats.all'); assert.ok(Number.isFinite(stats[mainId].cpu) && stats[mainId].memUsed > 0)
      assert.ok('blkRead' in stats[mainId] && 'netRx' in stats[mainId])
    })
    it('runs, stops, starts, pauses and removes a container', async () => {
      // a container that stays up whatever the image's default command is
      const r = { id: docker('run', '-d', '--name', `${PREFIX}-act`, '--stop-timeout', '1', '--entrypoint', 'sleep', IMG, '300') }
      const state = () => dockerTry('inspect', r.id, '--format', '{{.State.Status}}')
      assert.equal(state(), 'running')
      await srv.call('container.action', r.id, 'pause'); assert.equal(state(), 'paused')
      await srv.call('container.action', r.id, 'unpause'); assert.equal(state(), 'running')
      await srv.call('container.action', r.id, 'stop'); assert.equal(state(), 'exited')
      await srv.call('container.action', r.id, 'start'); assert.equal(state(), 'running')
      await assert.rejects(srv.call('container.action', r.id, 'explode'), /bad action/)
      await srv.call('container.remove', r.id, true); assert.equal(state(), '')
    })
    it('applies every advanced run option exactly as asked', async () => {
      const r = await srv.call('container.run', { image: IMG, name: `${PREFIX}-opts`, interactive: true, restart: 'unless-stopped', memoryMb: 64, cpus: 0.5, caps: ['net_admin', 'NET_RAW'], lab: 'test-lab',
        ports: [{ host: '', container: '5432' }, { host: '', container: '53', proto: 'udp' }], env: [{ key: 'FOO', value: 'bar baz' }], volumes: [{ host: `${PREFIX}-vol`, container: '/data' }] })
      const i = JSON.parse(docker('inspect', r.id))[0]
      assert.equal(i.HostConfig.PortBindings['5432/tcp'][0].HostIp, '127.0.0.1', 'ports bind to localhost by default')
      assert.ok(i.HostConfig.PortBindings['53/udp'])
      assert.deepEqual(i.HostConfig.CapAdd.sort(), ['NET_ADMIN', 'NET_RAW'])
      assert.equal(i.HostConfig.RestartPolicy.Name, 'unless-stopped')
      assert.equal(i.HostConfig.Memory, 64 * 1048576); assert.equal(i.HostConfig.NanoCpus, 5e8)
      assert.equal(i.Config.Tty, true); assert.equal(i.Config.OpenStdin, true)
      assert.equal(i.Config.Labels['dockdesk.lab'], 'test-lab')
      assert.ok(i.Config.Env.includes('FOO=bar baz'))
      assert.ok(i.Mounts.some((m) => m.Destination === '/data'))
      docker('rm', '-fv', r.id); dockerTry('volume', 'rm', `${PREFIX}-vol`)
    })
    it('binds to all interfaces only when asked, and ignores unknown labels', async () => {
      const r = await srv.call('container.run', { image: IMG, name: `${PREFIX}-all`, interactive: true, bindIp: '0.0.0.0', lab: '../bad;label', ports: [{ host: '', container: '8080' }] })
      const i = JSON.parse(docker('inspect', r.id))[0]
      assert.equal(i.HostConfig.PortBindings['8080/tcp'][0].HostIp, '0.0.0.0')
      assert.ok(!('dockdesk.lab' in i.Config.Labels))
      docker('rm', '-f', r.id)
    })
    it('removes the half-created container when it cannot start (busy port)', async () => {
      const volsBefore = new Set(dockerTry('volume', 'ls', '-q').split('\n'))
      const srvSock = net.createServer().listen(0, '127.0.0.1'); await new Promise((r) => srvSock.once('listening', r))
      const port = String(srvSock.address().port)
      try {
        await assert.rejects(srv.call('container.run', { image: IMG, name: `${PREFIX}-busy`, interactive: true, ports: [{ host: port, container: '80' }] }), /port|address|bind/i)
        assert.equal(dockerTry('ps', '-aq', '--filter', `name=${PREFIX}-busy`), '', 'failed container must not be left behind')
        const leaked = dockerTry('volume', 'ls', '-q').split('\n').filter((v) => v && !volsBefore.has(v))
        assert.deepEqual(leaked, [], 'a failed start must not leak the image\'s anonymous volumes')
      } finally { srvSock.close() }
    })
    it('reports a clear error for an unknown image', async () => {
      await assert.rejects(srv.call('container.run', { image: `${PREFIX}/nope:0` }), /No such image|not found|pull access/i)
    })
    it('renames and live-updates restart policy and limits in one call', async () => {
      const r = { id: docker('run', '-d', '--name', `${PREFIX}-upd`, '--stop-timeout', '1', '--memory', '64m', '--entrypoint', 'sleep', IMG, '300') }
      const show = (n) => dockerTry('inspect', n, '--format', '{{.Name}}|{{.HostConfig.RestartPolicy.Name}}|{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}')
      await srv.call('container.update', r.id, { name: `${PREFIX}-upd2`, restart: 'always', memoryMb: 128, cpus: 1 })
      assert.equal(show(r.id), `/${PREFIX}-upd2|always|${128 * 1048576}|1000000000`)
      await srv.call('container.update', r.id, { name: `${PREFIX}-upd2`, restart: 'no', memoryMb: 0, cpus: 0 }) // 0 = leave the limits as they are
      assert.equal(show(r.id), `/${PREFIX}-upd2|no|${128 * 1048576}|1000000000`)
      await assert.rejects(srv.call('container.update', r.id, { name: `${PREFIX}-upd2`, restart: 'no', memoryMb: 2 }), /at least 6 MB/)
      await assert.rejects(srv.call('container.update', r.id, { name: 'bad name!', restart: 'no' }), /Invalid container name/)
      docker('rm', '-f', r.id)
    })
    it('removes memory and CPU limits by recreating the container, keeping its settings and data', async () => {
      const net = `${PREFIX}-limnet`; docker('network', 'create', net)
      const name = `${PREFIX}-lim`
      const first = docker('run', '-d', '--name', name, '--stop-timeout', '1', '--memory', '64m', '--cpus', '1', '-e', 'KEEP=yes', '--network', net, '--network-alias', 'limalias', '-v', '/data', '--restart', 'unless-stopped', '--entrypoint', 'sh', IMG, '-c', 'echo saved > /data/f; sleep 300')
      try {
        await new Promise((r) => setTimeout(r, 800))
        const show = () => JSON.parse(execFileSync('docker', ['inspect', name], { encoding: 'utf8' }))[0]
        await srv.call('container.removeLimits', first, { memory: true })
        let i = show(); assert.notEqual(i.Id, first); assert.equal(i.HostConfig.Memory, 0); assert.equal(i.HostConfig.NanoCpus, 1e9, 'only the memory limit was removed')
        assert.equal(i.State.Running, true); assert.ok(i.Config.Env.includes('KEEP=yes')); assert.equal(i.HostConfig.RestartPolicy.Name, 'unless-stopped')
        assert.ok(i.NetworkSettings.Networks[net]?.Aliases.includes('limalias'), 'network and alias are kept')
        assert.equal(execFileSync('docker', ['exec', name, 'cat', '/data/f'], { encoding: 'utf8' }).trim(), 'saved', 'anonymous volume data survives')
        assert.equal(dockerTry('ps', '-aq', '--filter', `id=${first}`), '', 'the old container is gone')
        await srv.call('container.removeLimits', i.Id, { cpus: true })
        i = show(); assert.equal(i.HostConfig.NanoCpus, 0); assert.equal(i.State.Running, true)
        await assert.rejects(srv.call('container.removeLimits', i.Id, {}), /Choose which limit/)
        assert.equal(dockerTry('ps', '-a', '--filter', `name=${name}-dockdesk-old`, '-q'), '', 'no leftover copies')
      } finally { dockerTry('rm', '-f', '-v', name); dockerTry('network', 'rm', net) }
    })
    it('refuses to recreate compose-managed containers', async () => {
      const c = docker('run', '-d', '--name', `${PREFIX}-cmp`, '--memory', '64m', '--label', 'com.docker.compose.project=x', '--stop-timeout', '1', '--entrypoint', 'sleep', IMG, '300')
      try { await assert.rejects(srv.call('container.removeLimits', c, { memory: true }), /Compose project/) } finally { dockerTry('rm', '-f', c) }
    })
    it('will not restart itself in headless mode', async () => { await assert.rejects(srv.call('app.relaunch'), /Headless/) })
  })

  describe('volumes and networks', () => {
    it('creates, lists and removes a volume', async () => {
      const name = `${PREFIX}-vol1`
      await srv.call('volume.create', name)
      const v = (await srv.call('volumes.list')).find((x) => x.Name === name); assert.ok(v && v.UsageData)
      assert.equal((await srv.call('volume.inspect', name)).Name, name)
      await srv.call('volume.remove', name)
      assert.ok(!(await srv.call('volumes.list')).some((x) => x.Name === name))
    })
    it('creates, lists, inspects and removes a network', async () => {
      const name = `${PREFIX}-net1`
      await srv.call('network.create', name)
      const n = (await srv.call('networks.list')).find((x) => x.Name === name); assert.ok(n && 'Containers' in n)
      assert.equal((await srv.call('network.inspect', n.Id)).Name, name)
      await srv.call('network.remove', n.Id)
      assert.ok(!(await srv.call('networks.list')).some((x) => x.Name === name))
    })
  })

  describe('images', () => {
    it('lists, inspects and shows the layer history of an image', async () => {
      const i = (await srv.call('images.list')).find((x) => (x.RepoTags || []).includes(tinyTag)); assert.ok(i && 'Containers' in i)
      assert.equal((await srv.call('image.inspect', tinyTag)).Os, 'linux')
      const hist = await srv.call('image.history', tinyTag); assert.ok(hist.some((l) => /COPY hello\.txt/.test(l.CreatedBy)))
      await assert.rejects(srv.call('image.history', `${PREFIX}/missing:9`), /No such image/)
    })
    it('adds a tag and removes only that tag', async () => {
      const t2 = `${PREFIX}/tiny-alias:v2`
      await srv.call('image.tag', tinyTag, `${PREFIX}/tiny-alias`, 'v2')
      assert.ok(dockerTry('images', '-q', t2)); await srv.call('image.remove', t2, false)
      assert.equal(dockerTry('images', '-q', t2), ''); assert.ok(dockerTry('images', '-q', tinyTag), 'original tag must survive')
    })
    it('builds an image from a folder and streams the build output', async () => {
      const ctx = join(work, 'build1'); mkdirSync(ctx); writeFileSync(join(ctx, 'f.txt'), 'x'); writeFileSync(join(ctx, 'Dockerfile'), 'FROM scratch\nCOPY f.txt /f.txt\n')
      const tag = `${PREFIX}/built:1`
      const r = await srv.sse('build', { dir: ctx, tag })
      assert.equal(r.final.k, 'end', JSON.stringify(r.final)); assert.match(r.data.join(''), /naming to .*built:1/)
      assert.ok(dockerTry('images', '-q', tag))
    })
    it('refuses bad build requests', async () => {
      const ctx = join(work, 'build2'); mkdirSync(ctx)
      const err = async (p) => (await srv.sse('build', p)).final
      assert.match((await err({ dir: '/nonexistent' })).d, /ENOENT|not found/)
      assert.match((await err({ dir: ctx })).d, /No Dockerfile/)
      writeFileSync(join(ctx, 'Dockerfile'), 'FROM scratch\n')
      assert.match((await err({ dir: ctx, tag: 'BAD TAG' })).d, /Tag must be lowercase/)
      assert.match((await err({ dir: ctx, file: '../etc/passwd' })).d, /No \.\.\/etc\/passwd/)
    })
    it('exports an image to a private .tar and imports it back (round trip)', async () => {
      const ctx = join(work, 'rt'); mkdirSync(ctx); writeFileSync(join(ctx, 'r.txt'), 'round trip'); writeFileSync(join(ctx, 'Dockerfile'), 'FROM scratch\nCOPY r.txt /r.txt\n')
      const tag = `${PREFIX}/rt:1`; docker('build', '-q', '-t', tag, ctx)
      const out = join(work, 'out'); mkdirSync(out)
      const saved = await srv.sse('save', { ref: tag, dir: out, name: 'rt.tar' })
      assert.equal(saved.final.k, 'end'); assert.ok(saved.final.d.bytes > 0)
      assert.equal(statSync(join(out, 'rt.tar')).mode & 0o777, 0o600, 'exports may contain secrets: owner-only')
      assert.match((await srv.sse('save', { ref: tag, dir: out, name: 'rt.tar' })).final.d, /already exists/)
      assert.equal((await srv.sse('save', { ref: tag, dir: out, name: 'rt.tar', overwrite: '1' })).final.k, 'end')
      docker('rmi', '-f', tag); assert.equal(dockerTry('images', '-q', tag), '')
      const loaded = await srv.sse('load', { path: join(out, 'rt.tar') })
      assert.equal(loaded.final.k, 'end'); assert.ok(loaded.data.some((d) => /Loaded image: .*rt:1/.test(d.line || '')))
      assert.ok(dockerTry('images', '-q', tag), 'image should be back after import')
    })
    it('refuses unsafe export and import requests, leaving no partial files', async () => {
      const out = join(work, 'out2'); mkdirSync(out)
      for (const name of ['../evil.tar', 'x.txt', '.hidden', 'a b.tar']) assert.match((await srv.sse('save', { ref: tinyTag, dir: out, name })).final.d, /File name must end in \.tar/)
      assert.match((await srv.sse('save', { ref: 'bad ref;rm', dir: out, name: 'a.tar' })).final.d, /Invalid image name/)
      assert.match((await srv.sse('save', { ref: `${PREFIX}/nosuch:9`, dir: out, name: 'b.tar' })).final.d, /does not exist|No such image/)
      assert.deepEqual(execFileSync('ls', [out], { encoding: 'utf8' }).trim(), '', 'failed exports must not leave files behind')
      writeFileSync(join(work, 'notatar.txt'), 'plain text')
      assert.match((await srv.sse('load', { path: join(work, 'notatar.txt') })).final.d, /unexpected EOF|invalid/i)
      assert.match((await srv.sse('load', { path: work })).final.d, /archive/)
    })
    it('searches Docker Hub through the daemon', { skip: NETWORK ? false : 'set DD_TEST_NETWORK=1 to run tests that need the internet' }, async () => {
      const r = await srv.call('hub.search', 'nginx'); assert.ok(r.some((x) => x.name === 'nginx' && x.is_official))
    })
    it('offers a folder picker that finds Dockerfiles and image archives', async () => {
      const d = join(work, 'pick'); mkdirSync(join(d, 'sub'), { recursive: true }); writeFileSync(join(d, 'Dockerfile'), 'FROM scratch\n'); writeFileSync(join(d, 'a.tar'), ''); writeFileSync(join(d, 'b.tgz'), '')
      const r = await srv.call('fs.dirs', d); assert.deepEqual(r.dirs, ['sub']); assert.deepEqual(r.files, ['Dockerfile']); assert.deepEqual(r.tars.sort(), ['a.tar', 'b.tgz']); assert.equal(r.parent, work)
    })
  })

  describe('container files', () => {
    it('lists a folder with types, link targets and awkward names', async () => {
      const r = await srv.call('container.ls', main, '/tmp/demo'); const by = Object.fromEntries(r.entries.map((e) => [e.name, e]))
      assert.equal(r.entries[0].name, 'sub folder', 'folders sort first'); assert.equal(by['sub folder'].type, 'd')
      assert.equal(by['link'].type, 'l'); assert.equal(by['link'].target, '/tmp/demo/notes.txt')
      assert.equal(by['notes.txt'].size, 18); assert.ok('my file.txt' in by); assert.equal(by['empty.txt'].size, 0)
      assert.deepEqual((await srv.call('container.ls', main, '/tmp/demo/sub folder')).entries, [])
    })
    it('explains why a folder cannot be listed', async () => {
      await assert.rejects(srv.call('container.ls', main, '/nope'), /No such file/)
      const created = `${PREFIX}-tinyc`; docker('create', '--name', created, tinyTag, '/hello.txt')
      await assert.rejects(srv.call('container.ls', created, '/nope'), /Could not find|No such/i)
    })
    it('lists from the archive when the container is stopped or has no ls', async () => {
      const created = `${PREFIX}-tinyc2`; docker('create', '--name', created, tinyTag, '/hello.txt') // stopped, and the image has no ls at all
      const r = await srv.call('container.ls', created, '/'); assert.equal(r.source, 'archive'); assert.ok(r.entries.some((e) => e.name === 'hello.txt' && e.type === '-' && e.size > 0), JSON.stringify(r.entries))
      const stopped = `${PREFIX}-stoplist`
      docker('run', '--name', stopped, IMG, 'sh', '-c', 'mkdir -p "/d/sub dir" && echo hi > /d/a.txt && ln -s a.txt /d/l && touch "/d/my file" && chmod 750 /d/a.txt')
      const d = await srv.call('container.ls', stopped, '/d'); const by = Object.fromEntries(d.entries.map((e) => [e.name, e]))
      assert.equal(d.source, 'archive'); assert.equal(d.partial, false)
      assert.deepEqual(d.entries.map((e) => e.name), ['sub dir', 'a.txt', 'l', 'my file'], 'folders first, then by name; nothing from deeper levels')
      assert.equal(by['sub dir'].type, 'd'); assert.equal(by['l'].type, 'l'); assert.equal(by['l'].target, 'a.txt'); assert.equal(by['a.txt'].size, 3); assert.equal(by['a.txt'].perms, 'rwxr-x---')
      assert.deepEqual((await srv.call('container.ls', stopped, '/d/sub dir')).entries, [])
      const root = await srv.call('container.ls', stopped, '/'); assert.ok(['d', 'etc', 'bin'].every((n) => root.entries.some((e) => e.name === n)), 'the root lists its top-level folders')
      await assert.rejects(srv.call('container.ls', stopped, '/missing'), /Could not find|No such/i)
    })
    it('previews text, flags binary files and folders, and truncates big files', async () => {
      assert.deepEqual(await srv.call('container.cat', main, '/tmp/demo/notes.txt'), { kind: 'file', size: 18, truncated: false, binary: false, text: 'line one\nline two\n' })
      assert.equal((await srv.call('container.cat', main, '/tmp/demo/blob.bin')).binary, true)
      assert.equal((await srv.call('container.cat', main, '/tmp/demo')).kind, 'dir')
      assert.equal((await srv.call('container.cat', main, '/tmp/demo/empty.txt')).size, 0)
      const big = await srv.call('container.cat', main, '/tmp/demo/big.txt'); assert.equal(big.truncated, true); assert.equal(big.text.length, 262144)
      await assert.rejects(srv.call('container.cat', main, '/missing'), /Could not find/)
    })
    it('downloads files byte for byte, folders as tar, and refuses folders as files', async () => {
      const get = async (kind, p) => { const r = await fetch(`${srv.base}/download/${kind}?id=${main}&path=${encodeURIComponent(p)}&t=${srv.token}`); return { r, buf: Buffer.from(await r.arrayBuffer()) } }
      const blob = await get('file', '/tmp/demo/blob.bin'); assert.equal(blob.r.status, 200)
      assert.equal(md5(blob.buf), md5(execFileSync('docker', ['exec', main, 'cat', '/tmp/demo/blob.bin'])), 'binary file must be identical')
      assert.match(blob.r.headers.get('content-disposition'), /attachment; filename="blob\.bin"/)
      assert.equal(blob.r.headers.get('content-length'), '2000')
      assert.equal((await get('file', '/tmp/demo/empty.txt')).buf.length, 0)
      assert.equal(md5((await get('file', '/tmp/demo/big.txt')).buf), md5(execFileSync('docker', ['exec', main, 'cat', '/tmp/demo/big.txt'], { maxBuffer: 1e8 })))
      assert.equal((await get('file', '/tmp/demo')).r.status, 500)
      const tar = await get('tar', '/tmp/demo'); writeFileSync(join(work, 'demo.tar'), tar.buf)
      assert.match(execFileSync('tar', ['tf', join(work, 'demo.tar')], { encoding: 'utf8' }), /demo\/notes\.txt/)
    })
    it('uploads files (even with spaces in the name) and verifies integrity', async () => {
      const data = randomBytes(300000)
      const up = (name, body, path = '/tmp/demo') => fetch(`${srv.base}/upload?id=${main}&path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`, { method: 'POST', headers: hdr(), body })
      assert.equal((await up('up file.bin', data)).status, 200)
      assert.equal(execFileSync('docker', ['exec', main, 'sh', '-c', 'md5sum < "/tmp/demo/up file.bin"'], { encoding: 'utf8' }).split(' ')[0], md5(data))
      assert.equal((await up('empty-up.txt', '')).status, 200)
      assert.equal(execFileSync('docker', ['exec', main, 'sh', '-c', 'wc -c < /tmp/demo/empty-up.txt'], { encoding: 'utf8' }).trim(), '0')
      assert.equal((await up('x', 'x', '/no/such/dir')).status, 500)
      assert.equal((await up('../evil', 'x')).status, 500); assert.equal((await up('a/b', 'x')).status, 500)
    })
    it('uploads to and downloads from a stopped container', async () => {
      const name = `${PREFIX}-stopped`; docker('create', '--name', name, '--entrypoint', 'sleep', IMG, '60')
      const r = await fetch(`${srv.base}/upload?id=${name}&path=/tmp&name=hi.txt&`, { method: 'POST', headers: hdr(), body: 'stopped ok' }); assert.equal(r.status, 200)
      const back = await (await fetch(`${srv.base}/download/file?id=${name}&path=/tmp/hi.txt&t=${srv.token}`)).text(); assert.equal(back, 'stopped ok')
    })
  })

  describe('edit files in a container, port check, image updates', () => {
    const stat = (path) => dockerTry('exec', main, 'stat', '-c', '%a %u:%g', path)
    it('saves text over a file and keeps its permissions and owner', async () => {
      docker('exec', main, 'sh', '-c', 'printf "old\\n" > /tmp/demo/edit.txt; chmod 640 /tmp/demo/edit.txt; chown 1234:5678 /tmp/demo/edit.txt')
      assert.equal(await srv.call('container.write', main, '/tmp/demo/edit.txt', 'new text\nsecond line é\n'), 'ok')
      assert.equal(docker('exec', main, 'cat', '/tmp/demo/edit.txt'), 'new text\nsecond line é')
      assert.equal(stat('/tmp/demo/edit.txt'), '640 1234:5678')
      assert.equal((await srv.call('container.cat', main, '/tmp/demo/edit.txt')).text, 'new text\nsecond line é\n')
    })
    it('refuses folders, relative paths and large content', async () => {
      await assert.rejects(srv.call('container.write', main, '/tmp/demo', 'x'), /not a regular file/)
      await assert.rejects(srv.call('container.write', main, 'relative.txt', 'x'), /absolute/)
      await assert.rejects(srv.call('container.write', main, '/tmp/demo/edit.txt', 'x'.repeat(256 * 1024 + 1)), /256 kB/)
      await assert.rejects(srv.call('container.write', main, '/tmp/demo/missing-file.txt', 'x'), /Could not find/)
    })
    it('reports host ports that are taken', async () => {
      const srv2 = net.createServer(); await new Promise((ok) => srv2.listen(0, '127.0.0.1', ok))
      const busy = srv2.address().port
      try {
        const r = await srv.call('ports.check', [busy, 'x', -1, 70000])
        assert.deepEqual(Object.keys(r), [String(busy)]); assert.equal(r[busy], 'another program')
      } finally { srv2.close() }
      const free = await new Promise((ok) => { const t = net.createServer(); t.listen(0, '127.0.0.1', () => { const n = t.address().port; t.close(() => ok(n)) }) })
      assert.deepEqual(await srv.call('ports.check', [free]), {})
    })
    it('reports docker published ports by container name', async () => {
      const name = `${PREFIX}-pc`
      docker('run', '-d', '--name', name, '--stop-timeout', '1', '-p', '127.0.0.1::8080', '--entrypoint', 'sleep', IMG, '30')
      const port = Number(docker('port', name, '8080/tcp').split(':').pop())
      assert.equal((await srv.call('ports.check', [port]))[port], name)
    })
    it('says "cannot tell" for local images and bad references, without any network access', async () => {
      assert.equal((await srv.call('image.update.check', tinyTag)).update, null)
      for (const bad of ['', '--help', '-x', 'a b', 'x;id', 'sha256:' + 'a'.repeat(64)]) assert.equal((await srv.call('image.update.check', bad)).update, null)
    })
  })

  describe('logs', () => {
    const dl = (q) => fetch(`${srv.base}/download/logs?id=${main}&${q}&t=${srv.token}`)
    it('downloads logs as a file: stdout and stderr, colour codes stripped', async () => {
      await waitFor(async () => (await (await dl('tail=all')).text()).split('\n').length > 6, { what: 'some logs' })
      const r = await dl('tail=all'), text = await r.text()
      assert.match(r.headers.get('content-disposition'), new RegExp(`filename="${PREFIX}-main\\.log"`))
      assert.match(text, /ERROR failed line 1/); assert.match(text, /warn on stderr 1/)
      assert.ok(!text.includes('\x1b'), 'ANSI colour codes must be stripped by default')
    })
    it('supports raw colours, tail and timestamps', async () => {
      assert.ok((await (await dl('tail=3&raw=1')).text()).includes('\x1b'))
      assert.equal((await (await dl('tail=5')).text()).trim().split('\n').length, 5)
      assert.match((await (await dl('tail=2&timestamps=1')).text()).split('\n')[0], /^\d{4}-\d\d-\d\dT[\d:.]+Z /)
    })
    it('streams live logs honouring tail and timestamps', async () => {
      const r = await srv.sse('logs', { id: mainId, tail: '2', ts: '1' }, { ms: 3000, until: (d) => d.join('').split('\n').length > 3 })
      assert.match(r.data.join(''), /\d{4}-\d\d-\d\dT[\d:.]+Z .*(ERROR|warn)/)
    })
    it('refuses bad ids', async () => {
      assert.equal((await dl('tail=1').then(() => fetch(`${srv.base}/download/logs?id=a%3Bb&t=${srv.token}`))).status, 500)
    })
  })

  describe('compose', { skip: composeAvailable() ? false : 'docker compose is not installed' }, () => {
    const proj = `${PREFIX}-cp`
    let dir, file
    const yaml = (extra = '') => `services:\n  web:\n    image: ${IMG}\n    entrypoint: ["sleep","600"]\n    stop_grace_period: 1s\n  worker:\n    image: ${IMG}\n    entrypoint: ["sleep","600"]\n    stop_grace_period: 1s\n${extra}`
    const running = () => dockerTry('ps', '--filter', `label=com.docker.compose.project=${proj}`, '--format', '{{.Names}}').split('\n').filter(Boolean).sort()
    it('validates files with docker compose and returns Docker\'s own errors', async () => {
      const ok = await srv.call('compose.validate', yaml()); assert.deepEqual(ok.services.sort(), ['web', 'worker'])
      await assert.rejects(srv.call('compose.validate', 'services:\n  web:\n    image: x\n    prots: ["1:2"]\n'), /additional properties 'prots' not allowed/)
      await assert.rejects(srv.call('compose.validate', 'services:\n  web:\n    image: x\n   bad: indent'), /yaml/i)
    })
    it('saves projects privately and only inside its own folder', async () => {
      const r = await srv.call('compose.save', proj, yaml()); dir = r.dir; file = r.file
      assert.equal(statSync(file).mode & 0o777, 0o600); assert.equal(statSync(dir).mode & 0o777, 0o700); assert.ok(dir.startsWith(join(work, 'xdg')))
    })
    it('opens and writes only files it is allowed to, keeping a backup', async () => {
      assert.match((await srv.call('compose.read', file)).text, /services:/)
      for (const p of ['/etc/passwd', '/etc/hosts', join(work, 'xdg/dockdesk/projects/../../../../../../etc/passwd')]) await assert.rejects(srv.call('compose.read', p), /can only open compose files/)
      await srv.call('compose.write', file, yaml('# edited\n')); assert.ok(existsSync(file + '.dockdesk.bak'))
      await assert.rejects(srv.call('compose.write', join(work, 'evil.yaml'), 'services: {}'), /can only edit compose files/)
      assert.ok(!existsSync(join(work, 'evil.yaml')))
    })
    it('refuses to run files or actions it should not', async () => {
      assert.match((await srv.sse('compose', { project: 'BAD', file, verb: 'up' })).final.d, /Invalid project name/)
      assert.match((await srv.sse('compose', { project: proj, file: '/etc/hosts', verb: 'up' })).final.d, /not one DockDesk may use/)
      assert.match((await srv.sse('compose', { project: proj, file, verb: 'rm' })).final.d, /Unknown action/)
    })
    it('starts a project, picks up an edit, and tears it down (live output)', async () => {
      const up = await srv.sse('compose', { project: proj, file, verb: 'up' }, { ms: 120000 }); assert.equal(up.final.k, 'end', JSON.stringify(up.final))
      assert.deepEqual(running(), [`${proj}-web-1`, `${proj}-worker-1`])
      await srv.call('compose.write', file, yaml(`  cache:\n    image: ${IMG}\n    entrypoint: ["sleep","600"]\n    stop_grace_period: 1s\n`))
      assert.equal((await srv.sse('compose', { project: proj, file, verb: 'up' }, { ms: 120000 })).final.k, 'end')
      assert.equal(running().length, 3)
      assert.equal((await srv.sse('compose', { project: proj, file, verb: 'down' }, { ms: 120000 })).final.k, 'end')
      assert.deepEqual(running(), [])
    })
  })

  describe('compose extras: profiles, graph, .env, per-service actions', { skip: composeAvailable() ? false : 'docker compose is not installed' }, () => {
    const proj = `${PREFIX}-cx`
    const svc = (name, extra = '') => `  ${name}:\n    image: ${IMG}\n    entrypoint: ["sleep","600"]\n    stop_grace_period: 1s\n${extra}`
    const yaml = () => `services:\n${svc('db')}${svc('web', '    depends_on:\n      - db\n')}${svc('extra', '    profiles: ["tools"]\n    depends_on:\n      - web\n')}`
    let dir, file
    const names = () => dockerTry('ps', '--filter', `label=com.docker.compose.project=${proj}`, '--format', '{{.Label "com.docker.compose.service"}}').split('\n').filter(Boolean).sort()
    it('reads profiles and the dependency graph without starting anything', async () => {
      const r = await srv.call('compose.save', proj, yaml()); dir = r.dir; file = r.file
      assert.deepEqual(await srv.call('compose.profiles', file), ['tools'])
      const g = await srv.call('compose.graph', file), by = Object.fromEntries(g.map((x) => [x.name, x]))
      assert.deepEqual(by.web.depends, ['db']); assert.deepEqual(by.extra.depends, ['web']); assert.deepEqual(by.extra.profiles, ['tools']); assert.deepEqual(by.db.depends, [])
      await assert.rejects(srv.call('compose.graph', '/etc/hosts'), /not one DockDesk may use/)
      await assert.rejects(srv.call('compose.profiles', '/etc/hosts'), /not one DockDesk may use/)
    })
    it('edits the .env next to a compose file, privately, with a backup', async () => {
      assert.deepEqual(await srv.call('compose.env.read', file), { file: join(dir, '.env'), exists: false, text: '', writable: true })
      await srv.call('compose.env.write', file, 'A=1\n'); assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600)
      await srv.call('compose.env.write', file, 'A=2\n'); assert.equal(readFileSync(join(dir, '.env.dockdesk.bak'), 'utf8'), 'A=1\n')
      assert.equal((await srv.call('compose.env.read', file)).text, 'A=2\n')
      await assert.rejects(srv.call('compose.env.write', '/etc/hosts', 'A=1'), /not one DockDesk may use/)
      await assert.rejects(srv.call('compose.env.write', file, 'A\0B'), /not text/)
    })
    it('starts with a profile, restarts and scales one service, then removes everything', async () => {
      await srv.call('compose.action', proj, dir, file, 'up'); assert.deepEqual(names(), ['db', 'web'])
      await srv.call('compose.action', proj, dir, file, 'up', ['tools']); assert.deepEqual(names(), ['db', 'extra', 'web'])
      const before = dockerTry('ps', '-q', '--filter', `label=com.docker.compose.project=${proj}`, '--filter', 'label=com.docker.compose.service=web')
      await srv.call('compose.service', proj, dir, file, 'web', 'restart'); assert.equal(dockerTry('ps', '-q', '--filter', `label=com.docker.compose.project=${proj}`, '--filter', 'label=com.docker.compose.service=web'), before, 'same container, restarted')
      await srv.call('compose.service', proj, dir, file, 'web', 'scale', 2); assert.deepEqual(names(), ['db', 'extra', 'web', 'web'])
      await srv.call('compose.service', proj, dir, file, 'web', 'scale', 1); assert.deepEqual(names(), ['db', 'extra', 'web'])
      await srv.call('compose.action', proj, dir, file, 'down', ['tools']); assert.deepEqual(names(), [])
    })
    it('validates every argument', async () => {
      await assert.rejects(srv.call('compose.service', proj, dir, file, 'web', 'scale', 999), /0 to 50/)
      await assert.rejects(srv.call('compose.service', proj, dir, file, 'web', 'scale', 'x'), /0 to 50/)
      await assert.rejects(srv.call('compose.service', proj, dir, file, 'web', 'rm'), /bad action/)
      await assert.rejects(srv.call('compose.service', proj, dir, file, '--x', 'restart'), /Invalid service/)
      await assert.rejects(srv.call('compose.service', 'BAD', dir, file, 'web', 'restart'), /Invalid project/)
      await assert.rejects(srv.call('compose.service', proj, dir, '/etc/hosts', 'web', 'restart'), /not one DockDesk may use/)
      await assert.rejects(srv.call('compose.action', proj, dir, '/etc/hosts', 'up'), /not one DockDesk may use/)
      await assert.rejects(srv.call('compose.action', proj, dir, file, 'up', ['--evil']), /Invalid profile/)
    })
  })

  describe('app info, update check and system tray', () => {
    const VERSION = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version
    const fakeUpdateServer = (answer) => new Promise((ok) => {
      const s = http.createServer((req, res) => { const a = answer(); res.writeHead(a.status || 200, { 'Content-Type': 'application/json' }); res.end(typeof a.body === 'string' ? a.body : JSON.stringify(a.body)) })
      s.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${s.address().port}/latest`, close: () => s.close() }))
    })
    it('reports its version and how it was installed', async () => {
      const i = await srv.call('app.info'); assert.equal(i.version, VERSION); assert.equal(i.install, 'source')
    })
    it('asks the update server and compares versions', async () => {
      let body = { version: '99.1.0' }
      const fake = await fakeUpdateServer(() => ({ body }))
      const s = await startServer({ env: { DOCKDESK_UPDATE_URL: fake.url } })
      try {
        assert.deepEqual(await s.call('update.check'), { current: VERSION, latest: '99.1.0', newer: true, install: 'source' })
        body = { version: VERSION }; assert.equal((await s.call('update.check')).newer, false, 'same version is not an update')
        body = { version: '0.0.1' }; assert.equal((await s.call('update.check')).newer, false, 'an older version is not an update')
        body = { version: '1.0.0-beta.1' }; assert.equal((await s.call('update.check')).latest, '1.0.0-beta.1')
        body = { name: 'dockdesk' }; await assert.rejects(s.call('update.check'), /Unexpected answer/)
        body = '<html>not json'; await assert.rejects(s.call('update.check'), /Unexpected answer/)
      } finally { s.stop(); fake.close() }
    })
    it('explains update-server failures in plain words', async () => {
      const bad = await fakeUpdateServer(() => ({ status: 503, body: {} }))
      const s1 = await startServer({ env: { DOCKDESK_UPDATE_URL: bad.url } })
      try { await assert.rejects(s1.call('update.check'), /answered 503/) } finally { s1.stop(); bad.close() }
      const s2 = await startServer({ env: { DOCKDESK_UPDATE_URL: 'http://127.0.0.1:1/latest' } })
      try { await assert.rejects(s2.call('update.check'), /Could not reach the update server/) } finally { s2.stop() }
    })
    // a fake tray program: logs every status line it gets, and with FAKE_QUIT=1 answers the first one with "quit"
    const makeTray = (dir) => {
      const f = join(dir, 'fake-tray'), log = join(dir, 'tray.log')
      writeFileSync(f, `#!/usr/bin/env node\nconst fs=require('fs');fs.appendFileSync(${JSON.stringify(log)},'start '+process.argv.slice(2).join(' ')+'\\n')\nprocess.stdin.on('data',d=>{fs.appendFileSync(${JSON.stringify(log)},String(d));if(process.env.FAKE_QUIT==='1')console.log('quit')})\nprocess.on('SIGTERM',()=>{fs.appendFileSync(${JSON.stringify(log)},'sigterm\\n');process.exit(0)})\nsetInterval(()=>{},1000)\n`, { mode: 0o755 })
      return { f, log, read: () => (existsSync(log) ? readFileSync(log, 'utf8') : '') }
    }
    it('turns the tray on and off, remembers it in a private config file, and feeds the tray the engine state', async () => {
      const dir = J.tmp('tray'), tray = makeTray(dir), cfg = join(dir, 'config')
      const s = await startServer({ env: { XDG_CONFIG_HOME: cfg, DOCKDESK_TRAY_CMD: tray.f } })
      try {
        assert.deepEqual(await s.call('tray.status'), { available: true, enabled: false, hint: (await s.call('tray.status')).hint })
        assert.equal(tray.read(), '', 'nothing starts until it is switched on')
        assert.deepEqual(await s.call('tray.set', true), { enabled: true })
        await waitFor(() => /"engine":true,"running":\d+,"total":\d+/.test(tray.read()), { what: 'a status line to reach the tray' })
        assert.match(tray.read(), /^start .*public/, 'gets the icon folder')
        const file = join(cfg, 'dockdesk', 'config.json')
        assert.equal(statSync(file).mode & 0o777, 0o600); assert.equal(statSync(join(cfg, 'dockdesk')).mode & 0o777, 0o700)
        assert.equal(JSON.parse(readFileSync(file, 'utf8')).tray, true)
        assert.equal((await s.call('tray.status')).enabled, true)
        await s.call('tray.set', false)
        await waitFor(() => tray.read().includes('sigterm'), { what: 'the tray to be stopped' })
        assert.equal(await s.call('ping'), true, 'the server keeps running without the tray')
        assert.equal(JSON.parse(readFileSync(file, 'utf8')).tray, false)
        await assert.rejects(s.call('tray.set', 'yes'), /Invalid request/)
      } finally { s.stop() }
    })
    it('starts the tray by itself when it was left on, and the tray can quit DockDesk', async () => {
      const dir = J.tmp('tray2'), tray = makeTray(dir), cfg = join(dir, 'config')
      mkdirSync(join(cfg, 'dockdesk'), { recursive: true }); writeFileSync(join(cfg, 'dockdesk', 'config.json'), '{"tray":true}')
      const s = await startServer({ env: { XDG_CONFIG_HOME: cfg, DOCKDESK_TRAY_CMD: tray.f, FAKE_QUIT: '1' } })
      const code = await new Promise((ok) => { s.proc.on('exit', ok); setTimeout(() => ok('still running'), 8000) })
      assert.equal(code, 0, 'the tray asked DockDesk to quit')
      assert.match(tray.read(), /"engine":true/)
    })
    it('survives a broken or hostile config file', async () => {
      const dir = J.tmp('tray3'), cfg = join(dir, 'config')
      mkdirSync(join(cfg, 'dockdesk'), { recursive: true }); writeFileSync(join(cfg, 'dockdesk', 'config.json'), '[1,2,3')
      const s = await startServer({ env: { XDG_CONFIG_HOME: cfg } })
      try { assert.equal(await s.call('ping'), true); assert.equal((await s.call('tray.status')).enabled, false) } finally { s.stop() }
    })
  })

  describe('registry credentials', () => {
    it('reports sign-in state without ever exposing secrets', async () => {
      const s = await srv.call('registry.status'); assert.ok(Array.isArray(s.registries)); assert.ok(!JSON.stringify(s).match(/auth"|password|secret/i))
    })
  })
})
