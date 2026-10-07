const TOKEN = new URLSearchParams(location.search).get('t') || sessionStorage.getItem('t') || ''
sessionStorage.setItem('t', TOKEN)
const START = location.hash.slice(1)
history.replaceState(null, '', location.pathname) // keep the token out of the URL bar

const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => el.querySelectorAll(s)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmt = (n) => {
  if (!n) return '0 B'
  const u = ['B', 'kB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1000)))
  return (n / 1000 ** i).toFixed(i ? 1 : 0) + ' ' + u[i]
}
const ago = (ts) => {
  const s = Date.now() / 1000 - ts
  for (const [n, l] of [[86400, 'd'], [3600, 'h'], [60, 'm']]) if (s >= n) return Math.floor(s / n) + l + ' ago'
  return 'just now'
}
const rel = (iso) => {
  const t = Date.parse(iso)
  if (!t || t < 946684800000) return 'Never' // Docker uses year 0001 for "never started"
  const s = (Date.now() - t) / 1000
  if (s < 60) return 'just now'
  for (const [n, u] of [[86400, 'day'], [3600, 'hour'], [60, 'minute']]) if (s >= n) { const k = Math.floor(s / n); return `${k} ${u}${k > 1 ? 's' : ''} ago` }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch {}
  try {
    const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'
    document.body.append(t); t.select()
    const ok = document.execCommand('copy'); t.remove(); return ok
  } catch { return false }
}

async function api(method, ...args) {
  const r = await fetch('/api/' + method, { method: 'POST', headers: { 'X-Token': TOKEN }, body: JSON.stringify(args) })
  const t = await r.text()
  let j = null
  try { j = t ? JSON.parse(t) : null } catch { j = t }
  if (!r.ok) throw new Error(j?.error || t || r.statusText)
  return j
}

let toastTimer
function toast(msg, err) {
  const t = $('#toast')
  t.textContent = msg
  t.className = err ? 'err' : ''
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (t.hidden = true), err ? 6000 : 2500)
}
async function act(label, fn, after) {
  try { await fn(); if (label) toast(label); await after?.() } catch (e) { toast(e.message, true) }
}

// Server-sent stream helper; returns a stop function.
function stream(kind, params, onMsg) {
  const q = new URLSearchParams({ ...params, t: TOKEN })
  const es = new EventSource(`/stream/${kind}?${q}`)
  es.onmessage = (e) => { const m = JSON.parse(e.data); if (m.k === 'end' || m.k === 'error') es.close(); onMsg(m) } // close first: EventSource would otherwise auto-reconnect and restart the stream
  es.onerror = () => es.close()
  return () => es.close()
}

// ---------- icons (Lucide-style, inline, no dependencies) ----------
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  network: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v4M12 11l-6 6M12 11l6 6"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  restart: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  logs: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>',
  ext: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  down: '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  broom: '<path d="M19.4 4.6l-7.8 7.8"/><path d="M11.6 12.4c-2.2-1-5 .4-5.7 2.9L5 19l3.7-.9c2.5-.7 3.9-3.5 2.9-5.7z"/>',
  more: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevdown: '<polyline points="6 9 12 15 18 9"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  flask: '<path d="M10 2v7.5L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9.5V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>',
  hammer: '<path d="M14 4l6 6-3 3-6-6z"/><path d="M11 8L3 16l2 2 8-8"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  arrowup: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
  chevup: '<polyline points="18 15 12 9 6 15"/>',
  chevright: '<polyline points="9 6 15 12 9 18"/>'
}
const ic = (n, s = 16) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`
// Icon-only button with a tooltip.
const ibtn = (icon, title, callJson, cls = '') =>
  `<button class="ib ${cls}" title="${esc(title)}" aria-label="${esc(title)}" data-call='${esc(callJson)}'>${ic(icon)}</button>`
// Text button with a leading icon.
const tbtn = (icon, label, callJson, cls = '') =>
  `<button class="tb ${cls}" data-call='${esc(callJson)}'>${ic(icon, 15)}<span>${label}</span></button>`
const call = (...a) => JSON.stringify(a)

// ---------- engine / resource state (feeds sidebar pill, footer, containers header) ----------
const SETTINGS_DEFAULTS = { refresh: 3, stats: true, notify: false }
const settings = (() => { try { return { ...SETTINGS_DEFAULTS, ...JSON.parse(localStorage.getItem('settings') || '{}') } } catch { return { ...SETTINGS_DEFAULTS } } })()
const saveSettings = () => { try { localStorage.setItem('settings', JSON.stringify(settings)) } catch {} }
const engine = { up: true, version: '', ncpu: 0, memTotal: 0, disk: 0 }
let stats = {} // container id -> { cpu, memUsed, ... }
const hist = { cpu: [], mem: [] } // last ~5 minutes of totals (one sample per 5 s), for the Overview sparklines

async function refreshInfo() {
  try {
    const [info, df] = await Promise.all([api('info'), api('df')])
    engine.version = info.ServerVersion; engine.ncpu = info.NCPU; engine.memTotal = info.MemTotal
    const sum = (a, f) => (a || []).reduce((x, y) => x + (f(y) || 0), 0)
    engine.disk = (df.LayersSize || 0) + sum(df.Volumes, (v) => (v.UsageData?.Size > 0 ? v.UsageData.Size : 0)) + sum(df.BuildCache, (c) => c.Size)
    renderStatus()
  } catch {}
}
async function refreshStats() {
  if (document.hidden || !engine.up || !settings.stats) return
  try {
    stats = await api('stats.all')
    const t = totals()
    hist.cpu.push(t.cpu); hist.mem.push(t.mem)
    if (hist.cpu.length > 60) { hist.cpu.shift(); hist.mem.shift() }
    applyStats()
  } catch {}
}
const totals = () => Object.values(stats).reduce((a, s) => ({ cpu: a.cpu + s.cpu, mem: a.mem + s.memUsed }), { cpu: 0, mem: 0 })

function applyStats() {
  const t = totals()
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v }
  set('#u-cpu', t.cpu.toFixed(2) + '%'); set('#u-mem', fmt(t.mem))
  document.querySelectorAll('[data-cpu]').forEach((td) => {
    const s = stats[td.dataset.cpu]
    td.textContent = s ? s.cpu.toFixed(2) + '%' : td.dataset.run === '1' ? '–' : '0%'
  })
  document.querySelectorAll('[data-pstat]').forEach((td) => {
    const ids = td.dataset.pstat.split(',').filter(Boolean).map((id) => stats[id]).filter(Boolean)
    td.textContent = ids.length ? `${ids.reduce((a, x) => a + x.cpu, 0).toFixed(2)}% · ${fmt(ids.reduce((a, x) => a + x.memUsed, 0))}` : '–'
  })
  const cpuEl = $('#cp-cpu')
  if (cpuEl) {
    const ids = [...new Set([...document.querySelectorAll('[data-pstat]')].flatMap((td) => td.dataset.pstat.split(',').filter(Boolean)))].map((id) => stats[id]).filter(Boolean)
    cpuEl.textContent = ids.length ? ids.reduce((a, x) => a + x.cpu, 0).toFixed(2) + '%' : '–'
    $('#cp-mem').textContent = ids.length ? fmt(ids.reduce((a, x) => a + x.memUsed, 0)) : '–'
  }
  const dl = $('#d-live'); if (dl) dl.innerHTML = liveHtml()
  const dt = $('#d-top'); if (dt) dt.innerHTML = topHtml()
  renderStatus()
}

// ---------- theme ----------
function theme() { return document.documentElement.dataset.theme }
// v: 'auto' (follow the system) | 'light' | 'dark'
function applyTheme(v) {
  try { v === 'auto' ? localStorage.removeItem('theme') : localStorage.setItem('theme', v) } catch {}
  document.documentElement.dataset.theme = v === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : v
  dock.tabs.forEach((t) => (t.term.options.theme = termTheme()))
  renderStatus()
}
const toggleTheme = () => applyTheme(theme() === 'light' ? 'dark' : 'light')
const termTheme = () => theme() === 'light'
  ? { background: '#ffffff', foreground: '#1b1f24', cursor: '#1b1f24', selectionBackground: '#b6d4fe' }
  : { background: '#0f1419' }

// ---------- shell: sidebar, footer, routing ----------
const PAGES = {
  dashboard: ['Overview', 'dashboard', dashboard],
  compose: ['Compose', 'layers', compose],
  containers: ['Containers', 'box', containers],
  images: ['Images', 'image', images],
  volumes: ['Volumes', 'database', volumes],
  networks: ['Networks', 'network', networks],
  labs: ['Labs', 'flask', labsPage],
  activity: ['Activity', 'activity', activityPage],
  settings: ['Settings', 'sliders', settingsPage]
}
const HOOKS = { containers: afterContainers, images: updateIBulk, volumes: updateGBulk, networks: updateGBulk, compose: applyStats }
let current = 'dashboard'
let timer, gen = 0, lastHtml = '', lastTickAt = 0

function nav() {
  $('#nav').innerHTML =
    '<h1><img src="icon.png" width="22" height="22" alt="">DockDesk</h1>' +
    `<button class="palbtn" data-call='["palette"]' title="Search everything (Ctrl K or /)">${ic('search', 15)}<span>Search…</span><kbd>Ctrl K</kbd></button>` +
    Object.entries(PAGES).map(([k, [l, i]]) => `<a data-p="${k}" class="${k === current ? 'on' : ''}">${ic(i, 18)}<span>${l}</span></a>`).join('') +
    `<div class="engine" data-call='["engine"]' title="${engine.up ? 'Click to stop the Docker engine' : 'Click to start the Docker engine'}"><span class="dot ${engine.up ? 'up' : 'down'}"></span>${engine.up ? 'Engine running' : 'Engine stopped'}</div>`
}
$('#nav').onclick = (e) => { const p = e.target.closest('[data-p]')?.dataset.p; if (p) go(p) }

function renderStatus() {
  const t = totals()
  const dockOpen = !$('#dock').hidden
  $('#status').innerHTML = `
    <span>RAM ${fmt(t.mem)}</span><span>CPU ${t.cpu.toFixed(2)}%</span><span>Disk ${fmt(engine.disk)} used</span>
    <span class="sp"></span>
    <button data-call='["dock"]' class="${dockOpen ? 'on' : ''}">${ic('terminal', 14)}Terminal</button>
    <button data-call='["theme"]' title="Switch theme">${ic(theme() === 'light' ? 'moon' : 'sun', 14)}</button>
    ${engine.version ? `<span>v${esc(engine.version)}</span>` : ''}`
}

const go_ = (p) => go(p) // alias usable where 'go' is shadowed
function go(p) {
  current = p
  lastHtml = ''
  nav()
  closeDetail()
  clearInterval(timer)
  const my = ++gen
  const render = PAGES[p][2]
  const tick = async () => {
    if (document.hidden && lastHtml) return // nothing to see, save CPU
    lastTickAt = Date.now()
    try {
      const html = await render()
      if (my !== gen || html == null || html === lastHtml) return
      lastHtml = html
      $('#page').innerHTML = html
      HOOKS[p]?.()
    } catch (e) { if (my === gen) $('#page').innerHTML = `<div class="empty">${esc(e.message)}</div>` }
  }
  tick()
  timer = setInterval(() => { if (eventsLive && Date.now() - lastTickAt < 20000) return; if (!$('.detail') && !document.activeElement?.matches('input[type=text]')) tick() }, settings.refresh * 1000)
  window.refresh = () => { lastHtml = ''; return tick() }
}

async function checkDaemon() {
  const b = $('#banner')
  const was = engine.up
  let html = ''
  try { await api('ping'); engine.up = true } catch {
    engine.up = false
    let d = {}
    try { d = await api('engine.diag') } catch {}
    const cmd = `sudo usermod -aG docker ${d.user || '$USER'}`
    if (d.exists && !d.access) {
      html = `<div>${ic('info', 18)}</div><div class="bn"><b>No permission to use Docker</b>
        <div>Your user can't open <span class="mono">${esc(d.socket)}</span>. ${d.inDockerGroup ? 'You are already in the <span class="mono">docker</span> group, so log out and back in (or run <span class="mono">newgrp docker</span>) to apply it.' : 'Add yourself to the <span class="mono">docker</span> group, then log out and back in:'}</div>
        ${d.inDockerGroup ? '' : `<div class="cmd"><span class="mono">${esc(cmd)}</span>${ibtn('copy', 'Copy command', call('copy', cmd))}</div>`}</div>`
    } else if (d.socket && !d.exists) {
      html = `<div>${ic('power', 18)}</div><div class="bn"><b>Docker isn't running</b>
        <div>No Docker socket at <span class="mono">${esc(d.socket)}</span>. Start the engine, or install it first with <span class="mono">sudo apt install docker.io</span>.</div></div>${tbtn('play', 'Start Docker', call('engine'), 'pri')}`
    } else html = `<div>${ic('power', 18)}</div><div class="bn"><b>Docker daemon is not reachable</b></div>${tbtn('play', 'Start Docker', call('engine'), 'pri')}`
  }
  b.hidden = engine.up
  if (!engine.up && b.innerHTML !== html) b.innerHTML = html
  if (was !== engine.up) { nav(); if (engine.up) { refreshInfo(); window.refresh?.() } }
}
setInterval(checkDaemon, 5000)
setInterval(refreshStats, 5000)
setInterval(refreshInfo, 30000)

// ---------- generic ----------
const table = (heads, rows, empty = 'Nothing here') =>
  rows.length
    ? `<table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
    : `<div class="empty">${ic('box', 32)}<div>${empty}</div></div>`
const header = (title, icon, count, extra = '') =>
  `<div class="head"><h2>${ic(icon, 22)}${title}${count != null ? `<span class="count">${count}</span>` : ''}</h2>${extra}</div>`

function hideMenu() { $('#menu').hidden = true }
document.addEventListener('click', async (e) => {
  if (!e.target.closest('#menu') && !e.target.closest('[data-call*=\'"menu"\']')) hideMenu()
  const b = e.target.closest('[data-call]')
  if (b) {
    e.stopPropagation()
    hideMenu()
    const [fn, ...args] = JSON.parse(b.dataset.call)
    switch (fn) {
      case 'open': return openDetail(args[0], args[1])
      case 'pull': return pullImage(args[0], !!args[0])
      case 'copyrule': {
        const rule = await api('engine.rule')
        const text = `sudo tee /etc/polkit-1/rules.d/50-dockdesk.rules >/dev/null <<'EOF'\n${rule}EOF`
        try { await navigator.clipboard.writeText(text) } catch { return toast('Could not copy. Run: sudo cp dockdesk-polkit.rules /etc/polkit-1/rules.d/50-dockdesk.rules', true) }
        return toast('Copied. Paste it into a terminal to install the rule.')
      }
      case 'resetsettings': Object.assign(settings, SETTINGS_DEFAULTS); saveSettings(); applyTheme('auto'); go(current); return toast('Settings reset')
      case 'tagimg': return tagImage(args[0])
      case 'pushimg': return pushImage(args[0])
      case 'reglogin': return registryLogin()
      case 'reglogout': return act('Signed out', () => api('registry.logout', args[0]), window.refresh)
      case 'build': return buildImage()
      case 'startlab': return startLab(args[0])
      case 'labrm': if (!confirm('Remove this lab container? Its data is lost.')) return; return act('Removed', () => api('container.remove', args[0], true), window.refresh)
      case 'run': return runImage(args[0])
      case 'newvol': return newVolume()
      case 'newnet': return newNetwork()
      case 'gmenu': return showGMenu(b, args[0], args[1])
      case 'inspectg': return openInspect(args[0], args[1], args[2])
      case 'gbulkdel': return bulkDeleteG()
      case 'gbulkclear': gsel[current].clear(); GPAGES[current].redraw(); return updateGBulk()
      case 'goto': return go(args[0])
      case 'actclear': activity.length = 0; return window.refresh?.()
      case 'cmenu': return showComposeMenu(b, args[0])
      case 'newproject': return composeEditor({})
      case 'editproject': return editProject(args[0])
      case 'palette': return openPalette()
      case 'cexpall': visibleProjects().forEach((p) => (args[0] ? cexp.add(p.name) : cexp.delete(p.name))); $('#cprows').innerHTML = composeRows(); return applyStats()
      case 'cexp': cexp.has(args[0]) ? cexp.delete(args[0]) : cexp.add(args[0]); return window.refresh?.()
      case 'imenu': return showImageMenu(b, args[0])
      case 'inspectimg': return openImageDetail(args[0], args[1])
      case 'exportimg': return exportImage(args[0])
      case 'importimg': return importImage()
      case 'ibulkdel': return bulkDeleteImages()
      case 'ibulkclear': isel.clear(); $('#irows').innerHTML = imageRows(); return updateIBulk()
      case 'menu': return showMenu(b, args[0])
      case 'term': return openTerm('exec', args[0], args[1])
      case 'dock': return toggleDock()
      case 'theme': return toggleTheme()
      case 'copy': return (await copyText(args[0])) ? toast('Copied') : toast('Could not copy', true)
      case 'bulk': return bulk(args[0])
      case 'bulkclear': sel.clear(); $('#rows').innerHTML = containerRows(); return afterContainers()
      case 'engine':
        if (engine.up) { if (!confirm('Stop the Docker daemon? All containers will stop. You may be asked for your password.')) return; return act('Stopping Docker…', () => api('daemon.stop'), checkDaemon) }
        return act('Starting Docker…', () => api('daemon.start'), checkDaemon)
      case 'confirm':
        if (!confirm(args[0])) return
        return act('Done', () => api(...args.slice(1)), window.refresh)
    }
    b.classList.add('busy')
    await act(fn === 'open.url' ? '' : 'Done', () => api(fn, ...args), () => { window.refresh?.(); refreshStats() })
    b.classList.remove('busy')
    return
  }
  const cp = e.target.closest('tr[data-cp]')
  if (cp && !e.target.closest('a,input,button,label')) { const n = cp.dataset.cp; cexp.has(n) ? cexp.delete(n) : cexp.add(n); return window.refresh?.() }
  const row = e.target.closest('tr[data-open]')
  if (row && !e.target.closest('a,input,button,label')) openDetail(row.dataset.open)
})
// ---------- Labs: one-click practice targets and a Kali toolbox ----------
// Everything here is intentionally vulnerable, so ports are published on this computer only (127.0.0.1).
const LABS = [
  { id: 'juice-shop', name: 'OWASP Juice Shop', image: 'bkimminich/juice-shop', ports: [[3000, 3000]], open: '/', desc: 'Modern vulnerable web app covering the OWASP Top 10. Has a built-in score board.' },
  { id: 'dvwa', name: 'DVWA', image: 'vulnerables/web-dvwa', ports: [[8081, 80]], open: '/', desc: 'Damn Vulnerable Web Application. Log in with admin / password, then press “Create / Reset Database”.' },
  { id: 'webgoat', name: 'WebGoat', image: 'webgoat/webgoat', ports: [[8082, 8080], [9090, 9090]], open: '/WebGoat', desc: 'Guided lessons for common web vulnerabilities. Register a new user on first visit.' },
  { id: 'bwapp', name: 'bWAPP', image: 'raesene/bwapp', ports: [[8083, 80]], open: '/install.php', desc: 'Buggy web app with 100+ bugs. Visit /install.php first, then log in as bee / bug.' },
  { id: 'mutillidae', name: 'Mutillidae II', image: 'citizenstig/nowasp', ports: [[8084, 80]], open: '/', desc: 'Deliberately vulnerable app with hints. Press “Reset DB” on first visit.' },
  { id: 'kali', name: 'Kali toolbox', image: 'kalilinux/kali-rolling', ports: [], caps: ['NET_ADMIN', 'NET_RAW'], interactive: true, desc: 'Official Kali image kept running with a terminal. Open its terminal from the ⋮ menu, then run apt update && apt install kali-tools-top10.' }
]
const labOf = (cs, id) => cs.find((c) => c.Labels?.['dockdesk.lab'] === id)

