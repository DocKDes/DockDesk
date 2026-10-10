// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { TR } from '../i18n.js'
import { translateString } from '../translate.js'

// native dialogs are not part of the page, so translate their text here
export const confirm = (m) => window.confirm(translateString(m))
export const prompt = (m, d) => window.prompt(translateString(m), d)
export const TOKEN = new URLSearchParams(location.search).get('t') || sessionStorage.getItem('t') || ''
sessionStorage.setItem('t', TOKEN)
export const START = location.hash.slice(1)
history.replaceState(null, '', location.pathname) // keep the token out of the URL bar

export const $ = (s, el = document) => el.querySelector(s)
export const $$ = (s, el = document) => el.querySelectorAll(s)
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export const fmt = (n) => {
  if (!n) return '0 B'
  const u = ['B', 'kB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1000)))
  return (n / 1000 ** i).toFixed(i ? 1 : 0) + ' ' + u[i]
}
export const rel = (iso) => {
  const t = Date.parse(iso)
  if (!t || t < 946684800000) return 'Never' // Docker uses year 0001 for "never started"
  const s = (Date.now() - t) / 1000
  if (s < 60) return 'just now'
  for (const [n, u] of [[86400, 'day'], [3600, 'hour'], [60, 'minute']]) if (s >= n) { const k = Math.floor(s / n); return `${k} ${u}${k > 1 ? 's' : ''} ago` }
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch {}
  try {
    const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'
    document.body.append(t); t.select()
    const ok = document.execCommand('copy'); t.remove(); return ok
  } catch { return false }
}

// Shell-quote one word for a command we hand to the user.
export const shq = (x) => (/^[\w@%+=:,./-]+$/.test(String(x)) ? String(x) : `'${String(x).replace(/'/g, `'\\''`)}'`)
// "Copy as command" button for a dialog: puts the equivalent docker command on the clipboard.
export function cliButton(root, getCmd, { after = null } = {}) {
  const b = document.createElement('button')
  b.type = 'button'; b.className = 'tb cli'; b.title = 'Copy the equivalent docker command'
  b.innerHTML = `${ic('terminal', 15)}<span>Copy as command</span>`
  b.onclick = async () => {
    let c; try { c = getCmd() } catch (e) { return toast(e.message, true) }
    if (!c) return
    const ok = await copyText(c)
    toast(ok ? 'Copied: ' + (c.length > 70 ? c.slice(0, 67) + '…' : c) : 'Could not copy', !ok)
  }
  if (after) after.insertAdjacentElement('afterend', b)
  else { const row = $('.row', root); row.prepend(b); b.insertAdjacentHTML('afterend', '<span class="sp"></span>') }
  return b
}
// A published-port link with a small copy button next to it.
export const portLink = (port, label) => `<a href="#" data-call='${esc(call('open.url', 'http://localhost:' + port))}' class="port">${label}</a><a href="#" class="pcopy" title="Copy http://localhost:${port}" data-call='${esc(call('copy', 'http://localhost:' + port))}'>${ic('copy', 12)}</a>`

export async function api(method, ...args) {
  const r = await fetch('/api/' + method, { method: 'POST', headers: { 'X-Token': TOKEN }, body: JSON.stringify(args) })
  const t = await r.text()
  let j = null
  try { j = t ? JSON.parse(t) : null } catch { j = t }
  if (!r.ok) throw new Error(j?.error || t || r.statusText)
  return j
}

let toastTimer
export function toast(msg, err) {
  const t = $('#toast')
  t.textContent = msg
  t.className = err ? 'err' : ''
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (t.hidden = true), err ? 6000 : 2500)
}
export async function act(label, fn, after) {
  try { await fn(); if (label) toast(label); await after?.() } catch (e) { toast(e.message, true) }
}

// Server-sent stream helper; returns a stop function.
export function stream(kind, params, onMsg) {
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
export const ic = (n, s = 16) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`
// Icon-only button with a tooltip.
export const ibtn = (icon, title, callJson, cls = '') =>
  `<button class="ib ${cls}" title="${esc(title)}" aria-label="${esc(title)}" data-call='${esc(callJson)}'>${ic(icon)}</button>`
// Text button with a leading icon.
export const tbtn = (icon, label, callJson, cls = '') =>
  `<button class="tb ${cls}" data-call='${esc(callJson)}'>${ic(icon, 15)}<span>${label}</span></button>`
export const call = (...a) => JSON.stringify(a)

// ---------- engine / resource state (feeds sidebar pill, footer, containers header) ----------
export const SETTINGS_DEFAULTS = { refresh: 3, stats: true, notify: false, alertCpu: 0, alertMem: 0, lang: 'auto', autoUpdate: false } // alertCpu: CPU % (0 = off); alertMem: % of the container's memory limit (0 = off)
export const settings = (() => { try { return { ...SETTINGS_DEFAULTS, ...JSON.parse(localStorage.getItem('settings') || '{}') } } catch { return { ...SETTINGS_DEFAULTS } } })()
// Translation: the English text is the key; anything without a translation stays English. {n}-style placeholders are filled from vars.
export const langCode = () => { const l = settings.lang === 'auto' ? (navigator.language || 'en').slice(0, 2).toLowerCase() : settings.lang; return TR[l] ? l : 'en' }
export const tr = (text, vars) => { let r = TR[langCode()]?.[text] ?? text; if (vars) for (const [k, v] of Object.entries(vars)) r = r.replaceAll(`{${k}}`, v); return r }
export const saveSettings = () => { try { localStorage.setItem('settings', JSON.stringify(settings)) } catch {} }
