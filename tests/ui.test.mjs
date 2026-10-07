// Browser tests: drive the real UI in headless Chromium (no npm packages; needs Node 22+ and Chromium/Chrome).
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { startServer, janitor, docker, dockerTry, dockerAvailable, waitFor, PREFIX } from './helpers.mjs'
import { openPage, uiSkipReason, probeBrowser } from './cdp.mjs'

// A browser that can't start is an environment problem: locally, skip with the reason shown. In CI (CI=true) it must fail loudly instead.
const base = !dockerAvailable() ? 'Docker is not reachable' : uiSkipReason() || false
const probe = base || process.env.CI ? null : await probeBrowser()
const skip = base || probe || false

describe('DockDesk UI in a real browser', { skip }, () => {
  let J, srv, page, IMG, main, work
  const PAGES = ['dashboard', 'compose', 'containers', 'images', 'volumes', 'networks', 'labs', 'activity', 'settings']
  const HEADING = { dashboard: 'Overview', compose: 'Compose', containers: 'Containers', images: 'Images', volumes: 'Volumes', networks: 'Networks', labs: 'Labs', activity: 'Activity', settings: 'Settings' }
  // wait for the NEW page's own heading, so we never act on the previous page's leftovers
  const nav = async (name) => { await page.click(`#nav [data-p=${name}]`); await page.waitFor(`document.querySelector('#nav a.on')?.dataset.p === '${name}' && (document.querySelector('#page h2')?.textContent || '').startsWith('${HEADING[name]}')`) }
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
    srv = await startServer({ env: { XDG_DATA_HOME: join(work, 'xdg') } })
    main = `${PREFIX}-ui`
    const script = 'mkdir -p "/tmp/demo/sub folder"; printf "line one\\nline two\\n" > /tmp/demo/notes.txt; head -c 2000 /dev/urandom > /tmp/demo/blob.bin; i=0; while true; do i=$((i+1)); printf "\\033[32mINFO\\033[0m request $i ok\\n"; [ $((i%4)) -eq 0 ] && printf "\\033[31mERROR\\033[0m failed line $i\\n"; sleep 0.2; done'
    docker('run', '-d', '--name', main, '--stop-timeout', '1', '--entrypoint', 'sh', IMG, '-c', script)
    await waitFor(() => spawnSync('docker', ['exec', main, 'test', '-f', '/tmp/demo/notes.txt']).status === 0, { what: 'fixture files' })
    page = await openPage(srv.url)
    await page.eval('window.confirm = () => true') // dialogs from the app are auto-accepted
    await page.waitFor(`document.querySelector('#nav [data-p]') !== null`)
  })
  after(async () => { await page?.close(); srv?.stop(); J.cleanup() })

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

  it('uncaught JavaScript errors: none during the whole session', () => {
    assert.deepEqual(page.exceptions, [])
  })
})