async function labsPage() {
  const [cs, imgs] = await Promise.all([api('containers.list'), api('images.list')])
  const have = (img) => imgs.some((i) => (i.RepoTags || []).some((t) => t === img || t === img + ':latest'))
  cList = cs
  return `<div class="head"><h2>${ic('flask', 22)}Labs</h2></div>
    <div class="note">${ic('info', 16)}<div><b>These apps are intentionally vulnerable.</b> DockDesk publishes their ports on <span class="mono">127.0.0.1</span> only, so nothing is reachable from your network. Never run them on an exposed interface.</div></div>
    <div class="labgrid">${LABS.map((l) => {
      const c = labOf(cs, l.id), up = c?.State === 'running', port = c && pubPorts(c)[0]
      const acts = !c ? tbtn('play', have(l.image) ? 'Start lab' : 'Pull and start', call('startlab', l.id), 'pri')
        : up ? `${port && l.open ? tbtn('ext', 'Open', call('open.url', `http://localhost:${port.PublicPort}${l.open}`), 'pri') : tbtn('terminal', 'Terminal', call('term', c.Id, cname(c)), 'pri')}${ibtn('stop', 'Stop', call('container.action', c.Id, 'stop'), 'stop')}${ibtn('more', 'More actions', call('menu', c.Id))}${ibtn('trash', 'Remove', call('labrm', c.Id), 'dan')}`
          : `${ibtn('play', 'Start', call('container.action', c.Id, 'start'), 'ok')}${ibtn('trash', 'Remove', call('labrm', c.Id), 'dan')}`
      return `<div class="card lab"><div class="k">${c ? `<span class="dot ${c.State}"></span>` : ''}${esc(l.name)}${have(l.image) ? '<span class="pill">image ready</span>' : ''}</div>
        <div class="s lab-desc">${esc(l.desc)}</div><div class="mono meta">${esc(l.image)}${l.ports.length ? ' · ' + l.ports.map(([h, p]) => `127.0.0.1:${h}→${p}`).join(', ') : ''}</div>
        <div class="actions" style="justify-content:flex-start;margin-top:10px">${acts}</div></div>`
    }).join('')}</div>`
}

// Pull the image if needed, then create + start the lab container.
async function startLab(id) {
  const lab = LABS.find((l) => l.id === id)
  closeModal()
  const m = document.createElement('div')
  m.className = 'modal'
  m.innerHTML = `<div class="box"><h3>${ic('flask', 18)}${esc(lab.name)}</h3><div id="lstat" class="meta">Checking image…</div><div class="bar"><i id="lbar" style="width:0%"></i></div><div id="lerr"></div>
    <div class="row"><button type="button" class="tb" id="lclose">Close</button></div></div>`
  document.body.append(m)
  const stat = $('#lstat', m), bar = $('#lbar', m)
  let stopPullLab = null
  $('#lclose', m).onclick = () => { stopPullLab?.(); closeModal() }
  try {
    const imgs = await api('images.list')
    const have = imgs.some((i) => (i.RepoTags || []).some((t) => t === lab.image || t === lab.image + ':latest'))
    if (!have) {
      const layers = new Map()
      await new Promise((resolve, reject) => {
        stat.textContent = 'Contacting Docker Hub… (the first response can take a few seconds)'
        stopPullLab = stream('pull', { image: lab.image }, (ev) => {
          if (ev.k === 'error') return reject(new Error(ev.d))
          if (ev.k === 'end') return resolve()
          const d = ev.d
          if (!/^[0-9a-f]{12}$/.test(d.id || '')) return
          if (d.progressDetail?.total) layers.set(d.id, [d.progressDetail.current, d.progressDetail.total])
          const cur = [...layers.values()].reduce((a, v) => a + v[0], 0), tot = [...layers.values()].reduce((a, v) => a + v[1], 0)
          if (tot) { bar.style.width = Math.min(100, (cur / tot) * 100) + '%'; stat.textContent = `Downloading ${fmt(cur)} of ${fmt(tot)}` }
        })
      })
      stopPullLab = null
    }
    bar.style.width = '100%'; stat.textContent = 'Starting container…'
    const spec = { image: lab.image, name: 'dd-lab-' + lab.id, lab: lab.id, bindIp: '127.0.0.1', caps: lab.caps || [], interactive: !!lab.interactive, ports: lab.ports.map(([host, container]) => ({ host: String(host), container: String(container) })) }
    let note = ''
    try { await api('container.run', spec) } catch (e) {
      if (!/already allocated|address already in use/i.test(e.message)) throw e
      spec.ports = spec.ports.map((p) => ({ ...p, host: '' })) // preferred port is taken: let Docker pick a free one
      await api('container.run', spec); note = ' (the usual port was busy, so a free one was chosen)'
    }
    toast(`${lab.name} is running${note}`); closeModal(); window.refresh?.()
  } catch (e) { $('#lerr', m).innerHTML = `<div class="err">${esc(e.message)}</div>` }
}

// ---------- Live events: Docker tells us when something changes ----------
const activity = [] // newest first, in memory only
let eventsLive = false, evRefresh
let lastEventAt = Math.floor(Date.now() / 1000) - 10 // replay a few seconds on first connect, and from the last event seen after a reconnect
function startEvents() {
  const es = new EventSource(`/stream/events?since=${Math.max(0, lastEventAt - 1)}&t=${encodeURIComponent(TOKEN)}`)
  let closed = false
  const lost = () => { if (closed) return; closed = true; eventsLive = false; es.close(); setTimeout(startEvents, 3000) } // docker restarted or network blip: reconnect
  es.onopen = () => (eventsLive = true)
  es.onmessage = (m) => { const ev = JSON.parse(m.data); ev.k === 'data' ? onDockerEvent(ev.d) : lost() }
  es.onerror = lost
}
function onDockerEvent(e) {
  lastEventAt = Math.max(lastEventAt, e.t || 0)
  if (!mergeActivity([e])) return // a replayed event we already have: no refresh, no second notification
  clearTimeout(evRefresh)
  evRefresh = setTimeout(() => {
    if (!document.hidden && !$('.detail')) window.refresh?.()
    if (/^(start|die|stop|pause|unpause|oom)$/.test(e.action)) refreshStats()
  }, 400)
  const crashed = e.type === 'container' && (e.action === 'oom' || (e.action === 'die' && !['0', '137', '143'].includes(String(e.exit)))) // 137/143 = normal docker stop
  if (crashed && settings.notify && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(e.action === 'oom' ? 'Container ran out of memory' : 'Container crashed', { body: `${e.name}${e.action === 'die' ? ` exited with code ${e.exit}` : ''}` })
  }
}
const ACT_ICON = { container: 'box', image: 'image', volume: 'database', network: 'network' }
const actFilter = { q: '', type: 'all', problems: false }
let actCtx = { cids: new Set(), imgIds: new Set(), imgByName: new Map() }
const actKey = (e) => `${e.t}|${e.type}|${e.action}|${e.id}`
// Merge events (live or from the daemon's history) newest-first without duplicates.
function mergeActivity(list) {
  const seen = new Set(activity.map(actKey))
  let added = 0
  for (const e of list) if (!seen.has(actKey(e))) { activity.push(e); seen.add(actKey(e)); added++ }
  activity.sort((a, b) => b.t - a.t)
  if (activity.length > 400) activity.length = 400
  return added
}
async function loadHistory() { try { mergeActivity(await api('events.history', Math.floor(Date.now() / 1000) - 6 * 3600)) } catch {} }
const isProblem = (e) => e.action === 'oom' || (e.action === 'die' && !['0', '137', '143'].includes(String(e.exit))) || (e.action === 'health_status' && /unhealthy/.test(e.detail || ''))

function activityRows() {
  const q = actFilter.q.trim().toLowerCase()
  const list = activity.filter((e) => (actFilter.type === 'all' || e.type === actFilter.type) && (!actFilter.problems || isProblem(e)) &&
    (!q || `${e.name} ${e.action} ${e.type} ${e.image || ''} ${e.detail || ''}`.toLowerCase().includes(q))).slice(0, 300)
  if (!list.length) return `<tr><td colspan="4"><div class="empty">${activity.length ? 'No events match these filters' : 'No events yet'}</div></td></tr>`
  const good = /^(start|create|pull|tag|unpause|restart)$/, bad = /^(die|oom|kill|destroy|delete|untag|stop|pause)$/
  const today = new Date().toDateString(), yest = new Date(Date.now() - 864e5).toDateString()
  let day = '', out = ''
  for (const e of list) {
    const d = new Date(e.t * 1000), ds = d.toDateString()
    if (ds !== day) { day = ds; out += `<tr class="daysep"><td colspan="4">${ds === today ? 'Today' : ds === yest ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</td></tr>` }
    // Link to the thing if it still exists: containers and images are checked; volumes/networks only once destroyed.
    let attr = ''
    if (e.type === 'container' && actCtx.cids.has(e.id)) attr = `data-open="${esc(e.id)}"`
    else if (e.type === 'image') { const iid = actCtx.imgIds.has(e.id) ? e.id : actCtx.imgByName.get(e.id) || actCtx.imgByName.get(e.name); if (iid) attr = `data-inspect="image:${esc(iid)}:${esc(e.name)}"` }
    else if ((e.type === 'volume' || e.type === 'network') && !/^(destroy|remove)$/.test(e.action)) attr = `data-inspect="${e.type}:${esc(e.id)}:${esc(e.name)}"`
    const prob = isProblem(e)
    out += `<tr class="${attr ? 'row-click' : ''} ${prob ? 'prob' : ''}" ${attr}><td class="nw mono" title="${esc(d.toLocaleString())}">${d.toLocaleTimeString()}</td><td class="nw">${ic(ACT_ICON[e.type] || 'info', 15)} ${esc(e.type)}</td>
      <td><span class="pill ${prob ? 'bad' : good.test(e.action) ? 'running' : bad.test(e.action) ? 'warn' : ''}">${esc(e.action)}</span></td>
      <td>${esc(e.name)}${e.action === 'die' && e.exit !== undefined ? ` <span class="meta">exit code ${esc(e.exit)}</span>` : ''}${e.detail ? ` <span class="meta">${esc(e.detail)}</span>` : ''}</td></tr>`
  }
  return out
}

