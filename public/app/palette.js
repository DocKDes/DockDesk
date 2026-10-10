// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { cexp, composeEditor } from './compose.js'
import { openDetail } from './container-detail.js'
import { cname } from './containers.js'
import { $, act, api, esc, fmt, ic, tr } from './core.js'
import { buildImage, closeModal, importImage, pullImage } from './dialogs.js'
import { openImageDetail, openInspect } from './image-detail.js'
import { volName } from './images.js'
import { LABS, startLab } from './labs.js'
import { nList, newNetwork, newVolume } from './lists.js'
import { runImage } from './run-dialog.js'
import { checkForUpdate } from './settings.js'
import { PAGES, go, hideMenu, theme, toggleTheme } from './shell.js'
import { engine } from './state.js'
import { openTerm, toggleDock } from './terminal.js'

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
export async function openPalette() {
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
    ['terminal', 'Keyboard shortcuts', () => openShortcuts()], ['arrowup', 'Check for DockDesk updates', () => checkForUpdate()],
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
  else if (e.key === '?' && !typing && !pal?.isConnected && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if ($('.modal.keys')) closeModal(); else if (!$('.modal')) openShortcuts() }
  else if (!typing && !pal?.isConnected && !$('.modal') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (gPending) { const to = G_KEYS[e.key]; gPending = false; clearTimeout(gTimer); if (to) { e.preventDefault(); go(to) } }
    else if (e.key === 'g') { gPending = true; clearTimeout(gTimer); gTimer = setTimeout(() => (gPending = false), 1200) }
    else if (e.key === 't') toggleDock()
    else if (e.key === 'r') window.refresh?.()
  }
})
// ---------- Keyboard shortcuts cheat sheet ----------
let gPending = false, gTimer
const G_KEYS = { o: 'dashboard', m: 'compose', c: 'containers', i: 'images', v: 'volumes', n: 'networks', l: 'labs', a: 'activity', s: 'settings' }
export function openShortcuts() {
  closeModal()
  const k = (...keys) => keys.map((x) => `<kbd>${esc(x)}</kbd>`).join(' ')
  const group = (title, rows) => `<div class="dsub">${esc(tr(title))}</div><table class="keytbl"><tbody>${rows.map(([keys, d]) => `<tr><td class="nw">${keys}</td><td>${esc(tr(d))}</td></tr>`).join('')}</tbody></table>`
  const m = document.createElement('div')
  m.className = 'modal keys'
  m.innerHTML = `<div class="box wide"><h3>${ic('terminal', 18)}${esc(tr('Keyboard shortcuts'))}</h3>
    <div class="keys-body">
    ${group('Anywhere', [[`${k('Ctrl', 'K')} ${esc(tr('or'))} ${k('/')}`, 'Open search and commands'], [k('?'), 'Show this cheat sheet'], [k('Esc'), 'Close the open dialog, drawer or menu'], [k('t'), 'Show or hide the terminal'], [k('r'), 'Refresh the current page']])}
    ${group('Go to a page (press g, then…)', [[k('g', 'o'), 'Overview'], [k('g', 'm'), 'Compose'], [k('g', 'c'), 'Containers'], [k('g', 'i'), 'Images'], [k('g', 'v'), 'Volumes'], [k('g', 'n'), 'Networks'], [k('g', 'l'), 'Labs'], [k('g', 'a'), 'Activity'], [k('g', 's'), 'Settings']])}
    ${group('In search', [[`${k('↑')} ${k('↓')}`, 'Move through the results'], [k('Enter'), 'Run the selected result']])}
    ${group('In the log viewer', [[k('Enter'), 'Next match'], [`${k('Shift')} ${k('Enter')}`, 'Previous match']])}
    </div>
    <div class="row"><button type="button" class="tb pri" data-x>${esc(tr('Close'))}</button></div></div>`
  document.body.append(m)
  m.onclick = (e) => { if (e.target === m || e.target.closest('[data-x]')) closeModal() }
}
