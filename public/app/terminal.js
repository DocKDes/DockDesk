// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { $, TOKEN, esc, ic, stream, toast } from './core.js'
import { renderStatus, termTheme } from './shell.js'

// ---------- Docked terminal (host shell + container shells) ----------
export const dock = { tabs: [], active: null }
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
export function toggleDock() {
  if (!dock.tabs.length) return openTerm('shell')
  setDockHidden(!$('#dock').hidden)
}
function closeTab(tab) {
  tab.stop?.(); tab.ro?.disconnect(); tab.term.dispose(); tab.el.remove()
  dock.tabs = dock.tabs.filter((t) => t !== tab)
  if (!dock.tabs.length) { dock.active = null; renderDockTabs(); setDockHidden(true) } else activate(dock.tabs[dock.tabs.length - 1])
}

export async function openTerm(kind, id = '', title = 'Host shell') {
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