async function activityPage() {
  const [cs, imgs] = await Promise.all([api('containers.list').catch(() => []), api('images.list').catch(() => [])])
  const imgByName = new Map()
  imgs.forEach((i) => (i.RepoTags || []).forEach((t) => imgByName.set(t, i.Id)))
  actCtx = { cids: new Set(cs.map((c) => c.Id)), imgIds: new Set(imgs.map((i) => i.Id)), imgByName }
  const problems = activity.filter(isProblem).length
  return `<div class="head"><h2>${ic('activity', 22)}Activity<span class="count">${activity.length}</span></h2>
    <div class="usage"><div><div class="k">Problems</div><div class="v"><b style="color:${problems ? 'var(--bad)' : 'var(--ok)'}">${problems}</b></div><div class="s">crashes and failed health checks</div></div></div></div>
    <div class="tools">
      <label class="search">${ic('search', 15)}<input type="text" id="aq" placeholder="Search events…" value="${esc(actFilter.q)}"></label>
      <select id="atype">${[['all', 'All types'], ['container', 'Containers'], ['image', 'Images'], ['volume', 'Volumes'], ['network', 'Networks']].map(([v, l]) => `<option value="${v}" ${actFilter.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="switch"><input type="checkbox" id="aprob" ${actFilter.problems ? 'checked' : ''}>Problems only</label>
      <span class="sp"></span><span class="meta">${eventsLive ? '● live' : 'reconnecting…'} · last 6 hours</span>${tbtn('x', 'Clear', call('actclear'))}
    </div>
    <table><thead><tr><th>Time</th><th>Type</th><th>Event</th><th>Name</th></tr></thead><tbody id="arows">${activityRows()}</tbody></table>`
}
document.addEventListener('input', (e) => { if (e.target.id === 'aq') { actFilter.q = e.target.value; $('#arows').innerHTML = activityRows() } })
document.addEventListener('change', (e) => {
  if (e.target.id === 'atype') { actFilter.type = e.target.value; $('#arows').innerHTML = activityRows() }
  else if (e.target.id === 'aprob') { actFilter.problems = e.target.checked; $('#arows').innerHTML = activityRows() }
})

// ---------- Command palette (Ctrl+K or /) ----------
let pal = null
function fuzzy(query, text) {
  // every space-separated word must match as a subsequence; consecutive and word-start matches score higher
  let total = 0
  const hay = text.toLowerCase()
  for (const w of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const idx = hay.indexOf(w)
    if (idx >= 0) { total += 100 - Math.min(idx, 60) + (idx === 0 || /[\s\-_/:.]/.test(hay[idx - 1]) ? 30 : 0); continue }
    let h = 0, score = 0, prev = -2
    for (const ch of w) { const f = hay.indexOf(ch, h); if (f < 0) return -1; score += f === prev + 1 ? 6 : 1; prev = f; h = f + 1 }
    total += score
  }
  return total
}
async function openPalette() {
  if (pal) return closePalette()
  closeModal(); hideMenu()
  const el = document.createElement('div')
  el.className = 'pal'
  el.innerHTML = `<div class="palbox"><div class="palin">${ic('search', 17)}<input id="palq" placeholder="Search containers, images, pages and actions…" autocomplete="off" spellcheck="false"><span class="kbd">Esc</span></div>
    <div class="palres" id="palres"></div><div class="palfoot meta">↑ ↓ to move · Enter to run · Ctrl K to close</div></div>`
  document.body.append(el)
  pal = el
  const input = $('#palq', el), resEl = $('#palres', el)
  const run = (fn) => () => { closePalette(); fn() }
  const pages = Object.entries(PAGES).map(([k, [l, i]]) => ({ g: 'Pages', icon: i, title: 'Go to ' + l, sub: '', run: run(() => go(k)) }))
  const actions = [
    ['download', 'Pull an image', () => pullImage()], ['hammer', 'Build an image from a Dockerfile', () => buildImage()], ['upload', 'Import an image from a .tar', () => importImage()],
    ['plus', 'New compose project', () => composeEditor({})], ['plus', 'New volume', () => newVolume()], ['plus', 'New network', () => newNetwork()],
    ['terminal', 'Open a host terminal', () => openTerm('shell')], [theme() === 'light' ? 'moon' : 'sun', 'Switch theme', () => toggleTheme()],
    ['power', engine.up ? 'Stop the Docker engine' : 'Start the Docker engine', () => document.querySelector('.engine')?.click()]
  ].map(([icon, title, fn]) => ({ g: 'Actions', icon, title, sub: '', run: run(fn) }))
  const labs = LABS.map((l) => ({ g: 'Labs', icon: 'flask', title: 'Start lab: ' + l.name, sub: l.image, run: run(() => startLab(l.id)) }))
  let dyn = []
  let sel = 0, shown = []
  const build = () => {
    const qv = input.value.trim()
    const all = [...pages, ...actions, ...dyn, ...labs]
    shown = qv ? all.map((it) => ({ it, sc: fuzzy(qv, `${it.title} ${it.sub} ${it.g}`) })).filter((x) => x.sc >= 0).sort((a, b) => b.sc - a.sc).slice(0, 40).map((x) => x.it)
      : [...pages.slice(0, 6), ...actions.slice(0, 5), ...dyn.filter((x) => x.g === 'Containers').slice(0, 8)]
    sel = Math.min(sel, Math.max(0, shown.length - 1))
    let last = ''
    resEl.innerHTML = shown.length ? shown.map((it, i) => `${it.g !== last && (last = it.g) ? `<div class="palgrp">${esc(it.g)}</div>` : ''}<div class="palrow ${i === sel ? 'on' : ''}" data-i="${i}">${ic(it.icon, 16)}<div class="paltext"><div class="paltitle">${esc(it.title)}</div>${it.sub ? `<div class="palsub meta">${esc(it.sub)}</div>` : ''}</div>${i === sel ? '<span class="kbd">↵</span>' : ''}</div>`).join('') : `<div class="empty small">Nothing matches “${esc(qv)}”</div>`
    resEl.querySelector('.palrow.on')?.scrollIntoView({ block: 'nearest' })
  }
  input.addEventListener('input', () => { sel = 0; build() })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); build() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); build() }
    else if (e.key === 'Enter') { e.preventDefault(); shown[sel]?.run() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette() }
  })
  resEl.addEventListener('click', (e) => { const r = e.target.closest('.palrow'); if (r) shown[+r.dataset.i]?.run() })
  resEl.addEventListener('mousemove', (e) => { const r = e.target.closest('.palrow'); if (r && +r.dataset.i !== sel) { sel = +r.dataset.i; resEl.querySelectorAll('.palrow').forEach((x, i) => { x.classList.toggle('on', i === sel); x.querySelector('.kbd')?.remove() }); r.insertAdjacentHTML('beforeend', '<span class="kbd">↵</span>') } })
  el.addEventListener('mousedown', (e) => { if (e.target === el) closePalette() })
  build(); input.focus()
  // live objects arrive a moment later; the list is rebuilt when they do
  try {
    const [cs, imgs, vols] = await Promise.all([api('containers.list'), api('images.list'), api('volumes.list').catch(() => [])])
    if (pal !== el) return
    const projects = {}
    for (const c of cs) { const pn = c.Labels?.['com.docker.compose.project']; if (pn) (projects[pn] ||= []).push(c) }
    dyn = [
      ...cs.flatMap((c) => {
        const n = cname(c), up = c.State === 'running'
        return [
          { g: 'Containers', icon: 'box', title: n, sub: `${c.Image} · ${c.State}`, run: run(() => openDetail(c.Id, 'Overview')) },
          { g: 'Containers', icon: 'logs', title: 'Logs of ' + n, sub: 'container', run: run(() => openDetail(c.Id, 'Logs')) },
          { g: 'Containers', icon: 'folder', title: 'Files in ' + n, sub: 'container', run: run(() => openDetail(c.Id, 'Files')) },
          ...(up ? [{ g: 'Containers', icon: 'terminal', title: 'Terminal in ' + n, sub: 'container', run: run(() => openTerm('exec', c.Id, n)) },
            { g: 'Containers', icon: 'stop', title: 'Stop ' + n, sub: 'container', run: run(() => act('Stopping ' + n + '…', () => api('container.action', c.Id, 'stop'), window.refresh)) },
            { g: 'Containers', icon: 'restart', title: 'Restart ' + n, sub: 'container', run: run(() => act('Restarted ' + n, () => api('container.action', c.Id, 'restart'), window.refresh)) }]
            : [{ g: 'Containers', icon: 'play', title: 'Start ' + n, sub: 'container', run: run(() => act('Started ' + n, () => api('container.action', c.Id, 'start'), window.refresh)) }])
        ]
      }),
      ...Object.keys(projects).map((n) => ({ g: 'Compose', icon: 'layers', title: n, sub: 'compose project', run: run(() => { cexp.add(n); go('compose') }) })),
      ...imgs.flatMap((i) => (i.RepoTags?.length ? i.RepoTags : []).flatMap((t) => [
        { g: 'Images', icon: 'image', title: t, sub: 'image · ' + fmt(i.Size), run: run(() => openImageDetail(i.Id, t)) },
        { g: 'Images', icon: 'play', title: 'Run ' + t, sub: 'image', run: run(() => runImage(t)) }])),
      ...vols.map((v) => ({ g: 'Volumes', icon: 'database', title: volName(v.Name), sub: 'volume', run: run(() => openInspect('volume', v.Name, v.Name)) })),
      ...nList.map((n2) => ({ g: 'Networks', icon: 'network', title: n2.Name, sub: 'network', run: run(() => openInspect('network', n2.Id, n2.Name)) }))
    ]
    build()
  } catch {}
}
function closePalette() { pal?.remove(); pal = null }
document.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input,textarea,select,[contenteditable]') && e.target.id !== 'palq'
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette() }
  else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !pal) { e.preventDefault(); openPalette() }
  else if (e.key === 'Escape' && pal) closePalette()
})

// ---------- Settings ----------
async function settingsPage() {
  const [d, info, grp, reg] = await Promise.all([api('engine.diag'), api('info'), api('group.list'), api('registry.status')])
  let themeSel = 'auto'; try { themeSel = localStorage.getItem('theme') || 'auto' } catch {}
  const row = (title, desc, control) => `<div class="srow"><div><div class="nm">${title}</div><div class="meta">${desc}</div></div><div class="sctl">${control}</div></div>`
  const sel = (key, opts, cur) => `<select data-setting="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`
  const val = (v) => `<span class="mono">${esc(v)}</span>`
  return `<div class="head"><h2>${ic('sliders', 22)}Settings</h2></div>
    <div class="section">General</div><div class="panel">
      ${row('Theme', 'Follow the system, or force light or dark.', sel('theme', [['auto', 'System'], ['light', 'Light'], ['dark', 'Dark']], themeSel))}
      ${row('Refresh interval', 'How often the lists update while a page is open.', sel('refresh', [[2, '2 seconds'], [3, '3 seconds'], [5, '5 seconds'], [10, '10 seconds'], [30, '30 seconds']], settings.refresh))}
      ${row('Crash notifications', 'Show a desktop notification when a container exits with an error or runs out of memory.', `<label class="switch"><input type="checkbox" data-setting="notify" ${settings.notify ? 'checked' : ''}></label>`)}
      ${row('Live CPU and memory', 'Samples running containers every 5 seconds. Turn it off to use fewer resources.', `<label class="switch"><input type="checkbox" data-setting="stats" ${settings.stats ? 'checked' : ''}></label>`)}
    </div>
    <div class="section">Engine</div><div class="panel">
      ${row('Docker Engine', esc(info.OperatingSystem), val('v' + info.ServerVersion))}
      ${row('Storage driver', 'Docker root: ' + esc(info.DockerRootDir), val(info.Driver))}
      ${row('Socket', 'The Unix socket DockDesk talks to.', val(d.socket))}
      ${row('Docker Compose', d.compose ? 'Needed for the Compose page and editor.' : 'Not found. The Compose page and editor need it: install “docker-compose-v2” (Ubuntu), “docker-compose” (Debian 13, Kali) or “docker-compose-plugin” (Docker’s repository).', d.compose ? val('v' + d.compose) : '<span class="pill warn">Not installed</span>')}
      ${row('Docker Buildx', 'Optional. Used by image builds when present.', d.buildx ? val(d.buildx.split(' ').find((x) => /^v?\d/.test(x)) || 'installed') : '<span class="pill">Not installed</span>')}
      ${row('Access', 'Your user is ' + esc(d.user) + '.', d.access ? '<span class="pill running">OK</span>' : '<span class="pill warn">No permission</span>')}
      ${row('Start / stop without a password', 'Starting or stopping the engine asks for your password by default. Install this one-time rule to let docker-group members skip it (scoped to docker.service). Undo: sudo rm /etc/polkit-1/rules.d/50-dockdesk.rules', tbtn('copy', 'Copy setup command', call('copyrule')))}
      ${row('Docker group', 'Members can use Docker without sudo.', d.inDockerGroup ? '<span class="pill running">Member</span>' : '<span class="pill warn">Not a member</span>')}
    </div>
    <div class="section">Registries</div><div class="panel">
      ${reg.registries.length ? reg.registries.map((r) => row(esc(r), 'Signed in', tbtn('x', 'Sign out', call('reglogout', r)))).join('') : row('Not signed in to any registry', 'Sign in to push images to Docker Hub, GHCR or a private registry.', '')}
      ${row('Sign in', reg.store ? `Credentials are kept by Docker's credential helper (${esc(reg.store)}).` : 'Docker stores credentials in ~/.docker/config.json (readable only by you, but not encrypted). Install a Docker credential helper for stronger protection.', tbtn('plus', 'Sign in…', call('reglogin')))}
    </div>
    <div class="section">Docker access</div>
    <div class="note">${ic('info', 16)}<div><b>Docker group members have root-equivalent access to this machine.</b> They can start containers that mount the whole filesystem. Only add people you would give a root shell. Each change asks for an administrator password, and it takes effect the next time that user logs in.</div></div>
    <div class="panel">${grp.exists ? grp.users.map((u) => row(`${esc(u.name)}${u.you ? ' <span class="pill">you</span>' : ''}`, `uid ${u.uid}${u.primary ? ' · docker is this user\'s primary group' : ''}${u.you && u.member !== u.sessionHas ? `<br><span class="pending">${u.member ? 'Added, but your current login session does not have it yet. Log out and back in, or run newgrp docker in a terminal.' : 'Removed, but your current session still has it until you log out and back in.'}</span>` : ''}`,
      `<label class="switch"><input type="checkbox" data-groupuser="${esc(u.name)}" data-you="${u.you ? 1 : 0}" ${u.member ? 'checked' : ''} ${u.primary ? 'disabled' : ''}></label>`)).join('') || row('No regular users found', '', '')
      : row('The docker group does not exist', 'Install Docker first (sudo apt install docker.io).', '')}</div>
    <div class="tools" style="margin-top:16px">${tbtn('restart', 'Reset settings', call('resetsettings'))}</div>`
}
document.addEventListener('change', async (e) => {
  const gu = e.target.dataset?.groupuser
  if (gu) {
    const on = e.target.checked, you = e.target.dataset.you === '1'
    const ask = on
      ? `Add “${gu}” to the docker group?\n\nMembers can start containers as root and take full control of this machine. You will be asked for an administrator password.`
      : `Remove “${gu}” from the docker group?${you ? '\n\nThis is YOUR account: you will lose access to Docker the next time you log in.' : ''}\n\nYou will be asked for an administrator password.`
    if (!confirm(ask)) { e.target.checked = !on; return }
    e.target.disabled = true
    try { await api('group.set', gu, on); toast(`${gu} ${on ? 'added to' : 'removed from'} the docker group. It applies at their next login.`) } catch (err) { toast(err.message, true) }
    window.refresh?.()
    return
  }
  const k = e.target.dataset?.setting; if (!k) return
  if (k === 'theme') applyTheme(e.target.value)
  else if (k === 'refresh') { settings.refresh = Number(e.target.value); saveSettings(); go(current); toast('Saved') }
  else if (k === 'notify') {
    if (e.target.checked) {
      const ok = 'Notification' in window && (Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted')
      if (!ok) { e.target.checked = false; return toast('Notifications are blocked. Allow them for this app in your browser settings.', true) }
    }
    settings.notify = e.target.checked; saveSettings(); toast('Saved')
  }
  else if (k === 'stats') { settings.stats = e.target.checked; saveSettings(); if (!settings.stats) { stats = {}; applyStats() } else refreshStats(); toast('Saved') }
})

// ---------- Overview ----------
let dashCs = [] // containers as of the last Overview refresh

// Tiny inline sparkline: a filled line of the last 60 samples, right-aligned.
function spark(vals, peak, w = 240, h = 44) {
  const base = `<line x1="0" y1="${h - 2}" x2="${w}" y2="${h - 2}" stroke="currentColor" stroke-width="1" stroke-dasharray="3 4" opacity=".35" vector-effect="non-scaling-stroke"/>`
  if (vals.length < 6) return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${base}</svg>` // too few samples to draw a meaningful line yet
  const step = w / 59, m = Math.max(peak, 1e-9)
  const pts = vals.map((v, i) => `${(w - (vals.length - 1 - i) * step).toFixed(1)},${(h - 3 - (Math.min(v, m) / m) * (h - 6)).toFixed(1)}`)
  const x0 = pts[0].split(',')[0]
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${base}<polygon points="${pts.join(' ')} ${w},${h} ${x0},${h}" fill="currentColor" opacity=".12"/><polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`
}

function liveHtml() {
  const t = totals(), cores = engine.ncpu || 1
  const cpuPct = Math.min(100, t.cpu / cores), memPct = engine.memTotal ? Math.min(100, (t.mem / engine.memTotal) * 100) : 0
  if (!settings.stats) return `<div class="meta">Live CPU and memory is turned off. Turn it on in Settings.</div>`
  const peak = (a) => (a.length ? Math.max(...a) : 0)
  return `<div class="meter"><div class="mhead"><span>CPU</span><b>${t.cpu.toFixed(2)}%</b><span class="meta">of ${cores} CPUs · ${cpuPct.toFixed(1)}% of capacity</span></div>
      <div class="bar"><i style="width:${Math.max(cpuPct, t.cpu > 0 ? 1 : 0)}%"></i></div><div class="sparkwrap">${spark(hist.cpu, Math.max(peak(hist.cpu), 5))}</div></div>
    <div class="meter"><div class="mhead"><span>Memory</span><b>${fmt(t.mem)}</b><span class="meta">of ${fmt(engine.memTotal)} · ${memPct.toFixed(1)}%</span></div>
      <div class="bar"><i style="width:${Math.max(memPct, t.mem > 0 ? 1 : 0)}%"></i></div><div class="sparkwrap">${spark(hist.mem, Math.max(peak(hist.mem), engine.memTotal * 0.02))}</div></div>
    <div class="meta">${hist.cpu.length < 6 ? 'Collecting samples…' : `Last ${Math.max(1, Math.round(hist.cpu.length * 5 / 60))} min`} · sampled every 5 s · running containers only</div>`
}

function topHtml() {
  const run = dashCs.filter((c) => c.State === 'running').map((c) => ({ c, s: stats[c.Id] })).sort((a, b) => (b.s?.cpu || 0) - (a.s?.cpu || 0) || (b.s?.memUsed || 0) - (a.s?.memUsed || 0)).slice(0, 6)
  if (!run.length) return `<div class="empty small">${ic('box', 26)}<div>No containers running.<br><span class="meta">Start one from Containers, or try a lab.</span></div></div>`
  return `<table class="mini"><tbody>${run.map(({ c, s: st }) => `<tr class="row-click" data-open="${c.Id}"><td class="st"><span class="dot running"></span></td>
    <td><div class="nm">${esc(cname(c))}</div><div class="sub mono">${esc(c.Image)}</div></td>
    <td class="num nw">${st ? st.cpu.toFixed(2) + '%' : '–'}</td><td class="num nw">${st ? fmt(st.memUsed) : '–'}</td></tr>`).join('')}</tbody></table>`
}

function attentionHtml(cs) {
  const items = []
  for (const c of cs) {
    const m = /^Exited \((\d+)\)/.exec(c.Status || '')
    if (c.State === 'exited' && m && m[1] !== '0' && !['137', '143'].includes(m[1])) items.push([c, 'bad', `Crashed with exit code ${m[1]}`])
    else if (/\(unhealthy\)/.test(c.Status || '')) items.push([c, 'bad', 'Health check failing'])
    else if (c.State === 'restarting') items.push([c, 'warn', 'Restarting repeatedly'])
    else if (c.State === 'paused') items.push([c, 'warn', 'Paused'])
  }
  if (!items.length) return `<div class="allgood">${ic('info', 18)}<div><b>All good</b><div class="meta">No crashed, unhealthy or paused containers.</div></div></div>`
  return `<table class="mini"><tbody>${items.slice(0, 6).map(([c, k, why]) => `<tr class="row-click" data-open="${c.Id}"><td class="st"><span class="dot ${k === 'bad' ? 'dead' : 'paused'}"></span></td><td><div class="nm">${esc(cname(c))}</div><div class="sub">${esc(why)}</div></td><td class="num nw meta">${esc((c.Status || '').replace(/^Exited \(\d+\) /, ''))}</td></tr>`).join('')}</tbody></table>`
}

function activityMini() {
  const list = activity.slice(0, 6)
  if (!list.length) return `<div class="meta">Nothing yet. Changes show up here as they happen.</div>`
  const good = /^(start|create|pull|tag|unpause|restart)$/
  return `<table class="mini"><tbody>${list.map((e) => `<tr><td class="nw mono meta">${new Date(e.t * 1000).toLocaleTimeString()}</td><td><span class="pill ${good.test(e.action) ? 'running' : ''}">${esc(e.action)}</span></td><td class="trunc">${esc(e.name)}</td></tr>`).join('')}</tbody></table>`
}

async function dashboard() {
  const [info, df, cs] = await Promise.all([api('info'), api('df'), api('containers.list')])
  dashCs = cs
  const sum = (a, f) => (a || []).reduce((x, y) => x + (f(y) || 0), 0)
  // Same arithmetic as `docker system df`
  const imgTotal = df.LayersSize || 0
  const imgUsed = sum((df.Images || []).filter((i) => i.Containers !== 0 && i.SharedSize >= 0), (i) => i.Size - i.SharedSize)
  const imgUnused = (df.Images || []).filter((i) => i.Containers === 0)
  const volSize = (v) => (v.UsageData?.Size > 0 ? v.UsageData.Size : 0)
  const D = {
    images: { total: imgTotal, rec: Math.max(0, imgTotal - imgUsed), n: (df.Images || []).length },
    containers: { total: sum(df.Containers, (c) => c.SizeRw), rec: sum((df.Containers || []).filter((c) => c.State !== 'running'), (c) => c.SizeRw), n: (df.Containers || []).length },
    volumes: { total: sum(df.Volumes, volSize), rec: sum((df.Volumes || []).filter((v) => v.UsageData?.RefCount === 0), volSize), n: (df.Volumes || []).length },
    cache: { total: sum(df.BuildCache, (c) => c.Size), rec: sum((df.BuildCache || []).filter((c) => !c.InUse), (c) => c.Size), n: (df.BuildCache || []).length }
  }
  const grand = D.images.total + D.containers.total + D.volumes.total + D.cache.total || 1
  const seg = [['images', 'Images', 'var(--acc)'], ['volumes', 'Volumes', 'var(--ok)'], ['containers', 'Containers', 'var(--warn)'], ['cache', 'Build cache', 'var(--mut)']]
  const projects = {}
  for (const c of cs) { const pn = c.Labels?.['com.docker.compose.project']; if (pn) (projects[pn] ||= []).push(c) }
  const projUp = Object.values(projects).filter((l) => l.some((c) => c.State === 'running')).length
  const labsUp = LABS.filter((l) => cs.some((c) => c.Labels?.['dockdesk.lab'] === l.id && c.State === 'running')).length
  const tile = (page, icon, label, big, sub) => `<div class="tile" data-call='${esc(call('goto', page))}' role="link" tabindex="0">${ic(icon, 18)}<div><div class="k">${label}</div><div class="v">${big}</div><div class="s">${sub}</div></div></div>`
  const clean = (label, sub, right, callJson) => `<div class="crow"><div><div class="nm">${label}</div><div class="meta">${sub}</div></div><div class="num nw">${right}</div>${tbtn('broom', 'Clean', callJson)}</div>`
  const sizeOrNone = (n) => (n > 0 ? fmt(n) : '<span class="meta">nothing to clean</span>')
  const volUnused = (df.Volumes || []).filter((v) => v.UsageData?.RefCount === 0).length
  const stopped = cs.filter((c) => c.State !== 'running').length
  return `<div class="head"><h2>${ic('dashboard', 22)}Overview</h2>
      <div class="hostline"><span class="dot up"></span>Docker ${esc(info.ServerVersion)} · ${esc(info.OperatingSystem)} · ${info.NCPU} CPUs · ${fmt(info.MemTotal)}</div></div>
    <div class="tiles">
      ${tile('containers', 'box', 'Containers', `<b>${info.ContainersRunning}</b> running`, `${info.Containers} total · ${info.ContainersPaused} paused`)}
      ${tile('compose', 'layers', 'Compose projects', `<b>${projUp}</b> / ${Object.keys(projects).length}`, 'running')}
      ${tile('images', 'image', 'Images', `<b>${info.Images}</b>`, fmt(imgTotal) + ' on disk')}
      ${tile('volumes', 'database', 'Volumes', `<b>${D.volumes.n}</b>`, fmt(D.volumes.total) + ' used')}
      ${tile('labs', 'flask', 'Labs', `<b>${labsUp}</b> / ${LABS.length}`, 'running')}
    </div>
    <div class="dgrid">
      <div class="dcol">
        <div class="dcard"><div class="dtitle">${ic('activity', 16)}Live resources</div><div id="d-live">${liveHtml()}</div></div>
        <div class="dcard"><div class="dtitle">${ic('database', 16)}Disk used by Docker<span class="sp"></span><span class="meta">${fmt(grand === 1 ? 0 : grand)} total</span></div>
          <div class="stack">${seg.map(([k, , col]) => `<i style="width:${(D[k].total / grand) * 100}%;background:${col}" title="${k}"></i>`).join('')}</div>
          <div class="legend">${seg.map(([k, l, col]) => `<div class="lg"><span class="sw" style="background:${col}"></span><div><div class="nm">${l}</div><div class="meta">${fmt(D[k].total)} · ${D[k].n} item${D[k].n === 1 ? '' : 's'}</div></div></div>`).join('')}</div>
          <div class="dsub">Clean up</div>
          ${clean('Unused images', imgUnused.length + ' of ' + D.images.n + ' not used by any container', sizeOrNone(D.images.rec), call('confirm', 'Remove ALL images that no container uses? They can be pulled again.', 'images.prune', true))}
          ${clean('Stopped containers', stopped + ' stopped', sizeOrNone(D.containers.rec), call('confirm', 'Remove all stopped containers?', 'containers.prune'))}
          ${clean('Unused volumes', volUnused + ' of ' + D.volumes.n + ' unused · deleting loses their data', sizeOrNone(D.volumes.rec), call('confirm', 'Remove ALL unused volumes? Their data will be lost.', 'volumes.prune'))}
          ${clean('Unused networks', 'custom networks no container uses', '<span class="meta">–</span>', call('confirm', 'Remove unused networks?', 'networks.prune'))}
        </div>
      </div>
      <div class="dcol">
        <div class="dcard"><div class="dtitle">${ic('box', 16)}Busiest containers</div><div id="d-top">${topHtml()}</div></div>
        <div class="dcard"><div class="dtitle">${ic('info', 16)}Needs attention</div>${attentionHtml(cs)}</div>
        <div class="dcard"><div class="dtitle">${ic('activity', 16)}Recent activity<span class="sp"></span><a class="link" data-call='${esc(call('goto', 'activity'))}'>View all</a></div>${activityMini()}</div>
      </div>
    </div>
    <div class="dsub" style="margin-top:6px">Quick actions</div>
    <div class="tools">
      ${tbtn('download', 'Pull image', '["pull"]')}${tbtn('hammer', 'Build image', call('build'))}${tbtn('plus', 'New volume', call('newvol'))}${tbtn('plus', 'New network', call('newnet'))}
      ${tbtn('terminal', 'Open terminal', call('dock'))}${tbtn('flask', 'Browse labs', call('goto', 'labs'))}<span class="sp"></span>
      ${tbtn('power', 'Stop Docker', call('engine'), 'dan')}
    </div>`
}

// ---------- Containers ----------
const cname = (c) => (c.Names?.[0] || c.Id.slice(0, 12)).replace(/^\//, '')
const pubPorts = (c) => [...new Map((c.Ports || []).filter((p) => p.PublicPort).map((p) => [p.PublicPort, p])).values()]
let cq = '', onlyRunning = false, cList = []
const sel = new Set() // selected container ids (survives re-renders)

const visible = () => {
  const q = cq.toLowerCase()
  return cList.filter((c) => (!onlyRunning || c.State === 'running') && (!q || (cname(c) + ' ' + c.Image + ' ' + c.Id).toLowerCase().includes(q)))
}

function containerRows() {
  return visible().map((c) => {
    const up = c.State === 'running'
    const toggle = up
      ? ibtn('stop', 'Stop', call('container.action', c.Id, 'stop'), 'stop')
      : ibtn('play', c.State === 'paused' ? 'Resume' : 'Start', call('container.action', c.Id, c.State === 'paused' ? 'unpause' : 'start'), 'ok')
    return `<tr class="row-click" data-open="${c.Id}">
      <td class="cb"><input type="checkbox" class="sel" data-id="${c.Id}" ${sel.has(c.Id) ? 'checked' : ''}></td>
      <td><div class="namecell"><span class="dot ${c.State}" title="${c.State}"></span><span class="nm">${esc(cname(c))}</span></div></td>
      <td class="mono">${c.Id.slice(0, 12)}</td>
      <td class="trunc mono" title="${esc(c.Image)}"><span class="imglink">${esc(c.Image)}</span></td>
      <td class="mono">${pubPorts(c).map((p) => `<a href="#" data-call='${esc(call('open.url', 'http://localhost:' + p.PublicPort))}' class="port">${p.PublicPort}:${p.PrivatePort}</a>`).join(' ') || '–'}</td>
      <td class="nw">${rel(c.StartedAt)}</td>
      <td class="num" data-cpu="${c.Id}" data-run="${up ? 1 : 0}">${up ? '–' : '0%'}</td>
      <td><div class="actions">${toggle}${ibtn('more', 'More actions', call('menu', c.Id))}${ibtn('trash', 'Delete', call('confirm', `Delete ${cname(c)}?`, 'container.remove', c.Id, true), 'dan')}</div></td></tr>`
  }).join('') || `<tr><td colspan="8"><div class="empty">No matching containers</div></td></tr>`
}

async function containers() {
  cList = await api('containers.table')
  cList.sort((a, b) => (b.State === 'running') - (a.State === 'running') || Date.parse(b.StartedAt || 0) - Date.parse(a.StartedAt || 0))
  for (const id of [...sel]) if (!cList.some((c) => c.Id === id)) sel.delete(id)
  const running = cList.filter((c) => c.State === 'running').length
  return `<div class="head"><h2>${ic('box', 22)}Containers<span class="count">${cList.length}</span></h2>
    <div class="usage">
      <div><div class="k">Container CPU usage</div><div class="v"><b id="u-cpu">–</b> / ${engine.ncpu ? engine.ncpu * 100 : '…'}%</div><div class="s">(${engine.ncpu || '…'} CPUs allocated)</div></div>
      <div><div class="k">Container memory usage</div><div class="v"><b id="u-mem">–</b> / ${fmt(engine.memTotal)}</div><div class="s">${running} running</div></div>
    </div></div>
    <div class="tools">
      <label class="search">${ic('search', 15)}<input type="text" id="cq" placeholder="Search" value="${esc(cq)}"></label>
      <label class="switch"><input type="checkbox" id="crun" ${onlyRunning ? 'checked' : ''}>Only show running containers</label>
    </div>
    <div id="bulk"></div>` +
    (cList.length
      ? `<table><thead><tr><th class="cb"><input type="checkbox" id="selall" title="Select all"></th><th>Name</th><th>Container ID</th><th>Image</th><th>Port(s)</th><th>Last started</th><th class="num">CPU %</th><th class="num">Actions</th></tr></thead><tbody id="rows">${containerRows()}</tbody></table>`
      : `<div class="empty">${ic('box', 32)}<div>No containers yet. Pull an image from the Images page.</div></div>`)
}

function updateBulk() {
  const b = $('#bulk'); if (!b) return
  b.classList.toggle('on', sel.size > 0)
  b.innerHTML = sel.size
    ? `<b>${sel.size} selected</b>${tbtn('play', 'Start', call('bulk', 'start'))}${tbtn('stop', 'Stop', call('bulk', 'stop'))}${tbtn('trash', 'Delete', call('bulk', 'remove'), 'dan')}<span class="sp"></span>${tbtn('x', 'Clear', call('bulkclear'))}`
    : ''
  const all = $('#selall'); if (all) { const v = visible(); all.checked = v.length > 0 && v.every((c) => sel.has(c.Id)) }
}
function afterContainers() { updateBulk(); applyStats() }

async function bulk(action) {
  if (action === 'remove' && !confirm(`Delete ${sel.size} container(s)?`)) return
  const ids = [...sel]
  await act('Done', async () => {
    for (const id of ids) await (action === 'remove' ? api('container.remove', id, true) : api('container.action', id, action))
    sel.clear()
  }, () => { window.refresh?.(); refreshStats() })
}

document.addEventListener('input', (e) => {
  if (e.target.id === 'cq') { cq = e.target.value; $('#rows').innerHTML = containerRows(); afterContainers() }
})
document.addEventListener('change', (e) => {
  const t = e.target
  if (t.id === 'crun') { onlyRunning = t.checked; lastHtml = ''; $('#rows').innerHTML = containerRows(); afterContainers() }
  else if (t.id === 'selall') { visible().forEach((c) => (t.checked ? sel.add(c.Id) : sel.delete(c.Id))); $('#rows').innerHTML = containerRows(); afterContainers() }
  else if (t.classList.contains('sel')) { t.checked ? sel.add(t.dataset.id) : sel.delete(t.dataset.id); updateBulk() }
})

// "More actions" (kebab) menu
function showMenu(btn, id) {
  const c = cList.find((x) => x.Id === id); if (!c) return
  const m = $('#menu')
  const up = c.State === 'running', port = pubPorts(c)[0]
  const item = (icon, label, callJson, cls = '') => `<button class="${cls}" data-call='${esc(callJson)}'>${ic(icon, 15)}${label}</button>`
  m.innerHTML = [
    up && port ? item('ext', `Open localhost:${port.PublicPort}`, call('open.url', `http://localhost:${port.PublicPort}`)) : '',
    item('info', 'View details', call('open', id, 'Overview')),
    item('logs', 'View logs', call('open', id, 'Logs')),
    up ? item('terminal', 'Open terminal', call('term', id, cname(c))) : '',
    up ? item('activity', 'Live stats', call('open', id, 'Stats')) : '',
    '<hr>',
    up ? item('restart', 'Restart', call('container.action', id, 'restart')) : '',
    up ? item('pause', 'Pause', call('container.action', id, 'pause')) : '',
    c.State === 'paused' ? item('play', 'Resume', call('container.action', id, 'unpause')) : '',
    item('copy', 'Copy ID', call('copy', id))
  ].join('')
  m.hidden = false
  const r = btn.getBoundingClientRect(), mh = m.offsetHeight
  m.style.left = Math.max(8, r.right - 200) + 'px'
  m.style.top = (r.bottom + mh + 8 > innerHeight - 30 ? r.top - mh - 4 : r.bottom + 4) + 'px'
}

