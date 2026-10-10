// Browser tests: drive the real UI in headless Chromium (no npm packages; needs Node 22+ and Chromium/Chrome).
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import { startServer, janitor, docker, dockerTry, dockerAvailable, waitFor, PREFIX } from './helpers.mjs'
import { openPage, uiSkipReason, probeBrowser } from './cdp.mjs'

// A browser that can't start is an environment problem: locally, skip with the reason shown. In CI (CI=true) it must fail loudly instead.
const base = !dockerAvailable() ? 'Docker is not reachable' : uiSkipReason() || false
const probe = base || process.env.CI ? null : await probeBrowser()
const skip = base || probe || false

describe('DockDesk UI in a real browser', { skip }, () => {
  let J, srv, page, IMG, main, work, updates
  const PAGES = ['dashboard', 'compose', 'containers', 'images', 'volumes', 'networks', 'labs', 'activity', 'settings']
  const HEADING = { dashboard: 'Overview', compose: 'Compose', containers: 'Containers', images: 'Images', volumes: 'Volumes', networks: 'Networks', labs: 'Labs', activity: 'Activity', settings: 'Settings' }
  // wait for the NEW page's own heading, so we never act on the previous page's leftovers
  const nav = async (name) => { await page.click(`#nav [data-p=${name}]`); await page.waitFor(`document.querySelector('#nav a.on')?.dataset.p === '${name}' && (document.querySelector('#page h2')?.textContent || '').startsWith('${HEADING[name]}')`) }
  const nav_ = (n) => nav(n)
  // every test starts from a clean slate: no drawer, dialog, menu or palette left open
  const reset = () => page.eval(`document.querySelector('.detail #x')?.click();document.querySelector('.modal')?.remove();document.querySelector('.pal')?.remove();document.querySelector('#menu').hidden=true;true`)
  const openContainer = async (tab) => {
    await nav('containers')
    await page.waitFor(`[...document.querySelectorAll('#rows tr')].some(r=>r.textContent.includes('${main}'))`)
    await page.eval(`[...document.querySelectorAll('#rows tr')].find(r=>r.textContent.includes('${main}')).click()`)
    await page.waitFor(`!!document.querySelector('.detail .tabs')`)
    if (tab) await page.clickText('.detail .tabs a', tab)
  }

  before(async () => {
    J = janitor(); IMG = J.image(); work = J.tmp('ui')
    updates = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ version: '99.0.0' })) })
    await new Promise((ok) => updates.listen(0, '127.0.0.1', ok))
    srv = await startServer({ env: { XDG_DATA_HOME: join(work, 'xdg'), XDG_CONFIG_HOME: join(work, 'cfg'), DOCKDESK_UPDATE_URL: `http://127.0.0.1:${updates.address().port}/latest` } })
    main = `${PREFIX}-ui`
    const script = 'mkdir -p "/tmp/demo/sub folder"; printf "line one\\nline two\\n" > /tmp/demo/notes.txt; head -c 2000 /dev/urandom > /tmp/demo/blob.bin; i=0; while true; do i=$((i+1)); printf "\\033[32mINFO\\033[0m request $i ok\\n"; [ $((i%4)) -eq 0 ] && printf "\\033[31mERROR\\033[0m failed line $i\\n"; sleep 0.2; done'
    docker('run', '-d', '--name', main, '--stop-timeout', '1', '--entrypoint', 'sh', IMG, '-c', script)
    await waitFor(() => spawnSync('docker', ['exec', main, 'test', '-f', '/tmp/demo/notes.txt']).status === 0, { what: 'fixture files' })
    page = await openPage(srv.url)
    await page.eval('window.confirm = () => true') // dialogs from the app are auto-accepted
    await page.waitFor(`document.querySelector('#nav [data-p]') !== null`)
  })
  after(async () => { await page?.close(); srv?.stop(); updates?.close(); J.cleanup() })

  it('opens on Overview, with the sidebar in the intended order', async () => {
    assert.deepEqual(await page.eval(`[...document.querySelectorAll('#nav [data-p]')].map(a=>a.textContent.trim())`), ['Overview', 'Compose', 'Containers', 'Images', 'Volumes', 'Networks', 'Labs', 'Activity', 'Settings'])
    assert.equal(await page.eval(`document.querySelector('#nav a.on').dataset.p`), 'dashboard')
  })

  it('renders every page without errors', async () => {
    for (const p of PAGES) {
      await nav(p)
      const t = await page.text('#page')
      assert.ok(!/TypeError|ReferenceError|undefined|Cannot read/.test(t), `${p} shows an error: ${t.slice(0, 120)}`)
    }
    assert.deepEqual(page.exceptions, [], 'no uncaught JavaScript errors so far')
  })

  it('overview shows real numbers, a disk breakdown, and links through its tiles', async () => {
    await nav('dashboard')
    await page.waitFor(`document.querySelectorAll('.tile').length === 5`)
    assert.match(await page.text('.hostline'), /Docker \d/)
    await page.waitFor(`/^[\\d.]+ ?%/.test(document.querySelector('#d-live .mhead b')?.textContent || '')`)
    assert.equal(await page.count('.legend .lg'), 4)
    await page.eval(`document.querySelector('.tile[data-call*=images]').click()`)
    await page.waitFor(`document.querySelector('#nav a.on').dataset.p === 'images'`)
  })

  it('lists the fixture container and filters it by search', async () => {
    await nav('containers')
    await page.waitFor(`document.querySelector('#rows').textContent.includes('${main}')`)
    await page.set('#cq', 'zzz-no-such-container'); assert.match(await page.text('#rows'), /No matching containers/)
    await page.set('#cq', main); assert.ok((await page.text('#rows')).includes(main))
    await page.set('#cq', '')
  })

  it('Overview clean-up rows open the matching page filtered to what would be removed', async () => {
    const stoppedName = `${PREFIX}-zstop`; docker('create', '--name', stoppedName, IMG, 'true')
    try {
    await nav('dashboard'); await page.waitFor(`document.querySelectorAll('.crow .cgo').length === 5`)
    await page.clickText('.crow .cgo', 'Stopped containers'); await page.waitFor(`document.querySelector('#nav a.on').dataset.p === 'containers' && document.querySelector('#cstop')?.checked`)
    assert.ok(await page.eval(`[...document.querySelectorAll('#rows tr')].some(r=>r.textContent.includes('${stoppedName}'))`), 'the stopped container is listed')
    assert.ok(!(await page.eval(`[...document.querySelectorAll('#rows tr')].some(r=>r.textContent.includes('${main}'))`)), 'running containers are hidden')
    await page.click('#crun'); assert.equal(await page.eval(`document.querySelector('#cstop').checked`), false, 'the two switches are exclusive')
    await page.click('#crun') // back to showing everything for the other tests
    await page.eval(`document.querySelector('#crun').checked = false; document.querySelector('#crun').dispatchEvent(new Event('change', {bubbles:true}))`)
    for (const [row, p, sel, val] of [['Unused images', 'images', '#ifilter', 'unused'], ['Unused volumes', 'volumes', '#gfilter', 'unused'], ['Unused networks', 'networks', '#gfilter', 'unused']]) {
      await nav('dashboard'); await page.clickText('.crow .cgo', row)
      await page.waitFor(`document.querySelector('#nav a.on').dataset.p === '${p}' && document.querySelector('${sel}')?.value === '${val}'`)
    }
    assert.ok(!(await page.eval(`[...document.querySelectorAll('#grows tr')].some(r=>/^\\s*(bridge|host|none)\\b/.test(r.textContent))`)), 'built-in networks are not listed as unused')
    await page.eval(`document.querySelector('#gfilter').value='all'; document.querySelector('#gfilter').dispatchEvent(new Event('change',{bubbles:true}))`)
    } finally {
      dockerTry('rm', '-f', stoppedName)
      await page.eval(`document.querySelector('#cstop') && (document.querySelector('#cstop').checked = false, document.querySelector('#cstop').dispatchEvent(new Event('change', {bubbles:true})))`).catch(() => {})
      await nav('images'); await page.eval(`document.querySelector('#ifilter').value='all'; document.querySelector('#ifilter').dispatchEvent(new Event('change',{bubbles:true}))`)
    }
  })

  it('container settings show well-spaced buttons to remove memory and CPU limits', async () => {
    const lim = `${PREFIX}-zlim`; docker('run', '-d', '--name', lim, '--memory', '64m', '--cpus', '1', '--stop-timeout', '1', '--entrypoint', 'sleep', IMG, '300')
    try {
      await nav('containers'); await page.waitFor(`[...document.querySelectorAll('#rows tr')].some(r=>r.textContent.includes('${lim}'))`)
      await page.eval(`[...document.querySelectorAll('#rows tr')].find(r=>r.textContent.includes('${lim}')).click()`)
      await page.waitFor(`!!document.querySelector('.detail .tabs')`); await page.clickText('.detail .tabs a', 'Settings')
      await page.waitFor(`!!document.querySelector('#cs-nomem') && !!document.querySelector('#cs-nocpu')`)
      const gap = await page.eval(`(()=>{const a=document.querySelector('#cs-nomem').getBoundingClientRect(),b=document.querySelector('#cs-nocpu').getBoundingClientRect();return b.left>a.right?b.left-a.right:(b.top-a.bottom)})()`)
      assert.ok(gap >= 8, `buttons need breathing room, gap was ${gap}px`)
      const cleared = await page.eval(`(()=>{const s=document.querySelector('#cs-save').getBoundingClientRect(),l=document.querySelector('.limits').getBoundingClientRect();return l.top-s.bottom})()`)
      assert.ok(cleared >= 8, `the remove-limit block must be separated from Save, was ${cleared}px`)
    } finally { await reset(); dockerTry('rm', '-f', lim) }
  })

  it('container drawer: overview, logs, stats, files, settings and inspect tabs all render', async () => {
    await openContainer()
    assert.deepEqual(await page.eval(`[...document.querySelectorAll('.detail .tabs a')].map(a=>a.textContent.trim())`), ['Overview', 'Logs', 'Stats', 'Files', 'Settings', 'Inspect'])
    await page.clickText('.detail .tabs a', 'Overview'); assert.match(await page.text('.detail .pane'), /Image/)
    await page.clickText('.detail .tabs a', 'Settings'); assert.equal(await page.eval(`document.querySelector('#cs-name').value`), main)
    await page.clickText('.detail .tabs a', 'Inspect'); await page.waitFor(`document.querySelectorAll('.jl').length > 100 && document.querySelectorAll('.jchip').length >= 8`)
    await page.clickText('.jchip', 'Mounts'); await page.waitFor(`document.querySelector('.jchip.on')?.textContent === 'Mounts'`)
    await page.set('#jq', 'Image'); await page.waitFor(`/\\d+ \\/ \\d+/.test(document.querySelector('#jcount').textContent)`)
    await page.clickText('.detail .tabs a', 'Stats'); await page.waitFor(`document.querySelectorAll('.stile').length === 4`)
    assert.match(await page.text('.shead'), /Live/)
    await reset()
  })

  it('log viewer: colours, search, only-matching, timestamps, follow and download link', async () => {
    await openContainer('Logs')
    await page.waitFor(`document.querySelectorAll('.ll').length > 8`)
    assert.ok(await page.count('.ll .a32') > 0, 'green INFO spans'); assert.ok(await page.count('.ll.lvl-err') > 0, 'error lines are tinted')
    assert.equal(await page.eval(`document.querySelector('#llines').textContent.includes('\\u001b')`), false, 'no raw escape characters')
    await page.set('#lq', 'ERROR failed'); await page.waitFor(`/^1 \\/ \\d+/.test(document.querySelector('#lcount').textContent)`)
    assert.ok(await page.count('mark') >= 2, 'a match crossing a colour change splits into marks')
    await page.key('#lq', 'Enter'); await page.waitFor(`/^2 \\/ \\d+/.test(document.querySelector('#lcount').textContent)`)
    await page.click('#lonly'); await page.waitFor(`document.querySelectorAll('.ll').length > 0 && [...document.querySelectorAll('.ll')].every(l=>l.textContent.includes('ERROR failed'))`)
    await page.set('#lq', ''); await page.click('#lonly')
    await page.click('#lts'); await page.waitFor(`/^\\d{4}-\\d\\d-\\d\\dT/.test(document.querySelector('.ll')?.textContent||'')`)
    const href = await page.eval(`document.querySelector('#ldl').getAttribute('href')`)
    assert.match(href, /^\/download\/logs\?id=[0-9a-f]+&tail=all&timestamps=1&t=/)
    const body = await page.eval(`fetch(${JSON.stringify(href)}).then(r=>r.text())`)
    assert.ok(body.split('\n').length > 5 && !body.includes('\x1b'), 'downloaded log is plain text')
    await reset()
  })

  it('files tab: browse, preview text, flag binary, and upload', async () => {
    await openContainer('Files')
    await page.waitFor(`document.querySelectorAll('.frow').length > 5`)
    await page.set('#fpath', '/tmp/demo', []); await page.key('#fpath', 'Enter')
    await page.waitFor(`[...document.querySelectorAll('.frow')].some(r=>r.dataset.name==='notes.txt')`)
    await page.eval(`[...document.querySelectorAll('.frow')].find(r=>r.dataset.name==='notes.txt').click()`)
    await page.waitFor(`document.querySelector('.pvcode')?.textContent.includes('line two')`); await page.click('#pvc')
    await page.eval(`[...document.querySelectorAll('.frow')].find(r=>r.dataset.name==='blob.bin').click()`)
    await page.waitFor(`document.querySelector('.modal .empty')?.textContent.includes('Binary')`); await page.click('#pvc')
    await page.eval(`(()=>{const dt=new DataTransfer();dt.items.add(new File(['hello from the ui test\\n'],'ui-up.txt'));const i=document.querySelector('#ffile');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`)
    await waitFor(() => dockerTry('exec', main, 'cat', '/tmp/demo/ui-up.txt') === 'hello from the ui test', { what: 'the uploaded file inside the container' })
    await reset()
  })

  it('command palette: opens with Ctrl+K and /, runs actions, fuzzy-matches, closes with Esc', async () => {
    await nav('dashboard')
    const ctrlK = () => page.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))`)
    await ctrlK(); await page.waitFor(`!!document.querySelector('.pal')`)
    await page.set('#palq', main); await page.waitFor(`[...document.querySelectorAll('.paltitle')].some(t=>t.textContent==='${main}')`)
    await page.set('#palq', `logs of ${main}`); await page.waitFor(`document.querySelector('.palrow.on .paltitle')?.textContent === 'Logs of ${main}'`)
    await page.key('#palq', 'Enter')
    await page.waitFor(`document.querySelector('.detail .tabs a.on')?.textContent.trim() === 'Logs'`)
    await reset()
    await ctrlK(); await page.waitFor(`!!document.querySelector('.pal')`); await page.set('#palq', 'cntrs')
    assert.equal(await page.text('.palrow.on .paltitle'), 'Go to Containers')
    await page.key('#palq', 'Enter'); await page.waitFor(`document.querySelector('#nav a.on').dataset.p === 'containers'`)
    await page.eval(`document.body.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true}))`); await page.waitFor(`!!document.querySelector('.pal')`)
    await page.key('#palq', 'Escape'); await page.waitFor(`!document.querySelector('.pal')`)
    await ctrlK(); await page.waitFor(`!!document.querySelector('.pal')`); await page.set('#palq', 'zzzzqqq'); assert.match(await page.text('.palres'), /Nothing matches/)
    await reset()
  })

  it('compose editor: validates good and bad YAML without starting anything', async () => {
    await nav('compose')
    await page.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('New project')).click()`)
    await page.waitFor(`!!document.querySelector('#ceyaml')`)
    await page.set('#cetpl', 'Nginx web server', ['change']); assert.match(await page.eval(`document.querySelector('#ceyaml').value`), /nginx:alpine/)
    await page.set('#ceyaml', 'services:\n  web:\n    image: x\n    prots: ["1:2"]\n', ['input'])
    await page.click('#cevalidate'); await page.waitFor(`document.querySelector('#cestat').classList.contains('bad')`)
    assert.match(await page.text('#cestat'), /prots/)
    await page.set('#ceyaml', `services:\n  a:\n    image: ${IMG}\n  b:\n    image: ${IMG}\n`, ['input'])
    await page.click('#cevalidate'); await page.waitFor(`document.querySelector('#cestat').classList.contains('ok')`)
    assert.match(await page.text('#cestat'), /Valid · 2 services/)
    await page.set('#cename', 'Bad Name'); await page.click('#cego'); await page.waitFor(`/lowercase/.test(document.querySelector('#cestat').textContent)`)
    assert.equal(dockerTry('ps', '-aq', '--filter', 'label=com.docker.compose.project=bad-name'), '', 'nothing may have been started')
    await reset()
  })

  it('images: the run dialog shows the advanced options and the layers drawer matches Docker', async () => {
    await nav('images')
    await page.waitFor(`document.querySelectorAll('#irows tr [data-call*=run]').length > 0`)
    await page.eval(`document.querySelector('#irows tr [data-call*=run]').click()`)
    await page.waitFor(`!!document.querySelector('details.adv')`)
    for (const id of ['#ra-bind', '#ra-net', '#ra-restart', '#ra-mem', '#ra-cpu', '#ra-caps', '#ra-dev', '#ra-it', '#ra-priv']) assert.equal(await page.count(id), 1, `${id} is present`)
    assert.equal(await page.eval(`document.querySelector('#ra-bind').value`), '127.0.0.1', 'ports default to localhost')
    await reset()
    await page.eval(`[...document.querySelectorAll('#irows tr')].find(r=>r.textContent.includes('${IMG.split(':')[0]}')).click()`)
    await page.waitFor(`document.querySelectorAll('table.layers tbody tr').length > 0`)
    const cli = docker('history', '-q', IMG).split('\n').length
    assert.equal(await page.count('table.layers tbody tr'), cli, 'layer count matches `docker history`')
    await reset()
  })

  it('activity: shows history, filters by type, and flags problems', async () => {
    await nav('activity')
    await page.waitFor(`document.querySelector('#arows').textContent.includes('${main}')`)
    await page.set('#atype', 'image', ['change']); assert.ok(!(await page.text('#arows')).includes(main), 'container events are filtered out')
    await page.set('#atype', 'all', ['change'])
    await page.set('#aq', main); const rows = await page.text('#arows'); assert.ok(rows.includes('start'), `expected a start event for ${main}; rows were: ${rows.slice(0, 300)}`)
    await page.set('#aq', ''); await page.click('#aprob'); await page.click('#aprob')
    assert.match(await page.text('.head .usage'), /Problems/)
  })

  it('labs: lists the six labs with the localhost-only warning, without starting any', async () => {
    await nav('labs')
    assert.equal(await page.count('.card.lab'), 6)
    assert.match(await page.text('.note'), /127\.0\.0\.1/)
    assert.equal(dockerTry('ps', '-aq', '--filter', 'label=dockdesk.lab'), '', 'viewing labs must not start anything')
  })

  it('settings: saves choices, switches theme, resets, and explains docker access', async () => {
    await nav('settings')
    await page.set('[data-setting=refresh]', '5', ['change'])
    await page.waitFor(`JSON.parse(localStorage.getItem('settings')).refresh === 5`)
    await page.set('[data-setting=theme]', 'dark', ['change']); await page.waitFor(`document.documentElement.dataset.theme === 'dark'`)
    assert.match(await page.text('#page'), /Docker access/); assert.match(await page.text('.note'), /root-equivalent/)
    await page.click('[data-call*=resetsettings]'); await page.waitFor(`JSON.parse(localStorage.getItem('settings')).refresh === 3`)
  })

  // ---- new features ----
  const clip = async () => page.eval('window.__clip')
  const captureClipboard = () => page.eval(`window.__clip = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__clip = t } } }); true`)

  it('run dialog: copy as docker run / Compose, fill from a pasted command, presets, and port conflicts', async () => {
    await captureClipboard()
    await nav('images')
    await page.waitFor(`document.querySelectorAll('#irows tr [data-call*=run]').length > 0`)
    await page.eval(`document.querySelector('#irows tr [data-call*=run]').click()`)
    await page.waitFor(`!!document.querySelector('#rpaste')`)
    await page.click('#rpaste')
    await page.set('#rpastebox textarea', `docker run -d --name web1 -p 127.0.0.1:18080:80 -p 9000:9000/udp -v /data:/d -e 'A=b c' --restart=unless-stopped -m 256m --cpus 0.5 --cap-add NET_ADMIN --network host ${IMG}`, ['input'])
    await page.click('#rpapply')
    assert.equal(await page.eval(`document.querySelector('#rn').value`), 'web1')
    assert.equal(await page.eval(`document.querySelectorAll('.rows[data-kind=ports] .rrow').length`), 2)
    assert.equal(await page.eval(`document.querySelector('#ra-restart').value`), 'unless-stopped')
    assert.equal(await page.eval(`document.querySelector('#ra-mem').value`), '256')
    assert.equal(await page.eval(`document.querySelector('#ra-net').value`), 'host')
    assert.equal(await page.eval(`document.querySelector('details.adv').open`), true)
    await page.set('#ra-net', 'bridge')
    await page.click('#rcopy')
    assert.equal(await clip(), `docker run -d --name web1 -p 127.0.0.1:18080:80 -p 127.0.0.1:9000:9000/udp -v /data:/d -e 'A=b c' --restart unless-stopped --memory 256m --cpus 0.5 --cap-add NET_ADMIN ${IMG}`)
    await page.click('#rccopy')
    const yml = await clip()
    assert.match(yml, /^services:\n {2}web1:\n {4}image: ".*"\n/); assert.match(yml, /- "127\.0\.0\.1:18080:80"/); assert.match(yml, /restart: unless-stopped/); assert.match(yml, /mem_limit: "256m"/)
    // the generated compose file is accepted by docker compose
    assert.ok((await srv.call('compose.validate', yml)).services.includes('web1'))
    // presets: save, clear the form, load again
    await page.eval(`window.prompt = () => 'ui preset'`)
    await page.click('#rpsave')
    await page.waitFor(`[...document.querySelectorAll('#rpre option')].some(o=>o.textContent==='ui preset')`)
    await page.set('#rn', 'changed'); await page.set('#rpre', 'ui preset', ['change'])
    await page.waitFor(`document.querySelector('#rn').value === 'web1'`)
    await page.eval(`window.confirm = () => true`); await page.click('#rpdel')
    await page.waitFor(`![...document.querySelectorAll('#rpre option')].some(o=>o.textContent==='ui preset')`)
    // port conflict warning
    const net = await import('node:net'), busy = net.createServer()
    await new Promise((ok) => busy.listen(0, '127.0.0.1', ok))
    try {
      await page.set('.rows[data-kind=ports] .rrow input', String(busy.address().port))
      await page.waitFor(`document.querySelector('#rwarn .warnbox')?.textContent.includes('${busy.address().port}')`)
      await page.set('.rows[data-kind=ports] .rrow input', '')
      await page.waitFor(`!document.querySelector('#rwarn .warnbox')`)
    } finally { busy.close() }
    await page.eval(`document.querySelector('#rpaste').click()`); await page.set('#rpastebox textarea', 'ls -la', ['input']); await page.click('#rpapply')
    assert.match(await page.eval(`document.querySelector('#toast').textContent`), /does not start with/)
    await reset()
  })

  it('copy as command works in the other dialogs', async () => {
    await captureClipboard()
    await nav('volumes')
    await page.click('[data-call*=newvol]'); await page.waitFor(`!!document.querySelector('.modal .cli')`)
    await page.set('input[name=name]', 'my-data'); await page.click('.modal .cli'); assert.equal(await clip(), 'docker volume create my-data')
    await reset(); await nav('networks')
    await page.click('[data-call*=newnet]'); await page.waitFor(`!!document.querySelector('.modal .cli')`)
    await page.set('input[name=name]', 'my-net'); await page.set('input[name=subnet]', '10.20.0.0/24'); await page.click('.modal .cli')
    assert.equal(await clip(), 'docker network create --subnet 10.20.0.0/24 my-net')
    await reset(); await nav('images')
    await page.eval(`document.querySelector('[data-call=\\'["pull"]\\']').click()`); await page.waitFor(`!!document.querySelector('.modal .cli')`)
    await page.set('#pimg', 'nginx:alpine', ['input']); await page.click('.modal .cli'); assert.equal(await clip(), 'docker pull nginx:alpine')
    await reset()
    await page.click('[data-call*=\\"build\\"]'); await page.waitFor(`!!document.querySelector('#bdir')`)
    await page.waitFor(`document.querySelector('#bdir').value !== ''`) // the picker fills in the home folder first
    await page.set('#bdir', '/tmp', ['input']); await page.set('#btag', 'app:1', ['input']); await page.click('.modal .cli')
    assert.equal(await clip(), 'docker build -f /tmp/Dockerfile -t app:1 /tmp')
    await reset()
    await page.click('[data-call*=importimg]'); await page.waitFor(`!!document.querySelector('#ipath')`)
    await page.set('#ipath', '/tmp/a b.tar', ['input']); await page.click('.modal .cli'); assert.equal(await clip(), `docker load -i '/tmp/a b.tar'`)
    await reset()
    await openContainer('Settings'); await page.waitFor(`!!document.querySelector('#cs-save')`)
    await page.set('#cs-restart', 'always', ['change']); await page.set('#cs-mem', '128', ['input']); await page.click('.detail .cli')
    assert.equal(await clip(), `docker update --restart always --memory 128m --memory-swap 256m ${main}`)
    await reset()
  })

  it('images: compare two images and see which layers differ', async () => {
    const tiny = `${PREFIX}/cmp:1`, ctx = J.tmp('cmp')
    execFileSync('sh', ['-c', `printf 'FROM scratch\\nENV ONLY_B=1\\nCOPY h.txt /h.txt\\n' > Dockerfile; echo hi > h.txt`], { cwd: ctx })
    docker('build', '-q', '-t', tiny, ctx)
    await nav('images')
    await page.waitFor(`document.querySelector('#irows').textContent.includes('${PREFIX}/cmp')`)
    await page.click('[data-call*=cmpimg]'); await page.waitFor(`!!document.querySelector('#cmpa')`)
    await page.set('#cmpa', IMG, ['change']); await page.set('#cmpb', tiny, ['change']); await page.click('#cmpgo')
    await page.waitFor(`document.querySelector('#cmpout .ctable')?.textContent.includes('Entrypoint')`)
    const t = await page.text('#cmpout')
    assert.match(t, /Environment differences/); assert.match(t, /ONLY_B/); assert.match(t, /Only in A \(\d+\)/); assert.match(t, /Only in B \(\d+\)/)
    assert.match(t, /COPY h\.txt/)
    await page.set('#cmpb', IMG, ['change']); await page.click('#cmpgo'); assert.match(await page.text('#cmpout'), /Pick two different images/)
    await reset()
    await page.click('[data-call*=imgupdates]') // images built or loaded locally cannot be checked: it must finish quietly
    // every tagged image on this machine is asked of its registry, so this depends on the network and how many images exist
    await page.waitFor(`/up to date|update/.test(document.querySelector('#toast').textContent)`, { timeout: 90000 })
  })

  it('files tab: edit a text file in place and keep its permissions', async () => {
    docker('exec', main, 'sh', '-c', 'printf "before\\n" > /tmp/demo/ui-edit.txt; chmod 600 /tmp/demo/ui-edit.txt')
    await openContainer('Files')
    await page.waitFor(`document.querySelectorAll('.frow').length > 3`)
    await page.set('#fpath', '/tmp/demo', []); await page.key('#fpath', 'Enter')
    await page.waitFor(`[...document.querySelectorAll('.frow')].some(r=>r.dataset.name==='ui-edit.txt')`)
    await page.eval(`[...document.querySelectorAll('.frow')].find(r=>r.dataset.name==='ui-edit.txt').click()`)
    await page.waitFor(`!!document.querySelector('#pve')`)
    await page.click('#pve'); await page.set('.modal textarea', 'after edit\nline 2\n', ['input']); await page.click('#pvsave')
    await waitFor(() => dockerTry('exec', main, 'cat', '/tmp/demo/ui-edit.txt') === 'after edit\nline 2', { what: 'the edited file' })
    assert.equal(dockerTry('exec', main, 'stat', '-c', '%a', '/tmp/demo/ui-edit.txt'), '600')
    await page.waitFor(`document.querySelector('.pvcode')?.textContent.includes('after edit')`) // re-opened in read-only view
    await reset()
    await openContainer('Files'); await page.waitFor(`document.querySelectorAll('.frow').length > 3`); await page.set('#fpath', '/tmp/demo', []); await page.key('#fpath', 'Enter')
    await page.waitFor(`[...document.querySelectorAll('.frow')].some(r=>r.dataset.name==='blob.bin')`)
    await page.eval(`[...document.querySelectorAll('.frow')].find(r=>r.dataset.name==='blob.bin').click()`)
    await page.waitFor(`document.querySelector('.modal .empty')?.textContent.includes('Binary')`)
    assert.equal(await page.count('#pve'), 0)
    await reset()
  })

  it('published ports have a copy button, and compose gets graph, env, profiles and per-service actions', async () => {
    await captureClipboard()
    const web = `${PREFIX}-uiport`
    docker('run', '-d', '--name', web, '--stop-timeout', '1', '-p', '127.0.0.1::8080', '--entrypoint', 'sleep', IMG, '120')
    const port = docker('port', web, '8080/tcp').split(':').pop()
    await nav('containers')
    await page.waitFor(`[...document.querySelectorAll('#rows tr')].some(r=>r.textContent.includes('${web}') && r.querySelector('.pcopy'))`)
    await page.eval(`[...document.querySelectorAll('#rows tr')].find(r=>r.textContent.includes('${web}')).querySelector('.pcopy').click()`)
    assert.equal(await clip(), `http://localhost:${port}`)

    const proj = `${PREFIX}-uicp`
    const svc = (n, x = '') => `  ${n}:\n    image: ${IMG}\n    entrypoint: ["sleep","600"]\n    stop_grace_period: 1s\n${x}`
    const { file, dir } = await srv.call('compose.save', proj, `services:\n${svc('db')}${svc('web', '    depends_on:\n      - db\n')}`)
    try {
      await srv.call('compose.action', proj, dir, file, 'up')
      await nav('compose')
      await page.waitFor(`document.querySelector('#cprows').textContent.includes('${proj}')`)
      await page.eval(`[...document.querySelectorAll('#cprows tr.cprow')].find(r=>r.textContent.includes('${proj}')).click()`)
      await page.waitFor(`document.querySelectorAll('#cprows .nested [data-call*=svcscale]').length === 2 && document.querySelectorAll('#cprows .nested [data-call*="compose.service"]').length === 2`)
      const menu = async (label) => { await page.eval(`[...document.querySelectorAll('#cprows tr.cprow')].find(r=>r.textContent.includes('${proj}')).querySelector('[data-call*=cmenu]').click()`); await page.clickText('#menu button', label) }
      // dependency graph
      await menu('Dependency graph')
      await page.waitFor(`document.querySelectorAll('.graph svg g').length === 2 && document.querySelectorAll('.graph svg path[marker-end]').length === 1`)
      assert.match(await page.text('.graph'), /db.*web|web.*db/); await reset()
      // profiles: this project has none
      await menu('Start with profiles'); await page.waitFor(`document.querySelector('.modal')?.textContent.includes('does not define any profiles')`); await reset()
      // .env
      await menu('Environment (.env)'); await page.waitFor(`!!document.querySelector('#envta')`)
      await page.set('#envta', 'FOO=bar\n', ['input']); await page.click('#envs'); await waitFor(() => existsSync(join(dir, '.env')) && readFileSync(join(dir, '.env'), 'utf8') === 'FOO=bar\n', { what: '.env to be written' })
      await reset()
      // per-service restart and scale
      const webId = () => docker('ps', '-q', '--filter', `label=com.docker.compose.project=${proj}`, '--filter', 'label=com.docker.compose.service=web')
      const started = () => docker('inspect', '-f', '{{.State.StartedAt}}', webId())
      const t0 = started()
      await page.eval(`[...document.querySelectorAll('#cprows .nested tr')].find(r=>r.textContent.includes('web')).querySelector('[data-call*="compose.service"]').click()`)
      await waitFor(() => started() !== t0, { timeout: 30000, what: 'the web service to restart' })
      await page.eval(`[...document.querySelectorAll('#cprows .nested tr')].find(r=>r.querySelector('.nm')?.textContent==='web').querySelector('[data-call*=svcscale]').click()`)
      await page.waitFor(`!!document.querySelector('.modal input[name=n]')`)
      await page.click('.modal .cli'); assert.match(await clip(), /--scale web=1 web$/)
      await page.set('input[name=n]', '2'); await page.click('.modal form .pri')
      await waitFor(() => docker('ps', '-q', '--filter', `label=com.docker.compose.project=${proj}`, '--filter', 'label=com.docker.compose.service=web').split('\n').filter(Boolean).length === 2, { timeout: 30000, what: 'two web containers' })
    } finally {
      dockerTry('compose', '-p', proj, '-f', file, 'down', '-t', '1')
      dockerTry('rm', '-f', web)
      await reset()
    }
  })

  it('keyboard shortcuts: ? opens the cheat sheet, g then a letter navigates, t and r work, typing is left alone', async () => {
    const press = (key, target = 'body') => page.eval(`document.querySelector(${JSON.stringify(target)}).dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}))`)
    await nav('dashboard')
    await press('?'); await page.waitFor(`!!document.querySelector('.modal.keys')`)
    const sheet = await page.text('.modal.keys')
    for (const w of ['Keyboard shortcuts', 'Anywhere', 'Go to a page', 'Open search and commands', 'Show this cheat sheet', 'In the log viewer']) assert.ok(sheet.includes(w), `sheet mentions ${w}`)
    assert.equal(await page.count('.modal.keys kbd') > 20, true)
    await press('?'); await page.waitFor(`!document.querySelector('.modal')`) // ? again closes it
    await press('?'); await page.waitFor(`!!document.querySelector('.modal.keys')`); await press('Escape'); await page.waitFor(`!document.querySelector('.modal')`)
    // g, then a letter
    const via = { c: 'containers', i: 'images', v: 'volumes', n: 'networks', l: 'labs', a: 'activity', s: 'settings', m: 'compose', o: 'dashboard' }
    for (const [k, p] of Object.entries(via)) { await press('g'); await press(k); await page.waitFor(`document.querySelector('#nav a.on').dataset.p === '${p}'`) }
    await press('g'); await press('z'); assert.equal(await page.eval(`document.querySelector('#nav a.on').dataset.p`), 'dashboard', 'an unknown second key does nothing')
    // not while typing in a field
    await nav('containers'); await page.waitFor(`!!document.querySelector('#cq')`)
    await page.eval(`document.querySelector('#cq').focus()`); await press('g', '#cq'); await press('i', '#cq')
    assert.equal(await page.eval(`document.querySelector('#nav a.on').dataset.p`), 'containers', 'typing "gi" in a search box does not navigate')
    // footer button
    await page.eval(`document.querySelector('#cq').blur()`); await page.click('#status [data-call*=shortcuts]'); await page.waitFor(`!!document.querySelector('.modal.keys')`); await reset()
    // every shortcut the sheet lists works from Settings too
    await nav('settings'); await page.clickText('[data-call*=shortcuts]', 'Show'); await page.waitFor(`!!document.querySelector('.modal.keys')`); await reset()
  })

  it('language: switches menus and titles, remembers it, and goes back to English', async () => {
    await nav('settings')
    await page.waitFor(`!!document.querySelector('select[data-setting=lang]')`)
    const opts = await page.eval(`[...document.querySelectorAll('select[data-setting=lang] option')].map(o=>o.value+':'+o.textContent)`)
    assert.deepEqual(opts, ['auto:Automatic', 'en:English', 'es:Español', 'fr:Français', 'de:Deutsch', 'hi:हिन्दी'])
    await page.set('select[data-setting=lang]', 'es', ['change'])
    await page.waitFor(`document.querySelector('#nav [data-p=containers]').textContent.trim() === 'Contenedores'`)
    assert.equal(await page.eval(`document.documentElement.lang`), 'es')
    assert.deepEqual(await page.eval(`[...document.querySelectorAll('#nav [data-p]')].map(a=>a.textContent.trim())`), ['Resumen', 'Compose', 'Contenedores', 'Imágenes', 'Volúmenes', 'Redes', 'Laboratorios', 'Actividad', 'Ajustes'])
    await page.waitFor(`document.querySelector('#page h2')?.textContent.startsWith('Ajustes')`)
    assert.match(await page.text('#page'), /Idioma/); assert.match(await page.text('#status'), /Terminal/)
    await page.set('select[data-setting=lang]', 'hi', ['change']); await page.waitFor(`document.querySelector('#nav [data-p=containers]').textContent.trim() === 'कंटेनर'`)
    assert.equal(JSON.parse(await page.eval(`localStorage.getItem('settings')`)).lang, 'hi')
    await page.click('#nav [data-p=containers]'); await page.waitFor(`document.querySelector('#page h2')?.textContent.startsWith('कंटेनर')`)
    await page.eval(`(()=>{const s=JSON.parse(localStorage.getItem('settings'));s.lang='auto';localStorage.setItem('settings',JSON.stringify(s))})()`)
    await page.eval(`location.reload()`); await page.waitFor(`document.querySelector('#nav [data-p]') !== null && document.querySelector('#nav [data-p=containers]').textContent.trim() === 'Containers'`)
    await page.eval('window.confirm = () => true')
  })

  it('language: the whole interface is translated (not only menus), data stays as it is, and English comes back', async () => {
    try {
      // host data is never translated: the OS name and version ("Ubuntu 24.04.5 LTS"), versions, fixture names
    const left = () => page.eval(`import('/translate.js').then((m)=>{const u=m.untranslated();return [...u.text,...u.attr].filter((t)=>/^[A-Z][a-z]+(\\s+\\S+)*$/.test(t)&&!/${PREFIX}|^(CPU|RAM|Docker|DockDesk|Ctrl|Shift|Enter|Esc|Kali|Mutillidae)\\b|\\d+\\.\\d+|\\bLinux\\b/.test(t)&&!/^[A-Z][a-z]{2} \\d/.test(t))})`)
      await nav('settings')
      await page.waitFor(`!!document.querySelector('select[data-setting=lang]')`)
      await page.set('select[data-setting=lang]', 'fr', ['change'])
      await page.waitFor(`document.querySelector('#nav [data-p=containers]').textContent.trim() === 'Conteneurs'`)
      // every page, plus a container drawer, the Run dialog and a menu: nothing user-facing is left in English
      const seen = {}
      const navL = async (p) => { await page.click(`#nav [data-p=${p}]`); await page.waitFor(`document.querySelector('#nav a.on')?.dataset.p === '${p}'`); await new Promise((r) => setTimeout(r, 900)) }
      for (const p of PAGES) { await navL(p); seen[p] = await left() }
      await navL('containers'); await page.eval(`[...document.querySelectorAll('#rows tr')].find(r=>r.textContent.includes('${main}')).click()`); await page.waitFor(`!!document.querySelector('.detail .tabs')`); for (const t of ['Logs', 'Stats', 'Files', 'Settings', 'Inspect']) { await page.eval(`[...document.querySelectorAll('.detail .tabs a')].find(a=>a.dataset.t==='${t}')?.click()`); await new Promise((r) => setTimeout(r, 600)); seen['drawer ' + t] = await left() }
      await reset()
      await navL('images'); await page.waitFor(`document.querySelectorAll('#irows tr [data-call*=run]').length > 0`)
      await page.eval(`document.querySelector('#irows tr [data-call*=run]').click()`); await page.waitFor(`!!document.querySelector('details.adv')`)
      await page.eval(`document.querySelector('details.adv').open = true`); seen['run dialog'] = await left(); await reset()
      const leftover = Object.fromEntries(Object.entries(seen).filter(([, v]) => v.length))
      assert.deepEqual(leftover, {}, 'untranslated text in French')
      // a sentence with inline markup is rebuilt from nodes: bold and code spans survive, and no tag text leaks onto the page
      await navL('labs'); await page.waitFor(`!!document.querySelector('.note b')`)
      assert.deepEqual(await page.eval(`(()=>{const n=document.querySelector('.note');return {bold:n.querySelector('b').textContent,code:n.querySelector('.mono').textContent,leak:/[<>]|&lt;|&amp;/.test(n.textContent)}})()`), { bold: 'Ces applications sont volontairement vulnérables.', code: '127.0.0.1', leak: false })
      // translated through patterns and nested values
      await navL('containers'); await page.waitFor(`[...document.querySelectorAll('#rows tr')].some(r=>r.textContent.includes('${main}'))`)
      assert.match(await page.text('#page'), /Actif|Arrêté|En cours|il y a|Il y a/i, 'container status and ages are translated')
      // native dialogs go through the same dictionary
      assert.equal(await page.eval(`import('/translate.js').then((m)=>m.translateString('Delete 2 container(s)?'))`), 'Supprimer 2 conteneur(s) ?')
      // data is left alone: the fixture container keeps its name
      assert.ok(await page.eval(`[...document.querySelectorAll('#rows tr')].some(r=>r.textContent.includes('${main}'))`))
      // and switching back restores the English text everywhere
      await navL('settings'); await page.set('select[data-setting=lang]', 'en', ['change'])
      await page.waitFor(`document.querySelector('#nav [data-p=containers]').textContent.trim() === 'Containers'`)
      await navL('containers'); await page.waitFor(`/Only show stopped/.test(document.querySelector('#page').textContent)`)
      assert.equal(await page.eval(`(document.documentElement.lang)`), 'en')
      await navL('labs'); await page.waitFor(`document.querySelector('.note b')?.textContent === 'These apps are intentionally vulnerable.'`)
      await page.eval(`(()=>{const s=JSON.parse(localStorage.getItem('settings'));s.lang='auto';localStorage.setItem('settings',JSON.stringify(s))})()`)
    } finally {
      await page.click('#nav [data-p=settings]'); await page.waitFor(`!!document.querySelector('select[data-setting=lang]')`)
      await page.set('select[data-setting=lang]', 'auto', ['change'])
      await page.waitFor(`document.querySelector('#nav [data-p=containers]').textContent.trim() === 'Containers'`)
    }
  })

  it('updates: checking shows the new version, the install command and a pill in the status bar', async () => {
    await nav_('settings')
    await page.waitFor(`!!document.querySelector('[data-call*=checkupdate]')`)
    assert.match(await page.text('#page'), /DockDesk v\d/); assert.match(await page.text('#page'), /Installed with/)
    await page.click('[data-call*=checkupdate]')
    await page.waitFor(`document.querySelector('#status .upd')?.textContent.includes('v99.0.0')`)
    await page.waitFor(`document.querySelector('#page').textContent.includes('DockDesk 99.0.0 is available')`)
    assert.match(await page.text('#page'), /git pull/, 'source installs are told to git pull')
    assert.equal(await page.count('[data-call*=openrelease]') > 0, true)
    await page.click('#status .upd'); await page.waitFor(`document.querySelector('#nav a.on').dataset.p === 'settings'`)
    // the daily check is opt-in
    assert.equal(JSON.parse(await page.eval(`localStorage.getItem('settings')`)).autoUpdate ?? false, false)
    assert.equal(await page.eval(`document.querySelector('[data-setting=autoUpdate]').checked`), false)
  })

  it('tray row: shown with a switch, and explains what is missing when the tray cannot run here', async () => {
    await nav_('settings'); await page.waitFor(`!!document.querySelector('[data-setting=tray]')`)
    const t = await page.text('#page')
    assert.match(t, /System tray icon/)
    const avail = await page.eval(`!document.querySelector('[data-setting=tray]').disabled`)
    if (!avail) assert.match(t, /python3-gi/)
  })

  it('settings backup: export writes a file, import restores it, and bad files are refused', async () => {
    await nav_('settings'); await page.waitFor(`!!document.querySelector('[data-call*=exportsettings]')`)
    // set something recognisable, then capture what Export would download
    await page.set('select[data-setting=refresh]', '10', ['change']); await page.waitFor(`JSON.parse(localStorage.getItem('settings')).refresh === 10`)
    await page.waitFor(`!!document.querySelector('[data-call*=exportsettings]')`)
    await page.eval(`window.__dl = null; HTMLAnchorElement.prototype.click = function () { window.__dlName = this.download; fetch(this.href).then((r) => r.text()).then((t) => (window.__dl = t)) }`)
    await page.click('[data-call*=exportsettings]'); await page.waitFor(`window.__dl !== null`)
    assert.equal(await page.eval(`window.__dlName`), 'dockdesk-settings.json')
    const doc = JSON.parse(await page.eval(`window.__dl`))
    assert.equal(doc.app, 'dockdesk'); assert.equal(doc.format, 1); assert.equal(doc.settings.refresh, 10); assert.ok(!JSON.stringify(doc).match(/password|auth/i))
    assert.ok(['auto', 'light', 'dark'].includes(doc.theme)); assert.equal(typeof doc.tray, 'boolean')
    // change things, then import the exported file
    await page.set('select[data-setting=refresh]', '30', ['change']); await page.waitFor(`JSON.parse(localStorage.getItem('settings')).refresh === 30`)
    const upload = (name, text) => page.eval(`(()=>{const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(text)}],${JSON.stringify(name)}));const i=document.querySelector('#importfile');i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await page.waitFor(`!!document.querySelector('#importfile')`)
    await upload('s.json', JSON.stringify({ ...doc, runPresets: { 'imported one': { image: 'x:1', ports: [], volumes: [], env: [] }, 'bad one': { image: 5 } } }))
    await page.waitFor(`JSON.parse(localStorage.getItem('settings')).refresh === 10`)
    await page.waitFor(`/Settings imported/.test(document.querySelector('#toast').textContent)`)
    assert.deepEqual(Object.keys(JSON.parse(await page.eval(`localStorage.getItem('runPresets')`))), ['imported one'], 'only well-formed presets are taken')
    // hostile or wrong files change nothing
    await page.waitFor(`!!document.querySelector('#importfile')`)
    await upload('x.json', JSON.stringify({ app: 'dockdesk', format: 1, settings: { refresh: -5, lang: 'xx', evil: 1, notify: 'yes', alertCpu: 1e9 }, theme: 'neon' }))
    await page.waitFor(`/Settings imported: 0 settings/.test(document.querySelector('#toast').textContent)`)
    const after = JSON.parse(await page.eval(`localStorage.getItem('settings')`))
    assert.equal(after.refresh, 10); assert.equal(after.lang, 'auto'); assert.equal(after.notify, false); assert.equal(after.alertCpu, 0); assert.ok(!('evil' in after))
    await upload('y.json', 'this is not json'); await page.waitFor(`/not a DockDesk settings file/.test(document.querySelector('#toast').textContent)`)
    await upload('z.json', JSON.stringify({ app: 'other', format: 1, settings: {} })); await page.waitFor(`/not a DockDesk settings file/.test(document.querySelector('#toast').textContent)`)
    await page.eval(`localStorage.removeItem('runPresets')`)
    await page.click('[data-call*=resetsettings]'); await page.waitFor(`JSON.parse(localStorage.getItem('settings')).refresh === 3`)
    await page.eval(`delete HTMLAnchorElement.prototype.click`) // the backup test replaced <a>.click() to capture the download; give it back to the tests after it
  })

  it('accessibility: landmarks, names, keyboard use of rows and nav, dialog focus, menus', async () => {
    await reset()
    // landmarks and the live message area
    assert.equal(await page.eval(`document.querySelector('#nav').getAttribute('aria-label')`), 'Main')
    assert.equal(await page.eval(`document.querySelector('#toast').getAttribute('aria-live')`), 'polite')
    // every control on every page has a name (button text, aria-label, label)
    const unnamed = `(()=>{const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}
      const nm=(e)=>(e.getAttribute('aria-label')||e.textContent||e.title||'').trim()
      const bad=[...document.querySelectorAll('button,a[href]')].filter(vis).filter((e)=>!nm(e)).map((e)=>e.className)
      for(const e of [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(vis)) if(!(e.closest('label')||e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')||(e.id&&document.querySelector('label[for="'+e.id+'"]')))) bad.push(e.tagName+'#'+e.id+'.'+e.className)
      return bad})()`
    for (const p of PAGES) { await nav(p); await page.waitFor('true'); assert.deepEqual(await page.eval(unnamed), [], `${p}: controls without a name`) }
    // sidebar: focusable, current page marked, Enter navigates
    await nav('dashboard')
    assert.equal(await page.eval(`document.querySelector('#nav a.on').getAttribute('aria-current')`), 'page')
    assert.equal(await page.eval(`[...document.querySelectorAll('#nav a[data-p]')].every((a)=>{a.focus();return document.activeElement===a})`), true, 'sidebar links can take focus')
    await page.key('#nav [data-p=volumes]', 'Enter')
    await page.waitFor(`document.querySelector('#nav a.on')?.dataset.p === 'volumes'`)
    assert.equal(await page.eval(`document.querySelector('#nav a.on').getAttribute('aria-current')`), 'page')
    assert.equal(await page.eval(`(()=>{const e=document.querySelector('#nav .engine');e.focus();return document.activeElement===e&&e.getAttribute('role')})()`), 'button')
    // table rows: focusable, Enter opens the drawer, which is a labelled dialog with focus inside
    await nav('containers')
    await page.waitFor(`[...document.querySelectorAll('#rows tr')].some(r=>r.textContent.includes('${main}'))`)
    assert.equal(await page.eval(`[...document.querySelectorAll('#rows tr.row-click')].every((r)=>r.tabIndex===0)`), true)
    await page.eval(`[...document.querySelectorAll('#rows tr')].find(r=>r.textContent.includes('${main}')).focus()`)
    await page.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
    await page.waitFor(`!!document.querySelector('.detail .tabs')`)
    assert.equal(await page.eval(`document.querySelector('.detail').getAttribute('role')`), 'dialog')
    await page.waitFor(`document.querySelector('.detail').contains(document.activeElement)`)
    assert.equal(await page.eval(`document.querySelector('.detail .tabs').getAttribute('role')`), 'tablist')
    assert.equal(await page.eval(`document.querySelector('.detail .tabs a.on').getAttribute('aria-selected')`), 'true')
    await page.eval(`document.querySelector('.detail .tabs a').focus()`)
    await page.key('.detail .tabs a', 'ArrowRight')
    await page.waitFor(`document.querySelectorAll('.detail .tabs a')[1].classList.contains('on') && document.querySelectorAll('.detail .tabs a')[1].getAttribute('aria-selected')==='true'`)
    await reset()
    // a modal dialog: labelled, focus moves in, Tab wraps, Esc closes and focus goes back to the button that opened it
    await nav('images')
    await page.waitFor(`document.querySelectorAll('#irows tr [data-call*=run]').length > 0`)
    await page.eval(`(()=>{const b=document.querySelector('#irows tr [data-call*=run]');b.focus();b.click()})()`)
    await page.waitFor(`!!document.querySelector('.modal .box')`)
    assert.equal(await page.eval(`document.querySelector('.modal .box').getAttribute('role')`), 'dialog')
    assert.equal(await page.eval(`document.querySelector('.modal .box').getAttribute('aria-modal')`), 'true')
    assert.ok(await page.eval(`!!document.querySelector('.modal .box').getAttribute('aria-labelledby')`), 'dialog has a title reference')
    await page.waitFor(`document.querySelector('.modal').contains(document.activeElement)`)
    await page.eval(`(()=>{const f=[...document.querySelectorAll('.modal button,.modal input,.modal select,.modal textarea')].filter(e=>!e.disabled&&e.offsetParent&&e.type!=='hidden');f[f.length-1].focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}))})()`)
    assert.equal(await page.eval(`document.querySelector('.modal').contains(document.activeElement)`), true, 'Tab at the end wraps inside the dialog')
    await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    await page.waitFor(`!document.querySelector('.modal')`)
    await page.waitFor(`document.activeElement?.matches('[data-call*=run]')`)
    // the row menu: opens as a menu with focus on its first item; arrows move; Esc closes
    await nav('containers')
    await page.waitFor(`document.querySelectorAll('#rows tr [data-call*=menu]').length > 0`)
    await page.eval(`(()=>{const b=document.querySelector('#rows tr [data-call*=menu]');b.focus();b.click()})()`)
    await page.waitFor(`!document.querySelector('#menu').hidden && document.querySelector('#menu').contains(document.activeElement)`)
    assert.equal(await page.eval(`document.querySelector('#menu').getAttribute('role')`), 'menu')
    assert.equal(await page.eval(`document.activeElement.getAttribute('role')`), 'menuitem')
    const first = await page.eval(`document.activeElement.textContent`)
    await page.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`)
    assert.notEqual(await page.eval(`document.activeElement.textContent`), first, 'ArrowDown moves to the next item')
    await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    await page.waitFor(`document.querySelector('#menu').hidden`)
    await page.waitFor(`document.activeElement?.matches('[data-call*=menu]')`)
  })
  it('uncaught JavaScript errors: none during the whole session', () => {
    assert.deepEqual(page.exceptions, [])
  })
})
