// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { compose } from './compose.js'
import { closeDetail } from './container-detail.js'
import { afterContainers, containers } from './containers.js'
import { $, api, call, esc, fmt, ibtn, ic, settings, tbtn, tr } from './core.js'
import { dashboard } from './dashboard.js'
import { activityPage, eventsLive } from './events.js'
import { images, updateIBulk } from './images.js'
import { labsPage } from './labs.js'
import { networks, updateGBulk, volumes } from './lists.js'
import { settingsPage } from './settings.js'
import { applyStats, engine, refreshInfo, refreshStats, totals, updateAvail } from './state.js'
import { dock } from './terminal.js'

// ---------- theme ----------
export function theme() { return document.documentElement.dataset.theme }
// v: 'auto' (follow the system) | 'light' | 'dark'
export function applyTheme(v) {
  try { v === 'auto' ? localStorage.removeItem('theme') : localStorage.setItem('theme', v) } catch {}
  document.documentElement.dataset.theme = v === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : v
  dock.tabs.forEach((t) => (t.term.options.theme = termTheme()))
  renderStatus()
}
export const toggleTheme = () => applyTheme(theme() === 'light' ? 'dark' : 'light')
export const termTheme = () => theme() === 'light'
  ? { background: '#ffffff', foreground: '#1b1f24', cursor: '#1b1f24', selectionBackground: '#b6d4fe' }
  : { background: '#0f1419' }

// ---------- shell: sidebar, footer, routing ----------
export const PAGES = {
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
export let current = 'dashboard'
export let timer, gen = 0, lastHtml = '', lastTickAt = 0

export function nav() {
  $('#nav').innerHTML =
    '<h1><img src="icon.png" width="22" height="22" alt="">DockDesk</h1>' +
    `<button class="palbtn" data-call='["palette"]' title="Search everything (Ctrl K or /)">${ic('search', 15)}<span>${tr('Search…')}</span><kbd>Ctrl K</kbd></button>` +
    Object.entries(PAGES).map(([k, [l, i]]) => `<a data-p="${k}" class="${k === current ? 'on' : ''}">${ic(i, 18)}<span>${tr(l)}</span></a>`).join('') +
    `<div class="engine" data-call='["engine"]' title="${tr(engine.up ? 'Click to stop the Docker engine' : 'Click to start the Docker engine')}"><span class="dot ${engine.up ? 'up' : 'down'}"></span>${tr(engine.up ? 'Engine running' : 'Engine stopped')}</div>`
}
$('#nav').onclick = (e) => { const p = e.target.closest('[data-p]')?.dataset.p; if (p) go(p) }

export function renderStatus() {
  const t = totals()
  const dockOpen = !$('#dock').hidden
  $('#status').innerHTML = `
    <span>RAM ${fmt(t.mem)}</span><span>CPU ${t.cpu.toFixed(2)}%</span><span>Disk ${fmt(engine.disk)} used</span>
    <span class="sp"></span>
    ${updateAvail ? `<button data-call='["goto","settings"]' class="upd" title="${esc(tr('A newer version is available. Open Settings.'))}">${ic('arrowup', 14)}${esc(tr('Update available'))} v${esc(updateAvail.latest)}</button>` : ''}
    <button data-call='["dock"]' class="${dockOpen ? 'on' : ''}">${ic('terminal', 14)}${tr('Terminal')}</button>
    <button data-call='["shortcuts"]' title="${esc(tr('Keyboard shortcuts'))} (?)"><b>?</b></button>
    <button data-call='["theme"]' title="${esc(tr('Switch theme'))}">${ic(theme() === 'light' ? 'moon' : 'sun', 14)}</button>
    ${engine.version ? `<span>v${esc(engine.version)}</span>` : ''}`
}

export const go_ = (p) => go(p) // alias usable where 'go' is shadowed
export function go(p) {
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

export async function checkDaemon() {
  const b = $('#banner')
  const was = engine.up
  let html = ''
  try { await api('ping'); engine.up = true } catch {
    engine.up = false
    let d = {}
    try { d = await api('engine.diag') } catch {}
    const cmd = `sudo usermod -aG docker ${d.user || '$USER'}`
    if (d.exists && !d.access && d.groupPending) {
      html = `<div>${ic('info', 18)}</div><div class="bn"><b>Docker access is waiting for a new login</b>
        <div>You were added to the <span class="mono">docker</span> group, but this session started before that, so it can't use Docker yet. ${d.canRelaunch ? 'DockDesk can restart itself with the group applied. No need to log out.' : 'Log out and back in, or start DockDesk with <span class="mono">sg docker -c dockdesk</span>.'}</div></div>${d.canRelaunch ? tbtn('restart', 'Restart with Docker access', call('relaunch'), 'pri') : ''}`
    } else if (d.exists && !d.access) {
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

export function hideMenu() { $('#menu').hidden = true }
export const setLastHtml = (v) => { lastHtml = v } // other modules cannot assign to an imported binding