// ---------- Compose ----------
const cexp = new Set() // expanded project names
let cProjects = {}

let compq = '', compf = 'all'
const projState = (p) => { const run = p.cs.filter((c) => c.State === 'running').length; return run === 0 ? 'stopped' : run === p.cs.length ? 'running' : 'partial' }
const svcName = (c) => c.Labels['com.docker.compose.service'] || cname(c)

function visibleProjects() {
  const q = compq.trim().toLowerCase()
  return Object.values(cProjects).filter((p) => (compf === 'all' || projState(p) === compf) &&
    (!q || [p.name, p.dir, p.files, ...p.cs.map((c) => svcName(c) + ' ' + cname(c) + ' ' + c.Image)].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => (projState(a) === 'stopped') - (projState(b) === 'stopped') || a.name.localeCompare(b.name))
}

function composeRows() {
  const q = compq.trim().toLowerCase()
  return visibleProjects().map((p) => {
    const st = projState(p), run = p.cs.filter((c) => c.State === 'running').length
    const inside = q && !p.name.toLowerCase().includes(q) // the match is a service/container: show it without an extra click
    const open = cexp.has(p.name) || inside
    const toggle = st === 'running'
      ? ibtn('stop', 'Stop', call('compose.action', p.name, p.dir, p.files, 'stop'), 'stop')
      : ibtn('play', st === 'partial' ? 'Start remaining' : 'Start', call('compose.action', p.name, p.dir, p.files, 'up'), 'ok')
    const ports = [...new Map(p.cs.flatMap(pubPorts).map((q2) => [q2.PublicPort, q2])).values()]
    const sorted = [...p.cs].sort((a, b) => svcName(a).localeCompare(svcName(b)))
    const chips = sorted.slice(0, 4).map((c) => `<span class="chip" title="${esc(c.Status)}"><span class="dot ${c.State}"></span>${esc(svcName(c))}</span>`).join('') + (sorted.length > 4 ? `<span class="chip more">+${sorted.length - 4}</span>` : '')
    const sub = open ? `<tr class="subrow"><td colspan="7"><table class="nested"><tbody>${sorted.map((c) => `<tr>
        <td class="st"><span class="dot ${c.State}"></span></td>
        <td class="nm">${esc(svcName(c))}</td>
        <td class="mono">${esc(cname(c))}</td>
        <td class="mono trunc" title="${esc(c.Image)}">${esc(c.Image)}</td>
        <td class="mono">${pubPorts(c).map((x) => `<a href="#" data-call='${esc(call('open.url', 'http://localhost:' + x.PublicPort))}' class="port">${x.PublicPort}:${x.PrivatePort}</a>`).join(' ') || '–'}</td>
        <td class="nw">${esc(c.Status)}</td>
        <td class="num nw" data-cpu="${c.Id}" data-run="${c.State === 'running' ? 1 : 0}">${c.State === 'running' ? '–' : '0%'}</td>
        <td><div class="actions">${c.State === 'running' ? ibtn('stop', 'Stop', call('container.action', c.Id, 'stop'), 'stop') : ibtn('play', 'Start', call('container.action', c.Id, c.State === 'paused' ? 'unpause' : 'start'), 'ok')}${ibtn('logs', 'View logs', call('open', c.Id, 'Logs'))}${ibtn('more', 'More actions', call('menu', c.Id))}</div></td></tr>`).join('')}</tbody></table></td></tr>` : ''
    return `<tr class="row-click cprow ${open ? 'open' : ''}" data-cp="${esc(p.name)}">
      <td class="cb">${ibtn(open ? 'chevdown' : 'chevright', open ? 'Collapse' : 'Expand', call('cexp', p.name))}</td>
      <td><div class="namecell"><span class="dot ${st === 'stopped' ? 'exited' : st === 'partial' ? 'paused' : 'running'}"></span><div><div class="nm">${esc(p.name)}</div><div class="sub mono" title="${esc(p.dir)}">${esc(p.dir)}</div></div></div></td>
      <td><div class="chips">${chips}</div></td>
      <td><span class="pill ${st === 'running' ? 'running' : st === 'partial' ? 'warn' : ''}">${run} of ${p.cs.length} running</span></td>
      <td class="mono">${ports.slice(0, 3).map((x) => `<a href="#" data-call='${esc(call('open.url', 'http://localhost:' + x.PublicPort))}' class="port">${x.PublicPort}</a>`).join(' ') || '–'}${ports.length > 3 ? ` <span class="meta">+${ports.length - 3}</span>` : ''}</td>
      <td class="num nw" data-pstat="${p.cs.filter((c) => c.State === 'running').map((c) => c.Id).join(',')}">–</td>
      <td><div class="actions">${toggle}${ibtn('more', 'More actions', call('cmenu', p.name))}${ibtn('trash', 'Down: remove containers', call('confirm', `Remove all containers and networks of “${p.name}”? Volumes are kept.`, 'compose.action', p.name, p.dir, p.files, 'down'), 'dan')}</div></td></tr>${sub}`
  }).join('') || `<tr><td colspan="7"><div class="empty">No matching projects</div></td></tr>`
}

async function compose() {
  const list = await api('containers.list')
  cList = list // the per-container ⋮ menu reads from this
  cProjects = {}
  for (const c of list) {
    const l = c.Labels || {}
    const pn = l['com.docker.compose.project']
    if (!pn) continue
    const x = (cProjects[pn] ||= { name: pn, dir: l['com.docker.compose.project.working_dir'] || '', files: l['com.docker.compose.project.config_files'] || '', cs: [] })
    x.cs.push(c)
  }
  const all = Object.values(cProjects)
  const running = all.filter((p) => projState(p) !== 'stopped').length
  const svc = all.reduce((a, p) => a + p.cs.length, 0), svcUp = all.reduce((a, p) => a + p.cs.filter((c) => c.State === 'running').length, 0)
  return `<div class="head"><h2>${ic('layers', 22)}Compose<span class="count">${all.length}</span></h2>
    <div class="usage">
      <div><div class="k">Projects running</div><div class="v"><b>${running}</b> / ${all.length}</div><div class="s">${all.length - running} stopped</div></div>
      <div><div class="k">Services running</div><div class="v"><b>${svcUp}</b> / ${svc}</div><div class="s">across all projects</div></div>
      <div><div class="k">Project CPU / memory</div><div class="v"><b id="cp-cpu">–</b> · <b id="cp-mem">–</b></div><div class="s">compose containers only</div></div>
    </div></div>` + (all.length ? `
    <div class="tools">
      <label class="search">${ic('search', 15)}<input type="text" id="cpq" placeholder="Search projects, services, images…" value="${esc(compq)}"></label>
      <select id="cpf">${[['all', 'All projects'], ['running', 'Running'], ['partial', 'Partly running'], ['stopped', 'Stopped']].map(([v, l]) => `<option value="${v}" ${compf === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="sp"></span>${tbtn('plus', 'New project', call('newproject'), 'pri')}${tbtn('chevdown', 'Expand all', call('cexpall', 1))}${tbtn('chevright', 'Collapse all', call('cexpall', 0))}
    </div>
    <table class="cptable"><thead><tr><th class="cb"></th><th>Project</th><th>Services</th><th>Status</th><th>Ports</th><th class="num">CPU · Memory</th><th class="num">Actions</th></tr></thead><tbody id="cprows">${composeRows()}</tbody></table>`
    : `<div class="empty">${ic('layers', 32)}<div>No compose projects yet.<br><span class="meta">Create one here, or run <span class="mono">docker compose up -d</span> in a folder with a compose file.</span></div>${tbtn('plus', 'New project', call('newproject'), 'pri')}</div>`)
}

document.addEventListener('input', (e) => { if (e.target.id === 'cpq') { compq = e.target.value; $('#cprows').innerHTML = composeRows(); applyStats() } })
document.addEventListener('change', (e) => { if (e.target.id === 'cpf') { compf = e.target.value; $('#cprows').innerHTML = composeRows(); applyStats() } })

const COMPOSE_TEMPLATES = {
  'Nginx web server': 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "127.0.0.1:8080:80"\n',
  'Postgres + Adminer': 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: change-me\n    volumes:\n      - db-data:/var/lib/postgresql/data\n  adminer:\n    image: adminer\n    ports:\n      - "127.0.0.1:8081:8080"\n    depends_on:\n      - db\nvolumes:\n  db-data:\n',
  'Redis': 'services:\n  redis:\n    image: redis:7-alpine\n    ports:\n      - "127.0.0.1:6379:6379"\n',
  'WordPress + MariaDB': 'services:\n  db:\n    image: mariadb:11\n    environment:\n      MARIADB_ROOT_PASSWORD: change-me\n      MARIADB_DATABASE: wordpress\n    volumes:\n      - db-data:/var/lib/mysql\n  wordpress:\n    image: wordpress:latest\n    depends_on:\n      - db\n    environment:\n      WORDPRESS_DB_HOST: db\n      WORDPRESS_DB_USER: root\n      WORDPRESS_DB_PASSWORD: change-me\n      WORDPRESS_DB_NAME: wordpress\n    ports:\n      - "127.0.0.1:8082:80"\nvolumes:\n  db-data:\n',
  'Kali toolbox': 'services:\n  kali:\n    image: kalilinux/kali-rolling\n    tty: true\n    stdin_open: true\n    cap_add:\n      - NET_ADMIN\n      - NET_RAW\n'
}

// Write or edit a compose file, validate it with `docker compose config`, then run it.
function composeEditor({ project = '', file = '', text = '', writable = true } = {}) {
  closeModal()
  const isNew = !file
  const m = document.createElement('div')
  m.className = 'modal'
  m.innerHTML = `<div class="box xwide"><h3>${ic('layers', 18)}${isNew ? 'New compose project' : 'Edit ' + esc(project)}</h3>
    <form><div class="two"><label class="fld">Project name<input type="text" id="cename" value="${esc(project)}" ${isNew ? '' : 'readonly'} placeholder="my-project" spellcheck="false" autocomplete="off"></label>
      ${isNew ? `<label class="fld">Start from a template<select id="cetpl"><option value="">Choose…</option>${Object.keys(COMPOSE_TEMPLATES).map((k) => `<option>${esc(k)}</option>`).join('')}</select></label>` : `<div class="fld">File<div class="mono meta" style="padding-top:8px;word-break:break-all">${esc(file)}</div></div>`}</div>
      ${writable ? '' : `<div class="err">This file is read-only for your user, so changes can't be saved.</div>`}
      <textarea id="ceyaml" class="yaml" spellcheck="false" wrap="off" placeholder="services:&#10;  web:&#10;    image: nginx:alpine">${esc(text)}</textarea>
      <div id="cestat" class="cestat"></div>
      <div class="row"><button type="button" class="tb" id="ceclose">Close</button><button type="button" class="tb" id="cevalidate">${ic('info', 14)}<span>Validate</span></button>
        <button type="button" class="tb" id="cesave" ${writable ? '' : 'disabled'}>${ic('copy', 14)}<span>Save</span></button><button class="tb pri" id="cego" ${writable ? '' : 'disabled'}>${ic('play', 14)}<span>Save and start</span></button></div></form>
    <pre class="log buildlog" id="ceout" hidden></pre></div>`
  document.body.append(m)
  const ta = $('#ceyaml', m), nameIn = $('#cename', m), stat = $('#cestat', m), out = $('#ceout', m)
  let curFile = file, stopRun = null
  const say = (html, kind) => { stat.className = 'cestat ' + (kind || ''); stat.innerHTML = html }
  $('#ceclose', m).onclick = () => { stopRun?.(); closeModal() }
  m.onclick = (e) => { if (e.target === m) { stopRun?.(); closeModal() } }
  ta.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  ') } })
  if (isNew) $('#cetpl', m).onchange = (e) => { if (e.target.value && (!ta.value.trim() || confirm('Replace the current text with this template?'))) { ta.value = COMPOSE_TEMPLATES[e.target.value]; say('') } e.target.value = '' }
  const validate = async () => {
    say('Checking…')
    try {
      const r = await api('compose.validate', ta.value)
      say(`✓ Valid · ${r.services.length} service${r.services.length === 1 ? '' : 's'}: ${esc(r.services.join(', '))}${r.warnings.length ? `<div class="meta">${r.warnings.map(esc).join('<br>')}</div>` : ''}`, 'ok')
      return true
    } catch (e) { say(esc(e.message), 'bad'); return false }
  }
  const nameOk = () => {
    const n = nameIn.value.trim()
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(n)) { say('Project name: lowercase letters, digits, - and _ only.', 'bad'); nameIn.focus(); return null }
    return n
  }
  const save = async () => {
    if (isNew && !curFile) { const n = nameOk(); if (!n) return false; curFile = (await api('compose.save', n, ta.value)).file }
    else await api('compose.write', curFile, ta.value)
    return true
  }
  $('#cevalidate', m).onclick = validate
  $('#cesave', m).onclick = async () => { if (!(await validate())) return; try { if (await save()) { say(`✓ Saved to <span class="mono">${esc(curFile)}</span>`, 'ok'); toast('Saved'); window.refresh?.() } } catch (e) { say(esc(e.message), 'bad') } }
  $('form', m).onsubmit = async (e) => {
    e.preventDefault()
    const name = isNew ? nameOk() : project; if (!name) return
    if (!(await validate())) return
    try { if (!(await save())) return } catch (err) { return say(esc(err.message), 'bad') }
    out.hidden = false; out.textContent = ''; say('Starting…')
    let pending = '', raf = 0
    $('#cego', m).disabled = true
    stopRun = stream('compose', { project: name, file: curFile, verb: 'up' }, (ev) => {
      if (ev.k === 'data') { pending += ev.d; if (!raf) raf = requestAnimationFrame(() => { raf = 0; out.append(pending); pending = ''; out.scrollTop = out.scrollHeight }) }
      else { $('#cego', m).disabled = false; stopRun = null
        if (ev.k === 'end') { say(`✓ ${esc(name)} is running`, 'ok'); toast(`${name} started`); window.refresh?.() } else say(esc(ev.d), 'bad') }
    })
  }
  ta.focus()
}

async function editProject(name) {
  const p = cProjects[name]
  const file = (p?.files || '').split(',')[0]
  if (!file) return toast('This project has no compose file on record', true)
  try {
    const r = await api('compose.read', file)
    composeEditor({ project: name, file: r.file, text: r.text, writable: r.writable })
    if ((p.files || '').includes(',')) toast('This project uses several compose files; only the first is shown.')
  } catch (e) { toast(e.message, true) }
}

function showComposeMenu(btn, name) {
  const p = cProjects[name]; if (!p) return
  const m = $('#menu')
  const act = (v) => call('compose.action', p.name, p.dir, p.files, v)
  const item = (icon, label, callJson, cls = '') => `<button class="${cls}" data-call='${esc(callJson)}'>${ic(icon, 15)}${label}</button>`
  m.innerHTML = [
    item('play', 'Start (up -d)', act('up')), item('restart', 'Restart', act('restart')), item('stop', 'Stop', act('stop')),
    '<hr>', item('down', 'Down (remove containers)', call('confirm', `Remove all containers and networks of “${p.name}”? Volumes are kept.`, 'compose.action', p.name, p.dir, p.files, 'down'), 'dan'),
    '<hr>', item('logs', 'Edit compose file…', call('editproject', p.name)),
    p.dir ? item('copy', 'Copy project folder', call('copy', p.dir)) : ''
  ].join('')
  placeMenu(btn)
}
function placeMenu(btn) {
  const m = $('#menu'); m.hidden = false
  const b = btn.getBoundingClientRect(), mh = m.offsetHeight
  m.style.left = Math.max(8, b.right - 200) + 'px'
  m.style.top = (b.bottom + mh + 8 > innerHeight - 30 ? b.top - mh - 4 : b.bottom + 4) + 'px'
}

// ---------- Images ----------
const volName = (n) => (/^[0-9a-f]{64}$/.test(n) ? n.slice(0, 12) + '…' : n)
const short = (id) => String(id || '').replace('sha256:', '').slice(0, 12)
let iq = '', ifilter = 'all', iList = []
const isel = new Set() // selected image refs (tag, or image id for untagged)

const splitRef = (ref) => { const i = ref.lastIndexOf(':'); return i > ref.lastIndexOf('/') ? [ref.slice(0, i), ref.slice(i + 1)] : [ref, 'latest'] }

// One row per tag (an image with several tags shows up several times, like Docker Desktop).
function flattenImages(list, cs) {
  const rows = []
  for (const i of list) {
    const usedBy = cs.filter((c) => c.ImageID === i.Id).map(cname)
    const tags = i.RepoTags?.length ? i.RepoTags : [null]
    for (const t of tags) {
      const [repo, tag] = t ? splitRef(t) : ['<none>', '<none>']
      rows.push({ ref: t || i.Id, id: i.Id, repo, tag, created: i.Created, size: i.Size, usedBy, dangling: !t })
    }
  }
  return rows.sort((a, b) => b.created - a.created)
}
const visibleImages = () => {
  const q = iq.toLowerCase()
  return iList.filter((r) => (ifilter === 'all' || (ifilter === 'inuse' && r.usedBy.length) || (ifilter === 'unused' && !r.usedBy.length) || (ifilter === 'dangling' && r.dangling)) &&
    (!q || (r.repo + ':' + r.tag + ' ' + r.id).toLowerCase().includes(q)))
}

function imageRows() {
  return visibleImages().map((r) => `<tr class="row-click" data-inspect="image:${esc(r.id)}:${esc(r.ref.startsWith('sha256:') ? r.repo : r.ref)}">
    <td class="cb"><input type="checkbox" class="isel" data-ref="${esc(r.ref)}" ${isel.has(r.ref) ? 'checked' : ''}></td>
    <td><div class="namecell"><span class="nm">${esc(r.repo)}</span>${r.usedBy.length ? `<span class="pill running" title="${esc(r.usedBy.join(', '))}">In use</span>` : ''}${r.dangling ? '<span class="pill warn">dangling</span>' : ''}</div></td>
    <td class="mono">${esc(r.tag)}</td>
    <td class="mono">${short(r.id)}</td>
    <td class="nw">${rel(new Date(r.created * 1000).toISOString())}</td>
    <td class="nw">${fmt(r.size)}</td>
    <td><div class="actions">${ibtn('play', 'Run', call('run', r.ref), 'ok')}${ibtn('more', 'More actions', call('imenu', r.ref))}${ibtn('trash', 'Delete', call('confirm', `Delete ${r.dangling ? short(r.id) : r.ref}?`, 'image.remove', r.ref, false), 'dan')}</div></td></tr>`).join('') ||
    `<tr><td colspan="7"><div class="empty">No matching images</div></td></tr>`
}

async function images() {
  const [list, cs] = await Promise.all([api('images.list'), api('containers.list')])
  iList = flattenImages(list, cs)
  for (const ref of [...isel]) if (!iList.some((r) => r.ref === ref)) isel.delete(ref)
  const total = list.reduce((a, i) => a + i.Size, 0)
  const inUse = list.filter((i) => cs.some((c) => c.ImageID === i.Id)).reduce((a, i) => a + i.Size, 0)
  return `<div class="head"><h2>${ic('image', 22)}Images<span class="count">${list.length}</span></h2>
    <div class="usage"><div><div class="k">${list.length} image${list.length === 1 ? '' : 's'}</div><div class="v"><b>${fmt(inUse)}</b> / ${fmt(total)}</div><div class="s">in use</div></div></div></div>
    <div class="tools">
      <label class="search">${ic('search', 15)}<input type="text" id="iq" placeholder="Search" value="${esc(iq)}"></label>
      <select id="ifilter">${[['all', 'All images'], ['inuse', 'In use'], ['unused', 'Unused'], ['dangling', 'Dangling']].map(([v, l]) => `<option value="${v}" ${ifilter === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="sp"></span>
      ${tbtn('upload', 'Import', call('importimg'))}
      ${tbtn('hammer', 'Build image', call('build'))}
      ${tbtn('download', 'Pull image', '["pull"]', 'pri')}
      ${tbtn('broom', 'Prune dangling', call('confirm', 'Remove dangling images?', 'images.prune', false))}
    </div>
    <div id="ibulk" class="bulk"></div>` +
    (iList.length
      ? `<table><thead><tr><th class="cb"><input type="checkbox" id="iselall" title="Select all"></th><th>Name</th><th>Tag</th><th>Image ID</th><th>Created</th><th>Size</th><th class="num">Actions</th></tr></thead><tbody id="irows">${imageRows()}</tbody></table>`
      : `<div class="empty">${ic('image', 32)}<div>No images yet. Use “Pull image” to download one.</div></div>`)
}

function updateIBulk() {
  const b = $('#ibulk'); if (!b) return
  b.classList.toggle('on', isel.size > 0)
  b.innerHTML = isel.size ? `<b>${isel.size} selected</b>${tbtn('trash', 'Delete', call('ibulkdel'), 'dan')}<span class="sp"></span>${tbtn('x', 'Clear', call('ibulkclear'))}` : ''
  const all = $('#iselall'); if (all) { const v = visibleImages(); all.checked = v.length > 0 && v.every((r) => isel.has(r.ref)) }
}
async function bulkDeleteImages() {
  if (!confirm(`Delete ${isel.size} image(s)?`)) return
  const refs = [...isel]
  const failed = []
  for (const ref of refs) { try { await api('image.remove', ref, false); isel.delete(ref) } catch (e) { failed.push(`${ref}: ${e.message}`) } }
  if (failed.length) toast(failed[0] + (failed.length > 1 ? ` (+${failed.length - 1} more)` : ''), true); else toast('Done')
  window.refresh?.()
}

document.addEventListener('input', (e) => {
  if (e.target.id === 'iq') { iq = e.target.value; $('#irows').innerHTML = imageRows(); updateIBulk() }
})
document.addEventListener('change', (e) => {
  const t = e.target
  if (t.id === 'ifilter') { ifilter = t.value; $('#irows').innerHTML = imageRows(); updateIBulk() }
  else if (t.id === 'iselall') { visibleImages().forEach((r) => (t.checked ? isel.add(r.ref) : isel.delete(r.ref))); $('#irows').innerHTML = imageRows(); updateIBulk() }
  else if (t.classList.contains('isel')) { t.checked ? isel.add(t.dataset.ref) : isel.delete(t.dataset.ref); updateIBulk() }
})

function showImageMenu(btn, ref) {
  const r = iList.find((x) => x.ref === ref); if (!r) return
  const m = $('#menu')
  const item = (icon, label, callJson, cls = '') => `<button class="${cls}" data-call='${esc(callJson)}'>${ic(icon, 15)}${label}</button>`
  m.innerHTML = [
    item('play', 'Run', call('run', ref)),
    item('info', 'View details', call('inspectimg', r.id, r.dangling ? r.repo : ref)),
    r.dangling ? '' : item('download', 'Pull latest', call('pull', ref)),
    item('layers', 'Tag…', call('tagimg', ref)),
    r.dangling ? '' : item('ext', 'Push…', call('pushimg', ref)),
    item('upload', 'Export…', call('exportimg', ref)),
    '<hr>',
    r.dangling ? '' : item('copy', 'Copy name', call('copy', ref)),
    item('copy', 'Copy ID', call('copy', r.id.replace('sha256:', '')))
  ].join('')
  m.hidden = false
  const b = btn.getBoundingClientRect(), mh = m.offsetHeight
  m.style.left = Math.max(8, b.right - 200) + 'px'
  m.style.top = (b.bottom + mh + 8 > innerHeight - 30 ? b.top - mh - 4 : b.bottom + 4) + 'px'
}

// "Run a new container" dialog: name, ports, volumes, environment variables.
async function runImage(ref) {
  closeModal()
  let exposed = [], nets = []
  try {
    const img = await api('image.inspect', ref)
    exposed = Object.keys(img.Config?.ExposedPorts || {}).map((p) => p.split('/')) // [['5432','tcp']]
    nets = (await api('networks.list')).map((n) => n.Name).filter((n) => !['bridge', 'host', 'none'].includes(n))
  } catch (e) { return toast(e.message, true) }
  const m = document.createElement('div')
  m.className = 'modal'
  const rowsOf = (kind) => `<div class="rows" data-kind="${kind}"></div><button type="button" class="tb" data-add="${kind}">${ic('plus', 14)}<span>Add ${kind === 'ports' ? 'port' : kind === 'volumes' ? 'volume' : 'variable'}</span></button>`
  m.innerHTML = `<div class="box wide"><h3>${ic('play', 18)}Run a new container</h3>
    <p class="meta mono">${esc(ref)}</p>
    <form>
      <label class="fld">Container name<input type="text" id="rn" placeholder="Leave empty for a random name" autocomplete="off" spellcheck="false"></label>
      <div class="fld">Ports <span class="meta">(host port empty = random)</span>${rowsOf('ports')}</div>
      <div class="fld">Volumes <span class="meta">(host path or volume name → container path)</span>${rowsOf('volumes')}</div>
      <div class="fld">Environment variables${rowsOf('env')}</div>
      <details class="fld adv"><summary>Advanced options</summary>
        <label class="fld">Publish ports on<select id="ra-bind"><option value="127.0.0.1">This computer only (recommended)</option><option value="0.0.0.0">All network interfaces (reachable from your LAN)</option></select></label>
        <label class="fld">Network<select id="ra-net"><option>bridge</option><option>host</option><option>none</option>${nets.map((n) => `<option>${esc(n)}</option>`).join('')}</select></label>
        <div class="meta" id="ra-hostnote" hidden>Host mode shares this computer's network stack: the container can see and bind every host port, and published ports are ignored.</div>
        <label class="fld">Restart policy<select id="ra-restart"><option value="no">Never</option><option value="unless-stopped">Unless stopped</option><option value="always">Always</option><option value="on-failure">On failure</option></select></label>
        <div class="two"><label class="fld">Memory limit (MB)<input type="text" id="ra-mem" placeholder="unlimited" inputmode="numeric"></label><label class="fld">CPUs<input type="text" id="ra-cpu" placeholder="unlimited" inputmode="decimal"></label></div>
        <label class="fld">Capabilities (comma separated)<input type="text" id="ra-caps" placeholder="NET_ADMIN, NET_RAW" spellcheck="false"></label>
        <label class="fld">Devices (comma separated, under /dev)<input type="text" id="ra-dev" placeholder="/dev/net/tun" spellcheck="false"></label>
        <label class="chk"><input type="checkbox" id="ra-it"> Keep it open with a terminal (needed for shell images such as Kali)</label>
        <label class="chk danger"><input type="checkbox" id="ra-priv"> Privileged: full access to this machine's devices and kernel</label>
      </details>
      <div class="row"><button type="button" class="tb" id="rcancel">Cancel</button><button class="tb pri" id="rgo">${ic('play', 15)}<span>Run</span></button></div>
    </form><div id="rerr"></div></div>`
  document.body.append(m)
  const form = $('form', m)
  const addRow = (kind, a = '', b = '') => {
    const d = document.createElement('div'); d.className = 'rrow'
    d.innerHTML = kind === 'ports'
      ? `<input type="text" placeholder="host" value="${esc(a)}" inputmode="numeric"><span>:</span><input type="text" placeholder="container" value="${esc(b)}" inputmode="numeric"><select><option>tcp</option><option>udp</option></select>`
      : kind === 'volumes'
        ? `<input type="text" placeholder="/host/path or volume" value="${esc(a)}"><span>→</span><input type="text" placeholder="/container/path" value="${esc(b)}">`
        : `<input type="text" placeholder="KEY" value="${esc(a)}"><span>=</span><input type="text" placeholder="value" value="${esc(b)}">`
    d.insertAdjacentHTML('beforeend', `<button type="button" class="ib" title="Remove">${ic('x', 14)}</button>`)
    d.querySelector('button').onclick = () => d.remove()
    $(`.rows[data-kind="${kind}"]`, m).append(d)
  }
  exposed.forEach(([p, proto]) => { addRow('ports', '', p); if (proto === 'udp') [...$$('.rows[data-kind="ports"] select', m)].pop().value = 'udp' })
  m.onclick = (e) => { if (e.target === m) closeModal(); const a = e.target.closest('[data-add]'); if (a) addRow(a.dataset.add) }
  $('#rcancel', m).onclick = closeModal
  $('#rn', m).focus()
  $('#ra-net', m).onchange = (e) => ($('#ra-hostnote', m).hidden = e.target.value !== 'host')
  const collect = (kind) => [...$$(`.rows[data-kind="${kind}"] .rrow`, m)].map((r) => [...r.querySelectorAll('input,select')].map((x) => x.value))
  form.onsubmit = async (e) => {
    e.preventDefault()
    const go = $('#rgo', m); go.disabled = true
    $('#rerr', m).innerHTML = ''
    const list = (id) => $(id, m).value.split(',').map((x) => x.trim()).filter(Boolean)
    if ($('#ra-priv', m).checked && !confirm('Privileged containers can take over this machine (they get its devices and can change the kernel). Run it privileged anyway?')) { go.disabled = false; return }
    try {
      await api('container.run', {
        bindIp: $('#ra-bind', m).value, network: $('#ra-net', m).value, restart: $('#ra-restart', m).value,
        memoryMb: Number($('#ra-mem', m).value) || 0, cpus: Number($('#ra-cpu', m).value) || 0,
        caps: list('#ra-caps'), devices: list('#ra-dev'), interactive: $('#ra-it', m).checked, privileged: $('#ra-priv', m).checked,
        image: ref, name: $('#rn', m).value,
        ports: collect('ports').map(([host, container, proto]) => ({ host, container, proto })),
        volumes: collect('volumes').map(([host, container]) => ({ host, container })),
        env: collect('env').map(([key, value]) => ({ key, value }))
      })
      toast(`Started a container from ${ref}`); closeModal(); go_('containers')
    } catch (err) { $('#rerr', m).innerHTML = `<div class="err">${esc(err.message)}</div>`; go.disabled = false }
  }
}

// Build an image from a folder containing a Dockerfile (runs `docker build`, output streams live).
async function buildImage() {
  closeModal()
  const m = document.createElement('div')
  m.className = 'modal'
  m.innerHTML = `<div class="box wide"><h3>${ic('hammer', 18)}Build an image</h3>
    <p class="meta">Pick the folder that contains your Dockerfile. It runs <span class="mono">docker build</span>, so .dockerignore and caching work as usual.</p>
    <form>
      <label class="fld">Folder<input type="text" id="bdir" autocomplete="off" spellcheck="false"></label>
      <div id="bpick" class="picker"></div>
      <div class="two"><label class="fld">Image name and tag<input type="text" id="btag" placeholder="myapp:latest" autocomplete="off" spellcheck="false"></label>
      <label class="fld">Dockerfile<select id="bfile"><option>Dockerfile</option></select></label></div>
      <label class="chk"><input type="checkbox" id="bnc"> Do not use the build cache</label>
      <div class="row"><button type="button" class="tb" id="bclose">Close</button><button class="tb pri" id="bgo">${ic('hammer', 15)}<span>Build</span></button></div>
    </form><pre class="log buildlog" id="blog" hidden></pre><div id="berr"></div></div>`
  document.body.append(m)
  const dir = $('#bdir', m), pick = $('#bpick', m), file = $('#bfile', m), log = $('#blog', m)
  let stopBuild = null, seq = 0, tmr
  const closeAll = () => { stopBuild?.(); closeModal() }
  $('#bclose', m).onclick = closeAll
  m.onclick = (e) => { if (e.target === m) closeAll() }
  const list = async (p) => {
    const my = ++seq
    try {
      const d = await api('fs.dirs', p)
      if (my !== seq) return
      dir.value = d.path
      file.innerHTML = (d.files.length ? d.files : ['Dockerfile']).map((f) => `<option>${esc(f)}</option>`).join('')
      pick.innerHTML = (d.parent ? `<div class="drow" data-p="${esc(d.parent)}">${ic('chevright', 14)} ..</div>` : '') +
        (d.files.length ? `<div class="dfound">${ic('info', 14)} Dockerfile found here</div>` : '') +
        d.dirs.map((n) => `<div class="drow" data-p="${esc(d.path.replace(/\/$/, '') + '/' + n)}">${ic('chevright', 14)} ${esc(n)}</div>`).join('')
    } catch (e) { if (my === seq) pick.innerHTML = `<div class="meta hubnote">${esc(e.message)}</div>` }
  }
  pick.onclick = (e) => { const r = e.target.closest('[data-p]'); if (r) list(r.dataset.p) }
  dir.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => list(dir.value), 350) })
  list('')
  $('form', m).onsubmit = (e) => {
    e.preventDefault()
    const go = $('#bgo', m); if (go.disabled) return
    go.disabled = true; $('#berr', m).innerHTML = ''; log.hidden = false; log.textContent = ''
    let pending = '', raf = 0
    stopBuild = stream('build', { dir: dir.value.trim(), tag: $('#btag', m).value.trim(), file: file.value, nocache: $('#bnc', m).checked ? '1' : '0' }, (ev) => {
      if (ev.k === 'data') {
        pending += ev.d
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; log.append(pending); pending = ''; log.scrollTop = log.scrollHeight })
      } else {
        go.disabled = false; stopBuild = null
        if (ev.k === 'end') { toast('Build finished'); window.refresh?.() } else $('#berr', m).innerHTML = `<div class="err">${esc(ev.d)}</div>`
      }
    })
  }
}

// Folder picker used by the export and import dialogs. onFiles receives the archive files seen in the current folder.
function attachPicker(m, dirInput, pickEl, { files = false, onPickFile } = {}) {
  let seq = 0, tmr
  const list = async (p, quiet) => {
    const my = ++seq
    try {
      const d = await api('fs.dirs', p)
      if (my !== seq) return
      dirInput.value = d.path
      pickEl.innerHTML = (d.parent ? `<div class="drow" data-p="${esc(d.parent)}">${ic('arrowup', 14)} ..</div>` : '') +
        d.dirs.map((n) => `<div class="drow" data-p="${esc(d.path.replace(/\/$/, '') + '/' + n)}">${ic('folder', 14)} ${esc(n)}</div>`).join('') +
        (files ? d.tars.map((n) => `<div class="drow file" data-f="${esc(d.path.replace(/\/$/, '') + '/' + n)}">${ic('layers', 14)} ${esc(n)}</div>`).join('') : '')
      if (!quiet && !p && d.dirs.includes('Downloads') && !files) list(d.path + '/Downloads', true) // start in Downloads when it exists
    } catch (e) { if (my === seq && !quiet) pickEl.innerHTML = `<div class="meta hubnote">${esc(e.message)}</div>` }
  }
  pickEl.onclick = (e) => { const r = e.target.closest('[data-p],[data-f]'); if (!r) return; r.dataset.f ? onPickFile?.(r.dataset.f) : list(r.dataset.p) }
  dirInput.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => list(dirInput.value, true), 350) })
  list('')
  return list
}

// Export an image to a .tar (docker save).
function exportImage(ref) {
  closeModal()
  const m = document.createElement('div')
  m.className = 'modal'
  const base = ref.startsWith('sha256:') ? short(ref) : ref.replace(/[^\w.-]+/g, '_')
  m.innerHTML = `<div class="box wide"><h3>${ic('upload', 18)}Export image</h3><p class="meta mono">${esc(ref)}</p>
    <form><label class="fld">Save in folder<input type="text" id="xdir" autocomplete="off" spellcheck="false"></label><div id="xpick" class="picker"></div>
      <label class="fld">File name<input type="text" id="xname" value="${esc(base)}.tar" spellcheck="false"></label>
      <label class="chk"><input type="checkbox" id="xover"> Replace the file if it already exists</label>
      <div class="row"><button type="button" class="tb" id="xclose">Close</button><button class="tb pri" id="xgo">${ic('upload', 15)}<span>Export</span></button></div></form>
    <div id="xstat" class="meta"></div><div id="xerr"></div></div>`
  document.body.append(m)
  let stop = null
  const dir = $('#xdir', m)
  attachPicker(m, dir, $('#xpick', m))
  $('#xclose', m).onclick = () => { stop?.(); closeModal() }
  m.onclick = (e) => { if (e.target === m) { stop?.(); closeModal() } }
  $('form', m).onsubmit = (e) => {
    e.preventDefault()
    const go = $('#xgo', m); if (go.disabled) return
    go.disabled = true; $('#xerr', m).innerHTML = ''; $('#xstat', m).textContent = 'Saving…'
    stop = stream('save', { ref, dir: dir.value.trim(), name: $('#xname', m).value.trim(), overwrite: $('#xover', m).checked ? '1' : '0' }, (ev) => {
      if (ev.k === 'data') $('#xstat', m).textContent = `Saving… ${fmt(ev.d.bytes)}`
      else { go.disabled = false; stop = null
        if (ev.k === 'end') { $('#xstat', m).innerHTML = `Saved ${fmt(ev.d.bytes)} to <span class="mono">${esc(ev.d.path)}</span>`; toast('Image exported') }
        else { $('#xstat', m).textContent = ''; $('#xerr', m).innerHTML = `<div class="err">${esc(ev.d)}</div>` } }
    })
  }
}

// Import an image from a .tar / .tar.gz (docker load).
function importImage() {
  closeModal()
  const m = document.createElement('div')
  m.className = 'modal'
  m.innerHTML = `<div class="box wide"><h3>${ic('download', 18)}Import image</h3><p class="meta">Loads an image archive made with docker save (or Export). Pick a file below or type its path.</p>
    <form><label class="fld">Archive file<input type="text" id="ipath" placeholder="/home/you/Downloads/image.tar" autocomplete="off" spellcheck="false"></label><div id="ipick" class="picker"></div>
      <div class="row"><button type="button" class="tb" id="iclose">Close</button><button class="tb pri" id="igo">${ic('download', 15)}<span>Import</span></button></div></form>
    <div class="bar" id="ibarw" hidden><i id="ibar" style="width:0%"></i></div><div id="istat" class="meta"></div><div id="ierr"></div></div>`
  document.body.append(m)
  let stop = null
  const path = $('#ipath', m), picker = $('#ipick', m)
  // the path box holds the chosen file; the picker browses folders next to it
  const fake = document.createElement('input')
  attachPicker(m, fake, picker, { files: true, onPickFile: (f) => (path.value = f) })
  $('#iclose', m).onclick = () => { stop?.(); closeModal() }
  m.onclick = (e) => { if (e.target === m) { stop?.(); closeModal() } }
  $('form', m).onsubmit = (e) => {
    e.preventDefault()
    const go = $('#igo', m); if (go.disabled || !path.value.trim()) return
    go.disabled = true; $('#ierr', m).innerHTML = ''; $('#ibarw', m).hidden = false
    const loaded = []
    stop = stream('load', { path: path.value.trim() }, (ev) => {
      if (ev.k === 'data') {
        if (ev.d.line) { loaded.push(ev.d.line); $('#istat', m).textContent = loaded.join(' · ') }
        else { $('#ibar', m).style.width = Math.min(100, (ev.d.bytes / ev.d.total) * 100) + '%'; $('#istat', m).textContent = `Reading… ${fmt(ev.d.bytes)} of ${fmt(ev.d.total)}` }
      } else { go.disabled = false; stop = null
        if (ev.k === 'end') { $('#ibar', m).style.width = '100%'; toast(loaded.length ? loaded.join(', ') : 'Image imported'); window.refresh?.() }
        else $('#ierr', m).innerHTML = `<div class="err">${esc(/unexpected EOF|invalid tar|no such file/i.test(ev.d) ? 'That file is not a valid Docker image archive.' : ev.d)}</div>` }
    })
  }
}

function tagImage(ref) {
  const [repo, tag] = ref.startsWith('sha256:') ? ['', 'latest'] : splitRef(ref)
  formModal({ title: 'Tag image', icon: 'layers', intro: 'Adds another name to this image. To push to a registry, start the name with its address, e.g. localhost:5000/myapp or myuser/myapp.',
    fields: [{ name: 'repo', label: 'Name', value: repo, placeholder: 'myuser/myapp' }, { name: 'tag', label: 'Tag', value: tag === '<none>' ? 'latest' : tag, placeholder: 'latest' }],
    submit: 'Tag', run: (v) => api('image.tag', ref, v.repo, v.tag).then(() => toast(`Tagged ${v.repo}:${v.tag}`)) })
}

// Push an image with `docker push`; sign-in lives in Settings → Registries.
function pushImage(ref) {
  closeModal()
  const m = document.createElement('div')
  m.className = 'modal'
  m.innerHTML = `<div class="box wide"><h3>${ic('ext', 18)}Push ${esc(ref)}</h3><pre class="log buildlog" id="plog"></pre><div id="perr"></div>
    <div class="row"><button type="button" class="tb" id="pclose">Close</button></div></div>`
  document.body.append(m)
  const log = $('#plog', m)
  let pending = '', raf = 0
  const stop = stream('push', { ref }, (ev) => {
    if (ev.k === 'data') { pending += ev.d; if (!raf) raf = requestAnimationFrame(() => { raf = 0; log.append(pending); pending = ''; log.scrollTop = log.scrollHeight }) }
    else if (ev.k === 'end') { toast(`Pushed ${ref}`) }
    else $('#perr', m).innerHTML = `<div class="err">${esc(ev.d)}${/no basic auth|denied|unauthorized/i.test(log.textContent) ? '<br>You may need to sign in first: Settings → Registries.' : ''}</div>`
  })
  $('#pclose', m).onclick = () => { stop(); closeModal() }
  m.onclick = (e) => { if (e.target === m) { stop(); closeModal() } }
}

function registryLogin() {
  formModal({ title: 'Sign in to a registry', icon: 'download', intro: 'Leave the registry empty for Docker Hub. For Docker Hub use an access token instead of your password.',
    fields: [{ name: 'server', label: 'Registry (optional)', placeholder: 'ghcr.io, localhost:5000, …' }, { name: 'user', label: 'Username' }, { name: 'password', label: 'Password or access token', type: 'password' }],
    submit: 'Sign in', run: (v) => api('registry.login', v.server, v.user, v.password).then(() => toast('Signed in')) })
}

function pullImage(prefill = '', auto = false) {
  closeModal()
  const m = document.createElement('div')
  m.className = 'modal'
  m.innerHTML = `<div class="box">
    <h3>${ic('download', 18)}Pull image</h3>
    <p class="meta">Downloads from Docker Hub, or any registry if you include its host (e.g. ghcr.io/org/app:tag).</p>
    <form><input type="text" id="pimg" placeholder="Search Docker Hub, or type nginx:latest" autocomplete="off" spellcheck="false"><div id="hubres"></div>
    <div class="row"><button type="button" class="tb" id="pcancel">Close</button><button class="tb pri" id="pgo">${ic('download', 15)}<span>Pull</span></button></div></form>
    <div id="pstat"></div></div>`
  document.body.append(m)
  const input = $('#pimg', m), go = $('#pgo', m), out = $('#pstat', m)
  input.focus()
  $('#pcancel', m).onclick = () => { stopPull?.(); closeModal() }
  m.onclick = (e) => { if (e.target === m) { stopPull?.(); closeModal() } }
  // Docker Hub search-as-you-type (skipped for refs that already carry a tag or registry host)
  let hubTimer, hubSeq = 0
  const hub = $('#hubres', m)
  input.addEventListener('input', () => {
    clearTimeout(hubTimer)
    const term = input.value.trim(), seq = ++hubSeq
    if (term.length < 2 || /[:@]/.test(term)) { hub.innerHTML = ''; return }
    hubTimer = setTimeout(async () => {
      hub.innerHTML = '<div class="meta hubnote">Searching Docker Hub…</div>'
      try {
        const res = await api('hub.search', term)
        if (seq !== hubSeq) return
        hub.innerHTML = res.length ? res.map((r) => `<div class="hubrow" data-name="${esc(r.name)}"><div><span class="nm">${esc(r.name)}</span>${r.is_official ? '<span class="pill running">official</span>' : ''}<div class="meta">${esc((r.description || '').slice(0, 110))}</div></div><span class="meta nw">★ ${r.star_count}</span></div>`).join('') : '<div class="meta hubnote">No results</div>'
      } catch { if (seq === hubSeq) hub.innerHTML = '<div class="meta hubnote">Search unavailable. You can still type a full image name.</div>' }
    }, 450)
  })
  hub.onclick = (e) => { const r = e.target.closest('[data-name]'); if (r) { input.value = r.dataset.name; hub.innerHTML = ''; input.focus() } }
  const layers = new Map()
  const draw = () => {
    out.innerHTML = [...layers].map(([id, l]) => {
      const pct = l.total ? Math.min(100, (l.cur / l.total) * 100) : l.done ? 100 : 0
      return `<div class="layer"><span class="mono">${esc(id)}</span><span class="meta">${esc(l.status)}${l.total ? ` · ${fmt(l.cur)} / ${fmt(l.total)}` : ''}</span><div class="bar"><i style="width:${pct}%"></i></div></div>`
    }).join('')
  }
  m.querySelector('form').onsubmit = (e) => {
    e.preventDefault()
    const name = input.value.trim()
    if (!name || go.disabled) return
    go.disabled = input.disabled = true
    layers.clear(); out.innerHTML = '<div class="meta">Contacting registry… (the first response can take a few seconds)</div>'
    let finished = false
    const done = (ok, msg) => {
      if (finished) return
      finished = true; stopPull = null
      go.disabled = input.disabled = false
      if (ok) { toast(`Pulled ${name}`); closeModal(); window.refresh?.() }
      else out.innerHTML = `<div class="err">${esc(msg)}</div>`
    }
    stopPull = stream('pull', { image: name }, (ev) => {
      if (ev.k === 'error') return done(false, ev.d)
      if (ev.k === 'end') return done(true)
      const d = ev.d
      if (!/^[0-9a-f]{12}$/.test(d.id || '')) return // status lines ("Pulling from …", digest) carry no layer id
      const l = layers.get(d.id) || { status: '', cur: 0, total: 0, done: false }
      l.status = d.status
      if (d.progressDetail?.total) { l.cur = d.progressDetail.current; l.total = d.progressDetail.total }
      if (/complete|exists/i.test(d.status)) l.done = true
      layers.set(d.id, l); draw()
    })
  }
  if (prefill) { input.value = prefill; if (auto) m.querySelector('form').requestSubmit() }
}
let stopPull = null
function closeModal() { $('.modal')?.remove() }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { stopPull?.(); closeModal(); closeDetail() } })

// ---------- Volumes / Networks (shared list behaviour) ----------
const SYSTEM_NETS = new Set(['bridge', 'host', 'none'])
let vList = [], nList = []
const gq = { volumes: '', networks: '' }, gf = { volumes: 'all', networks: 'all' }
const gsel = { volumes: new Set(), networks: new Set() }
const matchUse = (f, used) => f === 'all' || (f === 'inuse' && used) || (f === 'unused' && !used)

const volSize = (v) => (v.UsageData?.Size >= 0 ? v.UsageData.Size : 0)
const visibleVolumes = () => vList.filter((v) => matchUse(gf.volumes, v.usedBy.length > 0) && (!gq.volumes || v.Name.toLowerCase().includes(gq.volumes.toLowerCase())))
const visibleNetworks = () => nList.filter((n) => matchUse(gf.networks, Object.keys(n.Containers || {}).length > 0) && (!gq.networks || n.Name.toLowerCase().includes(gq.networks.toLowerCase())))

const GPAGES = {
  volumes: { rows: visibleVolumes, key: (v) => v.Name, selectable: () => true, del: 'volume.remove', noun: 'volume', redraw: () => ($('#grows').innerHTML = volumeRows()) },
  networks: { rows: visibleNetworks, key: (n) => n.Id, selectable: (n) => !SYSTEM_NETS.has(n.Name), del: 'network.remove', noun: 'network', redraw: () => ($('#grows').innerHTML = networkRows()) }
}
const pills = (names, none = 'Unused') => names.length ? names.map((n) => `<span class="pill running">${esc(n)}</span>`).join(' ') : `<span class="pill">${none}</span>`
const filterSelect = (page) => `<select id="gfilter">${[['all', 'All'], ['inuse', 'In use'], ['unused', 'Unused']].map(([v, l]) => `<option value="${v}" ${gf[page] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`
const searchBox = (page) => `<label class="search">${ic('search', 15)}<input type="text" id="gq" placeholder="Search" value="${esc(gq[page])}"></label>`

function updateGBulk() {
  const b = $('#gbulk'); if (!b) return
  const g = GPAGES[current], set = gsel[current]
  b.classList.toggle('on', set.size > 0)
  b.innerHTML = set.size ? `<b>${set.size} selected</b>${tbtn('trash', 'Delete', call('gbulkdel'), 'dan')}<span class="sp"></span>${tbtn('x', 'Clear', call('gbulkclear'))}` : ''
  const all = $('#gselall'); if (all) { const v = g.rows().filter(g.selectable); all.checked = v.length > 0 && v.every((r) => set.has(g.key(r))) }
}
async function bulkDeleteG() {
  const g = GPAGES[current], set = gsel[current]
  const warn = current === 'volumes' ? ' Their data will be lost.' : ''
  if (!confirm(`Delete ${set.size} ${g.noun}(s)?${warn}`)) return
  const failed = []
  for (const k of [...set]) { try { await api(g.del, k); set.delete(k) } catch (e) { failed.push(e.message) } }
  if (failed.length) toast(failed[0] + (failed.length > 1 ? ` (+${failed.length - 1} more)` : ''), true); else toast('Done')
  window.refresh?.()
}
document.addEventListener('input', (e) => {
  if (e.target.id === 'gq') { gq[current] = e.target.value; GPAGES[current].redraw(); updateGBulk() }
})
document.addEventListener('change', (e) => {
  const t = e.target
  if (t.id === 'gfilter') { gf[current] = t.value; GPAGES[current].redraw(); updateGBulk() }
  else if (t.id === 'gselall') { const g = GPAGES[current]; g.rows().filter(g.selectable).forEach((r) => (t.checked ? gsel[current].add(g.key(r)) : gsel[current].delete(g.key(r)))); g.redraw(); updateGBulk() }
  else if (t.classList.contains('gsel')) { t.checked ? gsel[current].add(t.dataset.key) : gsel[current].delete(t.dataset.key); updateGBulk() }
})

// Small reusable "create something" dialog
function formModal({ title, icon, intro, fields, submit, run }) {
  closeModal()
  const m = document.createElement('div')
  m.className = 'modal'
  m.innerHTML = `<div class="box"><h3>${ic(icon, 18)}${esc(title)}</h3>${intro ? `<p class="meta">${esc(intro)}</p>` : ''}
    <form>${fields.map((f) => `<label class="fld">${esc(f.label)}<input type="${f.type || 'text'}" name="${f.name}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="off" spellcheck="false"></label>`).join('')}
    <div class="row"><button type="button" class="tb" data-x>Cancel</button><button class="tb pri">${ic(icon, 15)}<span>${esc(submit)}</span></button></div></form><div class="merr"></div></div>`
  document.body.append(m)
  m.onclick = (e) => { if (e.target === m || e.target.closest('[data-x]')) closeModal() }
  const form = $('form', m)
  form.elements[fields[0].name].focus()
  form.onsubmit = async (e) => {
    e.preventDefault()
    const v = Object.fromEntries(fields.map((f) => [f.name, f.type === 'password' ? form.elements[f.name].value : form.elements[f.name].value.trim()]))
    try { await run(v); closeModal(); window.refresh?.() } catch (err) { $('.merr', m).innerHTML = `<div class="err">${esc(err.message)}</div>` }
  }
}
const newVolume = () => formModal({ title: 'Create a volume', icon: 'database', fields: [{ name: 'name', label: 'Volume name', placeholder: 'my-data' }], submit: 'Create', run: (v) => api('volume.create', v.name).then(() => toast(`Created volume ${v.name}`)) })
const newNetwork = () => formModal({ title: 'Create a network', icon: 'network', intro: 'Creates a bridge network. Leave the subnet empty to let Docker choose.', fields: [{ name: 'name', label: 'Network name', placeholder: 'my-net' }, { name: 'subnet', label: 'Subnet (optional)', placeholder: '10.20.0.0/24' }], submit: 'Create', run: (v) => api('network.create', v.name, v.subnet).then(() => toast(`Created network ${v.name}`)) })

function showGMenu(btn, page, key) {
  const m = $('#menu')
  const item = (icon, label, callJson) => `<button data-call='${esc(callJson)}'>${ic(icon, 15)}${label}</button>`
  if (page === 'volumes') { const v = vList.find((x) => x.Name === key); if (!v) return
    m.innerHTML = [item('info', 'View details', call('inspectg', 'volume', v.Name, v.Name)), item('copy', 'Copy name', call('copy', v.Name)), item('copy', 'Copy mountpoint', call('copy', v.Mountpoint))].join('')
  } else { const n = nList.find((x) => x.Id === key); if (!n) return
    m.innerHTML = [item('info', 'View details', call('inspectg', 'network', n.Id, n.Name)), item('copy', 'Copy name', call('copy', n.Name)), item('copy', 'Copy ID', call('copy', n.Id))].join('')
  }
  placeMenu(btn)
}

// ---------- Volumes ----------
function volumeRows() {
  return visibleVolumes().map((v) => `<tr class="row-click" data-inspect="volume:${esc(v.Name)}:${esc(v.Name)}">
    <td class="cb"><input type="checkbox" class="gsel" data-key="${esc(v.Name)}" ${gsel.volumes.has(v.Name) ? 'checked' : ''}></td>
    <td><div class="namecell"><span class="nm mono" title="${esc(v.Name)}">${esc(volName(v.Name))}</span>${v.Labels?.['com.docker.volume.anonymous'] !== undefined ? '<span class="pill">anonymous</span>' : ''}</div></td>
    <td>${esc(v.Driver)}</td>
    <td class="nw">${v.CreatedAt ? rel(v.CreatedAt) : ''}</td>
    <td class="nw">${fmt(volSize(v))}</td>
    <td>${pills(v.usedBy)}</td>
    <td><div class="actions">${ibtn('more', 'More actions', call('gmenu', 'volumes', v.Name))}${ibtn('trash', 'Delete', call('confirm', `Delete volume ${volName(v.Name)} and its data?`, 'volume.remove', v.Name), 'dan')}</div></td></tr>`).join('') ||
    `<tr><td colspan="7"><div class="empty">No matching volumes</div></td></tr>`
}
async function volumes() {
  const [list, cs] = await Promise.all([api('volumes.list'), api('containers.list')])
  vList = list.map((v) => ({ ...v, usedBy: cs.filter((c) => (c.Mounts || []).some((m) => m.Name === v.Name)).map(cname) }))
  vList.sort((a, b) => volSize(b) - volSize(a) || a.Name.localeCompare(b.Name))
  for (const k of [...gsel.volumes]) if (!vList.some((v) => v.Name === k)) gsel.volumes.delete(k)
  const inUse = vList.filter((v) => v.usedBy.length).reduce((a, v) => a + volSize(v), 0)
  return `<div class="head"><h2>${ic('database', 22)}Volumes<span class="count">${vList.length}</span></h2>
    <div class="usage"><div><div class="k">${vList.length} volume${vList.length === 1 ? '' : 's'}</div><div class="v"><b>${fmt(inUse)}</b> / ${fmt(vList.reduce((a, v) => a + volSize(v), 0))}</div><div class="s">in use</div></div></div></div>
    <div class="tools">${searchBox('volumes')}${filterSelect('volumes')}<span class="sp"></span>
      ${tbtn('plus', 'Create volume', call('newvol'), 'pri')}${tbtn('broom', 'Prune unused', call('confirm', 'Remove ALL unused volumes? Their data will be lost.', 'volumes.prune'))}</div>
    <div id="gbulk" class="bulk"></div>` +
    (vList.length
      ? `<table><thead><tr><th class="cb"><input type="checkbox" id="gselall" title="Select all"></th><th>Name</th><th>Driver</th><th>Created</th><th>Size</th><th>In use by</th><th class="num">Actions</th></tr></thead><tbody id="grows">${volumeRows()}</tbody></table>`
      : `<div class="empty">${ic('database', 32)}<div>No volumes yet. Create one, or run a container that uses one.</div></div>`)
}

// ---------- Networks ----------
function networkRows() {
  return visibleNetworks().map((n) => {
    const sys = SYSTEM_NETS.has(n.Name), cs = Object.values(n.Containers || {}).map((c) => c.Name)
    return `<tr class="row-click" data-inspect="network:${esc(n.Id)}:${esc(n.Name)}">
    <td class="cb">${sys ? '' : `<input type="checkbox" class="gsel" data-key="${esc(n.Id)}" ${gsel.networks.has(n.Id) ? 'checked' : ''}>`}</td>
    <td><div class="namecell"><span class="nm">${esc(n.Name)}</span>${sys ? '<span class="pill">built-in</span>' : ''}${n.Internal ? '<span class="pill">internal</span>' : ''}</div></td>
    <td>${esc(n.Driver)}</td><td>${esc(n.Scope)}</td>
    <td class="mono">${(n.IPAM?.Config || []).map((c) => esc(c.Subnet) + (c.Gateway ? ' / ' + esc(c.Gateway) : '')).join('<br>') || '–'}</td>
    <td>${pills(cs, 'None')}</td>
    <td class="nw">${n.Created && !n.Created.startsWith('0001') ? rel(n.Created) : ''}</td>
    <td><div class="actions">${ibtn('more', 'More actions', call('gmenu', 'networks', n.Id))}${sys ? '' : ibtn('trash', 'Delete', call('confirm', `Delete network ${n.Name}?`, 'network.remove', n.Id), 'dan')}</div></td></tr>`
  }).join('') || `<tr><td colspan="8"><div class="empty">No matching networks</div></td></tr>`
}
async function networks() {
  nList = await api('networks.list')
  nList.sort((a, b) => SYSTEM_NETS.has(a.Name) - SYSTEM_NETS.has(b.Name) || a.Name.localeCompare(b.Name))
  for (const k of [...gsel.networks]) if (!nList.some((n) => n.Id === k)) gsel.networks.delete(k)
  const used = nList.filter((n) => Object.keys(n.Containers || {}).length).length
  return `<div class="head"><h2>${ic('network', 22)}Networks<span class="count">${nList.length}</span></h2>
    <div class="usage"><div><div class="k">${nList.length} networks</div><div class="v"><b>${used}</b> / ${nList.length}</div><div class="s">in use</div></div></div></div>
    <div class="tools">${searchBox('networks')}${filterSelect('networks')}<span class="sp"></span>
      ${tbtn('plus', 'Create network', call('newnet'), 'pri')}${tbtn('broom', 'Prune unused', call('confirm', 'Remove unused networks?', 'networks.prune'))}</div>
    <div id="gbulk" class="bulk"></div>
    <table><thead><tr><th class="cb"><input type="checkbox" id="gselall" title="Select all"></th><th>Name</th><th>Driver</th><th>Scope</th><th>Subnet / Gateway</th><th>Containers</th><th>Created</th><th class="num">Actions</th></tr></thead><tbody id="grows">${networkRows()}</tbody></table>`
}

// ---------- Inspect drawer for images / volumes / networks ----------
async function openInspect(kind, id, title) {
  closeDetail()
  let obj
  try { obj = await api(kind + '.inspect', id) } catch (e) { return toast(e.message, true) }
  const d = document.createElement('div')
  d.className = 'detail'
  d.innerHTML = `<header>${ic(kind === 'image' ? 'image' : kind === 'volume' ? 'database' : 'network', 18)}<b>${esc(title)}</b><button class="ib" id="x" title="Close">${ic('x')}</button></header><div class="pane"></div>`
  document.body.append(d)
  $('#x', d).onclick = closeDetail
  jsonViewer($('.pane', d), obj, kind)
}
document.addEventListener('click', (e) => {
  const r = e.target.closest('tr[data-inspect]')
  if (r && !e.target.closest('button,a,input,label,select')) { const [k, id, ...t] = r.dataset.inspect.split(':'); const rid = id === 'sha256' ? 'sha256:' + t.shift() : id; k === 'image' ? openImageDetail(rid, t.join(':')) : openInspect(k, rid, t.join(':')) }
})

// ---------- Image details: layers + inspect ----------
// Turn the raw history instruction into something readable ("RUN apt-get …", "ENV PATH=…").
function layerCmd(c) {
  let t = String(c || '').replace(/\s*# buildkit\s*$/, '').replace(/\s+/g, ' ').trim()
  if (t.startsWith('/bin/sh -c #(nop) ')) t = t.slice(18).trim()
  else if (t.startsWith('/bin/sh -c ')) t = 'RUN ' + t.slice(11)
  return t || '(no instruction)'
}
function layersHtml(hist, obj) {
  const layers = [...hist].reverse() // oldest first, like reading the Dockerfile
  const total = layers.reduce((a, l) => a + (l.Size || 0), 0), max = Math.max(1, ...layers.map((l) => l.Size || 0))
  const big = layers.reduce((a, l, i) => ((l.Size || 0) > (layers[a].Size || 0) ? i : a), 0)
  return `<div class="lsum"><div><div class="k">Layers</div><div class="v">${layers.length}</div></div><div><div class="k">Total size</div><div class="v">${fmt(total)}</div></div>
    <div><div class="k">Largest layer</div><div class="v">${fmt(layers[big]?.Size || 0)}</div><div class="s">#${big + 1}</div></div><div><div class="k">Platform</div><div class="v small">${esc(obj.Os)}/${esc(obj.Architecture)}</div></div></div>
    <table class="layers"><thead><tr><th>#</th><th>Size</th><th>Created</th><th>Instruction</th></tr></thead><tbody>${layers.map((l, i) => {
      const cmd = layerCmd(l.CreatedBy), sz = l.Size || 0
      return `<tr class="${i === big && sz > 0 ? 'bigl' : ''}"><td class="nw meta">${i + 1}</td>
        <td class="nw"><div class="lsz">${sz ? fmt(sz) : '<span class="meta">0 B</span>'}</div><div class="lbar"><i style="width:${(sz / max) * 100}%"></i></div></td>
        <td class="nw meta">${l.Created ? rel(new Date(l.Created * 1000).toISOString()) : ''}</td>
        <td class="mono lcmd" title="${esc(cmd)}">${esc(cmd.length > 240 ? cmd.slice(0, 240) + '…' : cmd)}${(l.Tags || []).length ? ` <span class="pill running">${esc(l.Tags.join(', '))}</span>` : ''}</td></tr>`
    }).join('')}</tbody></table>`
}
async function openImageDetail(id, title, first = 'Layers') {
  closeDetail()
  let obj, hist
  try { [obj, hist] = await Promise.all([api('image.inspect', id), api('image.history', id)]) } catch (e) { return toast(e.message, true) }
  const d = document.createElement('div')
  d.className = 'detail'
  d.innerHTML = `<header>${ic('image', 18)}<b>${esc(title)}</b><span class="meta mono">${esc(short(obj.Id))}</span><button class="ib" id="x" title="Close">${ic('x')}</button></header>
    <div class="tabs">${[['Layers', 'layers'], ['Inspect', 'box']].map(([t, i]) => `<a data-t="${t}">${ic(i, 14)}${t}</a>`).join('')}</div><div class="pane"></div>`
  document.body.append(d)
  $('#x', d).onclick = closeDetail
  const pane = $('.pane', d)
  const tab = (t) => {
    d.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.t === t))
    pane.className = 'pane'; pane.innerHTML = ''
    t === 'Layers' ? (pane.innerHTML = layersHtml(hist, obj)) : jsonViewer(pane, obj, 'image')
  }
  d.querySelector('.tabs').onclick = (e) => { const t = e.target.closest('[data-t]')?.dataset.t; if (t) tab(t) }
  tab(first)
}

// ---------- Container overview ----------
function overview(info) {
  const row = (k, v) => (v ? `<tr><th>${k}</th><td class="mono">${v}</td></tr>` : '')
  const net = info.NetworkSettings
  const ports = Object.entries(net.Ports || {}).map(([p, b]) => esc(p) + (b ? ' → ' + b.map((x) => esc(x.HostIp + ':' + x.HostPort)).join(', ') : ' (not published)')).join('<br>')
  const nets = Object.entries(net.Networks || {}).map(([n, v]) => `${esc(n)} — ${esc(v.IPAddress || 'no IP')}${v.Gateway ? ' (gw ' + esc(v.Gateway) + ')' : ''}`).join('<br>')
  const mounts = (info.Mounts || []).map((m) => `${esc(m.Name ? volName(m.Name) : m.Source)} → ${esc(m.Destination)} <span class="meta">${m.Type}${m.RW ? '' : ', read-only'}</span>`).join('<br>')
  const list = (a) => (a || []).map(esc).join('<br>')
  const st = info.State
  return `<table class="kv"><tbody>
    ${row('ID', esc(info.Id.slice(0, 12)))}
    ${row('Image', esc(info.Config.Image))}
    ${row('Command', esc([info.Path, ...(info.Args || [])].join(' ')))}
    ${row('Status', esc(st.Status) + (st.Running ? ` since ${esc(st.StartedAt)}` : ` (exit code ${st.ExitCode})`) + (st.Health ? ` · health: ${esc(st.Health.Status)}` : ''))}
    ${row('Created', esc(info.Created))}
    ${row('Restart policy', esc(info.HostConfig.RestartPolicy?.Name || 'no') + (info.RestartCount ? ` (restarted ${info.RestartCount}×)` : ''))}
    ${row('Ports', ports)}${row('Networks', nets)}${row('Mounts', mounts)}
    ${row('Working dir', esc(info.Config.WorkingDir))}${row('User', esc(info.Config.User))}
    ${row('Memory limit', info.HostConfig.Memory ? fmt(info.HostConfig.Memory) : '')}
    ${row('Privileged', info.HostConfig.Privileged ? 'yes' : '')}
  </tbody></table>
  <details><summary>Environment (${(info.Config.Env || []).length})</summary><div class="mono pad">${list(info.Config.Env)}</div></details>
  <details><summary>Labels (${Object.keys(info.Config.Labels || {}).length})</summary><div class="mono pad">${list(Object.entries(info.Config.Labels || {}).map(([k, v]) => `${k}=${v}`))}</div></details>`
}

// ---------- Container detail drawer ----------
let stops = []
function closeDetail() { stops.forEach((f) => f()); stops = []; $('.detail')?.remove() }

async function openDetail(id, first = 'Overview') {
  closeDetail()
  let info
  try { info = await api('container.inspect', id) } catch (e) { return toast(e.message, true) }
  const d = document.createElement('div')
  d.className = 'detail'
  d.innerHTML = `<header><span class="dot ${info.State.Status}"></span><b>${esc(info.Name.replace(/^\//, ''))}</b><span class="meta mono">${esc(info.Config.Image)}</span><button class="ib" id="x" title="Close">${ic('x')}</button></header>
    <div class="tabs">${[['Overview', 'info'], ['Logs', 'logs'], ['Stats', 'activity'], ['Files', 'folder'], ['Settings', 'sliders'], ['Inspect', 'box']].map(([t, i]) => `<a data-t="${t}">${ic(i, 14)}${t}</a>`).join('')}</div><div class="pane"></div>`
  document.body.append(d)
  $('#x', d).onclick = closeDetail
  const running = info.State.Running
  const tab = async (t) => {
    stops.forEach((f) => f()); stops = []
    d.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.t === t))
    const pane = $('.pane', d)
    pane.innerHTML = ''; pane.className = 'pane'
    if (t === 'Overview') pane.innerHTML = overview(info)
    else if (t === 'Settings') containerSettings(pane, info)
    else if (t === 'Files') filesTab(pane, info)
    else if (t === 'Inspect') jsonViewer(pane, info, 'container')
    else if (!running && t !== 'Logs') pane.innerHTML = '<div class="empty">Container is not running</div>'
    else if (t === 'Logs') logsTab(pane, info)
    else if (t === 'Stats') statsTab(pane, info)
  }
  d.querySelector('.tabs').onclick = (e) => { const t = e.target.closest('[data-t]')?.dataset.t; if (t) tab(t) }
  tab(first)
}

// ---------- Container files: browse, preview, upload, download ----------
function filesTab(pane, info) {
  const id = info.Id
  let cwd = '/'
  const dl = (kind, p) => `/download/${kind}?id=${encodeURIComponent(id)}&path=${encodeURIComponent(p)}&t=${encodeURIComponent(TOKEN)}`
  const join = (n) => (cwd === '/' ? '/' + n : cwd + '/' + n)
  pane.classList.add('flush')
  pane.innerHTML = `<div class="fv"><div class="fbar">
      <button class="ib" id="fup" title="Parent folder">${ic('arrowup')}</button><button class="ib" id="fref" title="Refresh">${ic('restart')}</button>
      <input type="text" id="fpath" value="/" spellcheck="false" autocomplete="off">
      <button class="tb" id="fupl">${ic('upload', 14)}<span>Upload</span></button><input type="file" id="ffile" multiple hidden>
      <a class="tb" id="ftar" title="Download this folder as a .tar">${ic('download', 14)}<span>Folder</span></a></div>
    <div class="fnote" id="fnote" hidden></div><div class="flist" id="flist"></div></div>`
  const list = $('#flist', pane), note = $('#fnote', pane), pathIn = $('#fpath', pane)
  const sync = () => { pathIn.value = cwd; $('#ftar', pane).href = dl('tar', cwd) }
  const rowHtml = (e) => {
    const isDir = e.type === 'd', isLink = e.type === 'l'
    const icon = isDir ? 'folder' : isLink ? 'link' : 'logs'
    return `<div class="frow" data-name="${esc(e.name)}" data-type="${e.type}"><span class="ficon ${isDir ? 'dir' : ''}">${ic(icon, 16)}</span>
      <span class="fname">${esc(e.name)}${isLink ? ` <span class="meta">→ ${esc(e.target || '')}</span>` : ''}</span>
      <span class="fsize meta">${isDir ? '' : fmt(e.size)}</span><span class="fdate meta">${esc(e.date)}</span><span class="fperm meta mono">${esc(e.perms)} ${esc(e.owner)}</span>
      <span class="factions">${isDir ? '' : `<a class="ib" title="Download" href="${dl('file', join(e.name))}" download>${ic('download')}</a>`}</span></div>`
  }
  const load = async (p) => {
    list.innerHTML = '<div class="meta fpad">Loading…</div>'; note.hidden = true
    try {
      const d = await api('container.ls', id, p)
      cwd = d.path; sync()
      list.innerHTML = (cwd !== '/' ? `<div class="frow" data-name=".." data-type="d"><span class="ficon dir">${ic('folder', 16)}</span><span class="fname">..</span></div>` : '') + (d.entries.map(rowHtml).join('') || '<div class="meta fpad">This folder is empty.</div>')
    } catch (e) {
      cwd = p; sync(); list.innerHTML = ''
      note.hidden = false
      note.innerHTML = `${ic('info', 16)}<div>${esc(e.message)}<div class="meta">You can still upload into the path above, or download a file or folder by path: <a class="link" href="${dl('file', p)}" download>download this path as a file</a> · <a class="link" href="${dl('tar', p)}" download>as a .tar</a></div></div>`
    }
  }
  const preview = async (p) => {
    let r
    try { r = await api('container.cat', id, p) } catch (e) { return toast(e.message, true) }
    if (r.kind === 'dir') return load(p)
    if (r.kind === 'other') return toast('That is not a regular file', true)
    closeModal()
    const m = document.createElement('div')
    m.className = 'modal'
    const lines = r.binary ? [] : r.text.split('\n'), shown = lines.slice(0, 5000)
    m.innerHTML = `<div class="box wide pv"><h3>${ic('logs', 18)}<span class="mono">${esc(p)}</span></h3>
      <div class="meta">${fmt(r.size)}${r.truncated ? ' · showing the first 256 kB' : ''}${lines.length > 5000 ? ' · showing the first 5,000 lines' : ''}</div>
      ${r.binary ? `<div class="empty small">${ic('box', 26)}<div>Binary file. Download it to open it.</div></div>`
        : `<div class="jcode pvcode">${shown.map((l, i) => `<div class="jl"><span class="jno">${i + 1}</span><span class="jt">${esc(l)}</span></div>`).join('')}</div>`}
      <div class="row"><a class="tb" href="${dl('file', p)}" download>${ic('download', 14)}<span>Download</span></a><button type="button" class="tb" id="pvc">Close</button></div></div>`
    document.body.append(m)
    $('#pvc', m).onclick = closeModal
    m.onclick = (e) => { if (e.target === m) closeModal() }
  }
  list.onclick = async (e) => {
    const row = e.target.closest('.frow'); if (!row || e.target.closest('a')) return
    const n = row.dataset.name, t = row.dataset.type
    if (n === '..') return load(cwd.replace(/\/[^/]+\/?$/, '') || '/')
    if (t === 'd') return load(join(n))
    if (t === 'l') { try { await api('container.ls', id, join(n)); return load(join(n)) } catch {} } // a link to a folder opens it; otherwise preview it
    preview(join(n))
  }
  const upload = async (files) => {
    let ok = 0
    for (const f of files) {
      toast(`Uploading ${f.name}…`)
      try {
        const r = await fetch(`/upload?id=${encodeURIComponent(id)}&path=${encodeURIComponent(cwd)}&name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'X-Token': TOKEN }, body: f })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Upload failed')
        ok++
      } catch (err) { toast(`${f.name}: ${err.message}`, true); break }
    }
    if (ok) { toast(`Uploaded ${ok} file${ok === 1 ? '' : 's'}`); load(cwd) }
  }
  $('#fup', pane).onclick = () => load(cwd.replace(/\/[^/]+\/?$/, '') || '/')
  $('#fref', pane).onclick = () => load(cwd)
  pathIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(pathIn.value.trim() || '/') })
  $('#fupl', pane).onclick = () => $('#ffile', pane).click()
  $('#ffile', pane).onchange = (e) => { upload([...e.target.files]); e.target.value = '' }
  const fv = $('.fv', pane)
  fv.addEventListener('dragover', (e) => { e.preventDefault(); fv.classList.add('drop') })
  fv.addEventListener('dragleave', () => fv.classList.remove('drop'))
  fv.addEventListener('drop', (e) => { e.preventDefault(); fv.classList.remove('drop'); if (e.dataTransfer.files.length) upload([...e.dataTransfer.files]) })
  load('/')
}

function containerSettings(pane, info) {
  const hc = info.HostConfig
  const mem = hc.Memory ? Math.round(hc.Memory / 1048576) : '', cpu = hc.NanoCpus ? hc.NanoCpus / 1e9 : ''
  const pol = hc.RestartPolicy?.Name || 'no'
  pane.innerHTML = `<form class="cform">
    <label class="fld">Name<input type="text" id="cs-name" value="${esc(info.Name.replace(/^\//, ''))}" spellcheck="false"></label>
    <label class="fld">Restart policy<select id="cs-restart">${[['no', 'Never'], ['unless-stopped', 'Unless stopped'], ['always', 'Always'], ['on-failure', 'On failure']].map(([v, l]) => `<option value="${v}" ${pol === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="two"><label class="fld">Memory limit (MB)<input type="text" id="cs-mem" value="${mem}" placeholder="unlimited" inputmode="numeric"></label>
    <label class="fld">CPUs<input type="text" id="cs-cpu" value="${cpu}" placeholder="unlimited" inputmode="decimal"></label></div>
    <div class="meta">Applies immediately, without restarting the container. Docker can raise or lower a limit but can't remove one from an existing container: leave a field unchanged to keep it, or recreate the container to go back to unlimited.</div>
    <div><button class="tb pri" id="cs-save">${ic('copy', 15)}<span>Save changes</span></button></div></form>`
  $('.cform', pane).onsubmit = async (e) => {
    e.preventDefault()
    try {
      await api('container.update', info.Id, { name: $('#cs-name', pane).value.trim(), restart: $('#cs-restart', pane).value, memoryMb: Number($('#cs-mem', pane).value) || 0, cpus: Number($('#cs-cpu', pane).value) || 0 })
      toast('Saved'); window.refresh?.(); openDetail(info.Id, 'Settings')
    } catch (err) { toast(err.message, true) }
  }
}

// ---------- Log viewer: search, filter, colours, download ----------
const ANSI_COLOR = { 30: 'a30', 31: 'a31', 32: 'a32', 33: 'a33', 34: 'a34', 35: 'a35', 36: 'a36', 37: 'a37', 90: 'a90', 91: 'a91', 92: 'a92', 93: 'a93', 94: 'a94', 95: 'a95', 96: 'a96', 97: 'a97' }
// Split a line with ANSI colour codes into [{t: text, c: css classes}] (other escape sequences are dropped).
function ansiSegs(raw) {
  const segs = [], re = /\x1b\[([0-9;?]*)([A-Za-z])/g
  let last = 0, fg = '', bold = false, m
  const push = (t) => { if (t) segs.push({ t, c: [fg, bold ? 'ab' : ''].filter(Boolean).join(' ') }) }
  while ((m = re.exec(raw))) {
    push(raw.slice(last, m.index)); last = re.lastIndex
    if (m[2] !== 'm') continue
    for (const code of (m[1] || '0').split(';').map(Number)) {
      if (code === 0) { fg = ''; bold = false }
      else if (code === 1) bold = true
      else if (code === 22) bold = false
      else if (code === 39) fg = ''
      else if (ANSI_COLOR[code]) fg = ANSI_COLOR[code]
    }
  }
  push(raw.slice(last))
  return segs.length ? segs : [{ t: '', c: '' }]
}
const plainOf = (raw) => raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
// HTML for one line, with <mark> around search matches (matches can span colour changes).
function logLineHtml(raw, q) {
  const segs = ansiSegs(raw)
  const wrap = (txt, c, mk) => (txt ? (() => { let h = esc(txt); if (mk) h = `<mark>${h}</mark>`; return c ? `<span class="${c}">${h}</span>` : h })() : '')
  if (!q) return segs.map((x) => wrap(x.t, x.c, false)).join('')
  const low = segs.map((x) => x.t).join('').toLowerCase(), ql = q.toLowerCase(), marks = []
  for (let i = low.indexOf(ql); i >= 0; i = low.indexOf(ql, i + ql.length)) marks.push([i, i + ql.length])
  if (!marks.length) return segs.map((x) => wrap(x.t, x.c, false)).join('')
  let out = '', pos = 0, mi = 0
  for (const sg of segs) {
    const start = pos, end = pos + sg.t.length
    let cur = start
    while (cur < end) {
      while (mi < marks.length && marks[mi][1] <= cur) mi++
      if (mi < marks.length && marks[mi][0] <= cur) { const e = Math.min(end, marks[mi][1]); out += wrap(sg.t.slice(cur - start, e - start), sg.c, true); cur = e }
      else { const e = mi < marks.length ? Math.min(end, marks[mi][0]) : end; out += wrap(sg.t.slice(cur - start, e - start), sg.c, false); cur = e }
    }
    pos = end
  }
  return out
}
const lineLevel = (p) => (/\b(error|err|fatal|panic|exception|critical)\b/i.test(p) ? 'lvl-err' : /\b(warn|warning)\b/i.test(p) ? 'lvl-warn' : '')

function logsTab(pane, info) {
  const id = info.Id, name = info.Name.replace(/^\//, '')
  const o = { tail: '300', ts: false, follow: true, wrap: false, only: false, q: '' }
  const MAX = 20000
  let lines = [], partial = '', rendered = 0, marksEl = [], cur = -1, raf = 0, stopStream = null, state = 'connecting'
  pane.classList.add('flush')
  pane.innerHTML = `<div class="lv"><div class="lbar2">
      <label class="search">${ic('search', 14)}<input type="text" id="lq" placeholder="Search logs" autocomplete="off" spellcheck="false"></label>
      <button class="ib" id="lprev" title="Previous match (Shift+Enter)">${ic('chevup')}</button><button class="ib" id="lnext" title="Next match (Enter)">${ic('chevdown')}</button><span class="meta" id="lcount"></span>
      <label class="chk"><input type="checkbox" id="lonly"> Only matching</label><span class="sp"></span>
      <select id="ltail" title="How many past lines to load">${[['100', 'Last 100'], ['300', 'Last 300'], ['1000', 'Last 1,000'], ['5000', 'Last 5,000'], ['all', 'All']].map(([v, l]) => `<option value="${v}" ${v === o.tail ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="chk"><input type="checkbox" id="lts"> Timestamps</label><label class="chk"><input type="checkbox" id="lwrap"> Wrap</label><label class="chk"><input type="checkbox" id="lfollow" checked> Follow</label>
      <button class="tb" id="lclear" title="Clear what is shown (does not delete the container's logs)">${ic('x', 14)}<span>Clear</span></button>
      <a class="tb" id="ldl" title="Download all logs as a .log file">${ic('download', 14)}<span>Download</span></a></div>
    <div class="lscroll" id="lscroll"><div id="llines"></div></div><div class="lstat meta" id="lstat"></div></div>`
  const scroll = $('#lscroll', pane), box = $('#llines', pane), q = $('#lq', pane)
  const visible = (raw) => !o.only || !o.q || plainOf(raw).toLowerCase().includes(o.q.toLowerCase())
  const mk = (raw) => { const d = document.createElement('div'); d.className = 'll ' + lineLevel(plainOf(raw)); d.innerHTML = logLineHtml(raw, o.q) || ' '; return d }
  const status = () => { $('#lstat', pane).textContent = `${lines.length.toLocaleString()} line${lines.length === 1 ? '' : 's'} · ${state}${lines.length >= MAX ? ' · oldest lines dropped' : ''}` }
  const refreshMarks = () => {
    marksEl = [...box.querySelectorAll('mark')]
    $('#lcount', pane).textContent = o.q ? (marksEl.length ? `${cur >= 0 ? cur + 1 : 0} / ${marksEl.length}` : 'No matches') : ''
  }
  const flushDom = () => {
    raf = 0
    if (rendered < lines.length) {
      const frag = document.createDocumentFragment()
      for (; rendered < lines.length; rendered++) if (visible(lines[rendered])) frag.append(mk(lines[rendered]))
      box.append(frag)
    }
    status(); refreshMarks()
    if (o.follow) scroll.scrollTop = scroll.scrollHeight
  }
  const renderAll = () => {
    box.textContent = ''; rendered = 0; cur = -1
    flushDom()
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(flushDom) }
  const ingest = (text) => {
    partial += text.replace(/\r/g, '')
    const parts = partial.split('\n'); partial = parts.pop()
    if (!parts.length) return
    lines.push(...parts)
    if (lines.length > MAX) { lines = lines.slice(-MAX + 2000); renderAll(); return }
    schedule()
  }
  const startStream = () => {
    stopStream?.(); lines = []; partial = ''; state = 'streaming'; renderAll()
    stopStream = stream('logs', { id, tail: o.tail, ts: o.ts ? '1' : '0' }, (m) => {
      if (m.k === 'data') ingest(m.d)
      else { if (partial) { lines.push(partial); partial = '' } state = m.k === 'end' ? 'stream ended (the container stopped or was removed)' : 'error: ' + m.d; schedule() }
    })
    stops.push(() => stopStream?.())
    setDl()
  }
  const setDl = () => { $('#ldl', pane).href = `/download/logs?id=${encodeURIComponent(id)}&tail=all&timestamps=${o.ts ? 1 : 0}&t=${encodeURIComponent(TOKEN)}` }
  const goMark = (i) => {
    if (!marksEl.length) return
    cur = (i + marksEl.length) % marksEl.length
    marksEl.forEach((m) => m.classList.remove('cur')); marksEl[cur].classList.add('cur')
    o.follow = false; $('#lfollow', pane).checked = false
    marksEl[cur].scrollIntoView({ block: 'center' })
    $('#lcount', pane).textContent = `${cur + 1} / ${marksEl.length}`
  }
  let tmr
  q.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => { o.q = q.value; renderAll(); if (o.q && marksEl.length) goMark(0) }, 180) })
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); goMark(cur + (e.shiftKey ? -1 : 1)) } })
  $('#lnext', pane).onclick = () => goMark(cur + 1)
  $('#lprev', pane).onclick = () => goMark(cur - 1)
  $('#lonly', pane).onchange = (e) => { o.only = e.target.checked; renderAll() }
  $('#lwrap', pane).onchange = (e) => scroll.classList.toggle('wrap', (o.wrap = e.target.checked))
  $('#lfollow', pane).onchange = (e) => { o.follow = e.target.checked; if (o.follow) scroll.scrollTop = scroll.scrollHeight }
  $('#lts', pane).onchange = (e) => { o.ts = e.target.checked; startStream() }
  $('#ltail', pane).onchange = (e) => { o.tail = e.target.value; startStream() }
  $('#lclear', pane).onclick = () => { lines = []; partial = ''; renderAll() }
  // scrolling up pauses follow; reaching the bottom again resumes it
  scroll.addEventListener('scroll', () => {
    const atBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 24
    if (atBottom !== o.follow && !raf) { o.follow = atBottom; $('#lfollow', pane).checked = atBottom }
  })
  startStream()
}

// ---------- JSON viewer (Inspect): section chips, line numbers, syntax colours, search ----------
const CHIPS = {
  container: [['Platform', 'Platform'], ['Cmd', 'Config/Cmd'], ['State', 'State'], ['Image', 'Config/Image'], ['Env', 'Config/Env'], ['Labels', 'Config/Labels'], ['Mounts', 'Mounts'], ['Volumes', 'Config/Volumes'],
    ['PortBindings', 'HostConfig/PortBindings'], ['Runtime', 'HostConfig/Runtime'], ['Networks', 'NetworkSettings/Networks'], ['HostConfig', 'HostConfig'], ['Config', 'Config'], ['GraphDriver', 'GraphDriver']],
  image: [['Architecture', 'Architecture'], ['Os', 'Os'], ['Cmd', 'Config/Cmd'], ['Entrypoint', 'Config/Entrypoint'], ['Env', 'Config/Env'], ['ExposedPorts', 'Config/ExposedPorts'], ['Labels', 'Config/Labels'], ['RootFS', 'RootFS'], ['Metadata', 'Metadata'], ['Config', 'Config']],
  volume: [['Labels', 'Labels'], ['Options', 'Options'], ['Mountpoint', 'Mountpoint'], ['UsageData', 'UsageData']],
  network: [['IPAM', 'IPAM'], ['Containers', 'Containers'], ['Options', 'Options'], ['Labels', 'Labels']]
}

// Pretty-print into one HTML string per line, remembering which line each key path starts on.
function jsonModel(obj) {
  const lines = [], paths = new Map()
  const scalar = (v) => (typeof v === 'string' ? `<span class="js">${esc(JSON.stringify(v))}</span>` : typeof v === 'number' ? `<span class="jnum">${v}</span>` : `<span class="jb">${v}</span>`)
  const walk = (v, depth, path, key, comma) => {
    const pad = '  '.repeat(depth), k = key === null ? '' : `<span class="jk">${esc(JSON.stringify(String(key)))}</span>: `
    if (path) paths.set(path, lines.length)
    if (v !== null && typeof v === 'object') {
      const arr = Array.isArray(v), keys = arr ? v.map((_, i) => i) : Object.keys(v)
      if (!keys.length) { lines.push(pad + k + (arr ? '[]' : '{}') + comma); return }
      lines.push(pad + k + (arr ? '[' : '{'))
      keys.forEach((kk, i) => walk(v[kk], depth + 1, path ? `${path}/${kk}` : String(kk), arr ? null : kk, i < keys.length - 1 ? ',' : ''))
      lines.push(pad + (arr ? ']' : '}') + comma)
    } else lines.push(pad + k + scalar(v) + comma)
  }
  walk(obj, 0, '', null, '')
  return { lines, paths }
}

function jsonViewer(pane, obj, kind) {
  const { lines, paths } = jsonModel(obj)
  const plain = lines.map((l) => l.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
  const spec = CHIPS[kind] || Object.entries(obj).filter(([, v]) => v && typeof v === 'object').slice(0, 12).map(([k]) => [k, k])
  const chips = spec.filter(([, p]) => paths.has(p)).map(([label, p]) => ({ label, line: paths.get(p) })).sort((a, b) => a.line - b.line)
  pane.classList.add('flush')
  pane.innerHTML = `<div class="jv">
    <div class="jchips">${chips.map((c) => `<button class="jchip" data-line="${c.line}">${esc(c.label)}</button>`).join('')}</div>
    <div class="jbar"><label class="search">${ic('search', 14)}<input type="text" id="jq" placeholder="Search in JSON" autocomplete="off" spellcheck="false"></label>
      <button class="ib" id="jprev" title="Previous match">${ic('chevup')}</button><button class="ib" id="jnext" title="Next match (Enter)">${ic('chevdown')}</button><span class="meta" id="jcount"></span>
      <span class="sp"></span><label class="chk"><input type="checkbox" id="jwrap"> Wrap</label><button class="tb" id="jcopy">${ic('copy', 14)}<span>Copy</span></button></div>
    <div class="jcode" id="jcode"><div class="jlines">${lines.map((l, i) => `<div class="jl"><span class="jno">${i + 1}</span><span class="jt">${l}</span></div>`).join('')}</div></div></div>`
  const code = $('#jcode', pane), rows = code.querySelectorAll('.jl'), chipEls = pane.querySelectorAll('.jchip'), q = $('#jq', pane)
  const flash = (i) => { rows[i].classList.add('flash'); setTimeout(() => rows[i].classList.remove('flash'), 1400) }
  const scrollTo = (i, center) => code.scrollTo({ top: Math.max(0, rows[i].offsetTop - (center ? code.clientHeight / 2 : 0)), behavior: 'smooth' })
  const setActive = (idx) => chipEls.forEach((el, i) => el.classList.toggle('on', i === idx))
  let quiet = 0 // after a chip click, ignore scroll-spy briefly so the clicked chip stays highlighted
  chipEls.forEach((el, i) => (el.onclick = () => { const l = +el.dataset.line; quiet = Date.now() + 800; setActive(i); scrollTo(l); flash(l) }))
  let raf
  code.addEventListener('scroll', () => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      if (Date.now() < quiet) return
      let active = -1
      chips.forEach((c, i) => { if (rows[c.line].offsetTop <= code.scrollTop + 4) active = i })
      setActive(active)
    })
  })
  // search
  let hits = [], cur = -1, tmr
  const show = () => {
    rows.forEach((r) => r.classList.remove('cur'))
    if (cur < 0) return
    rows[hits[cur]].classList.add('cur'); scrollTo(hits[cur], true)
    $('#jcount', pane).textContent = `${cur + 1} / ${hits.length}`
  }
  const search = () => {
    const t = q.value.toLowerCase()
    rows.forEach((r) => r.classList.remove('hit', 'cur'))
    hits = t ? plain.map((x, i) => (x.toLowerCase().includes(t) ? i : -1)).filter((i) => i >= 0) : []
    hits.forEach((i) => rows[i].classList.add('hit'))
    cur = hits.length ? 0 : -1
    $('#jcount', pane).textContent = t && !hits.length ? 'No matches' : ''
    show()
  }
  const step = (d) => { if (hits.length) { cur = (cur + d + hits.length) % hits.length; show() } }
  q.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(search, 150) })
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1) } })
  $('#jnext', pane).onclick = () => step(1)
  $('#jprev', pane).onclick = () => step(-1)
  $('#jwrap', pane).onchange = (e) => code.classList.toggle('wrap', e.target.checked)
  $('#jcopy', pane).onclick = async () => (await copyText(JSON.stringify(obj, null, 2))) ? toast('Copied JSON') : toast('Could not copy', true)
}

// ---------- Container stats: tiles with live sparklines and per-second rates ----------
function statsTab(pane, info) {
  pane.innerHTML = `<div id="s" class="stats"><div class="meta">Waiting for the first sample…</div></div>`
  const h = { cpu: [], mem: [], net: [], io: [] }
  const keep = (a, v) => { a.push(v); if (a.length > 60) a.shift() }
  let prev = null
  const cores = engine.ncpu || 1
  const started = Date.parse(info.State?.StartedAt || '')
  const tile = (icon, title, big, sub, pct, sp) => `<div class="stile"><div class="sk">${ic(icon, 14)}${title}</div><div class="sv">${big}</div><div class="ss">${sub}</div>${pct == null ? '' : `<div class="bar"><i style="width:${pct}%"></i></div>`}<div class="sparkwrap">${sp}</div></div>`
  const peak = (a, min) => Math.max(min, ...a)
  stops.push(stream('stats', { id: info.Id }, (m) => {
    if (m.k !== 'data') return
    const s = m.d, now = Date.now()
    let rx = 0, tx = 0, rd = 0, wr = 0
    if (prev) {
      const dt = Math.max(0.2, (now - prev.t) / 1000), d = (a, b) => Math.max(0, (a - b) / dt)
      rx = d(s.netRx, prev.s.netRx); tx = d(s.netTx, prev.s.netTx); rd = d(s.blkRead, prev.s.blkRead); wr = d(s.blkWrite, prev.s.blkWrite)
    }
    prev = { s, t: now }
    keep(h.cpu, s.cpu); keep(h.mem, s.memUsed); keep(h.net, rx + tx); keep(h.io, rd + wr)
    const limited = s.memLimit && (!engine.memTotal || s.memLimit < engine.memTotal * 0.98)
    const memPct = limited ? Math.min(100, (s.memUsed / s.memLimit) * 100) : engine.memTotal ? Math.min(100, (s.memUsed / engine.memTotal) * 100) : 0
    const up = started ? rel(info.State.StartedAt).replace(' ago', '') : ''
    $('#s', pane).innerHTML = `
      <div class="shead"><span class="live"></span><b>Live</b><span class="meta">${s.pids} process${s.pids === 1 ? '' : 'es'}${up ? ' · up ' + esc(up) : ''} · updates every second</span></div>
      ${tile('activity', 'CPU', s.cpu.toFixed(2) + '%', `of ${cores} CPUs · ${(s.cpu / cores).toFixed(1)}% of capacity`, Math.max(Math.min(100, s.cpu / cores), s.cpu > 0 ? 1 : 0), spark(h.cpu, peak(h.cpu, 5)))}
      ${tile('database', 'Memory', fmt(s.memUsed), limited ? `of ${fmt(s.memLimit)} limit · ${memPct.toFixed(1)}%` : `no limit · ${memPct.toFixed(1)}% of this computer`, Math.max(memPct, s.memUsed > 0 ? 1 : 0), spark(h.mem, limited ? s.memLimit : peak(h.mem, 1)))}
      ${tile('network', 'Network', `<span class="dn">↓</span> ${fmt(rx)}/s <span class="up2">↑</span> ${fmt(tx)}/s`, `total ↓ ${fmt(s.netRx)} · ↑ ${fmt(s.netTx)}`, null, spark(h.net, peak(h.net, 1024)))}
      ${tile('download', 'Disk I/O', `<span class="dn">R</span> ${fmt(rd)}/s <span class="up2">W</span> ${fmt(wr)}/s`, `total read ${fmt(s.blkRead)} · written ${fmt(s.blkWrite)}`, null, spark(h.io, peak(h.io, 1024)))}`
  }))
}

// ---------- Docked terminal (host shell + container shells) ----------
const dock = { tabs: [], active: null }
const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s) })
let xtermReady
const loadXterm = () => (xtermReady ||= (async () => {
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'vendor/xterm.css'; document.head.append(l)
  await loadScript('vendor/xterm.js'); await loadScript('vendor/addon-fit.js')
})())

const fitActive = () => requestAnimationFrame(() => { const t = dock.active; if (t) { try { t.fit.fit() } catch {} t.term.focus() } })

function renderDockTabs() {
  $('#dock-tabs').innerHTML = dock.tabs.map((t) =>
    `<div class="dtab ${t === dock.active ? 'on' : ''}" data-tab="${t.id}">${ic('terminal', 14)}<span>${esc(t.title)}</span><button class="ib" data-close="${t.id}" title="Close tab">${ic('x', 13)}</button></div>`).join('')
  $('#dock-ctl').innerHTML = `<button class="ib" data-newshell title="New host shell">${ic('plus')}</button><button class="ib" data-hidedock title="Hide panel">${ic('chevdown')}</button>`
}
function activate(tab) {
  dock.active = tab
  dock.tabs.forEach((t) => t.el.classList.toggle('on', t === tab))
  renderDockTabs(); fitActive()
}
function setDockHidden(h) { $('#dock').hidden = h; renderStatus(); if (!h) fitActive() }
function toggleDock() {
  if (!dock.tabs.length) return openTerm('shell')
  setDockHidden(!$('#dock').hidden)
}
function closeTab(tab) {
  tab.stop?.(); tab.ro?.disconnect(); tab.term.dispose(); tab.el.remove()
  dock.tabs = dock.tabs.filter((t) => t !== tab)
  if (!dock.tabs.length) { dock.active = null; renderDockTabs(); setDockHidden(true) } else activate(dock.tabs[dock.tabs.length - 1])
}

async function openTerm(kind, id = '', title = 'Host shell') {
  if (dock.tabs.length >= 3) return toast('Close a terminal tab first (3 max)', true)
  try { await loadXterm() } catch { return toast('Could not load the terminal', true) }
  const el = document.createElement('div'); el.className = 'term-pane'; $('#dock-body').append(el)
  const term = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: 'ui-monospace, Menlo, monospace', theme: termTheme() })
  const fit = new FitAddon.FitAddon(); term.loadAddon(fit)
  const tab = { id: crypto.randomUUID(), title, el, term, fit }
  dock.tabs.push(tab)
  $('#dock').hidden = false
  activate(tab) // makes the pane visible so xterm can measure it
  term.open(el); fit.fit()
  const post = (m, body) => fetch('/api/' + m, { method: 'POST', headers: { 'X-Token': TOKEN }, body: JSON.stringify({ sid: tab.id, ...body }) }).catch(() => {})
  let sized = false
  tab.stop = stream(kind === 'shell' ? 'shell' : 'exec', { id, sid: tab.id }, (m) => {
    if (m.k === 'data') { term.write(m.d); if (!sized) { sized = true; post('exec.resize', { cols: term.cols, rows: term.rows }) } } // session exists once output starts
    if (m.k === 'end') term.write('\r\n\x1b[2m[session closed]\x1b[0m')
    if (m.k === 'error') term.write('\r\n' + m.d)
  })
  term.onData((data) => post('exec.write', { data }))
  term.onResize(({ cols, rows }) => sized && post('exec.resize', { cols, rows }))
  tab.ro = new ResizeObserver(() => { if (dock.active === tab) try { fit.fit() } catch {} })
  tab.ro.observe(el)
  renderStatus()
}

$('#dock').addEventListener('click', (e) => {
  const close = e.target.closest('[data-close]'), tabEl = e.target.closest('[data-tab]')
  if (close) return closeTab(dock.tabs.find((t) => t.id === close.dataset.close))
  if (tabEl) return activate(dock.tabs.find((t) => t.id === tabEl.dataset.tab))
  if (e.target.closest('[data-newshell]')) return openTerm('shell')
  if (e.target.closest('[data-hidedock]')) setDockHidden(true)
})
$('#grip').onmousedown = (e) => {
  e.preventDefault()
  const dockEl = $('#dock'), y0 = e.clientY, h0 = dockEl.offsetHeight
  const move = (ev) => (dockEl.style.height = Math.min(innerHeight * 0.75, Math.max(110, h0 + y0 - ev.clientY)) + 'px')
  const up = () => {
    removeEventListener('mousemove', move); removeEventListener('mouseup', up)
    fitActive()
    try { localStorage.setItem('dockh', dockEl.style.height) } catch {}
  }
  addEventListener('mousemove', move); addEventListener('mouseup', up)
}
try { const h = localStorage.getItem('dockh'); if (h) $('#dock').style.height = h } catch {}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu() })

const [startPage, startId] = START.split('/')
nav(); renderStatus()
go(PAGES[startPage] ? startPage : 'dashboard')
checkDaemon(); refreshInfo(); refreshStats(); startEvents(); loadHistory()
if (startId) openDetail(startId, 'Overview') // deep link: #containers/<id or name>
if (startPage === 'shell') openTerm('shell') // deep link: #shell
