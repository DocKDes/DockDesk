// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { $, act, api, call, confirm, esc, fmt, ibtn, ic, portLink, rel, tbtn, tr } from './core.js'
import { setLastHtml } from './shell.js'
import { applyStats, engine, refreshStats } from './state.js'

// ---------- Containers ----------
export const cname = (c) => (c.Names?.[0] || c.Id.slice(0, 12)).replace(/^\//, '')
export const pubPorts = (c) => [...new Map((c.Ports || []).filter((p) => p.PublicPort).map((p) => [p.PublicPort, p])).values()]
export let cq = '', onlyRunning = false, onlyStopped = false, cList = []
export const sel = new Set() // selected container ids (survives re-renders)

const visible = () => {
  const q = cq.toLowerCase()
  return cList.filter((c) => (!onlyRunning || c.State === 'running') && (!onlyStopped || c.State !== 'running') && (!q || (cname(c) + ' ' + c.Image + ' ' + c.Id).toLowerCase().includes(q)))
}

export function containerRows() {
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
      <td class="mono">${pubPorts(c).map((p) => portLink(p.PublicPort, `${p.PublicPort}:${p.PrivatePort}`)).join(' ') || '–'}</td>
      <td class="nw">${rel(c.StartedAt)}</td>
      <td class="num" data-cpu="${c.Id}" data-run="${up ? 1 : 0}">${up ? '–' : '0%'}</td>
      <td><div class="actions">${toggle}${ibtn('more', 'More actions', call('menu', c.Id))}${ibtn('trash', 'Delete', call('confirm', `Delete ${cname(c)}?`, 'container.remove', c.Id, true), 'dan')}</div></td></tr>`
  }).join('') || `<tr><td colspan="8"><div class="empty">No matching containers</div></td></tr>`
}

export async function containers() {
  cList = await api('containers.table')
  cList.sort((a, b) => (b.State === 'running') - (a.State === 'running') || Date.parse(b.StartedAt || 0) - Date.parse(a.StartedAt || 0))
  for (const id of [...sel]) if (!cList.some((c) => c.Id === id)) sel.delete(id)
  const running = cList.filter((c) => c.State === 'running').length
  return `<div class="head"><h2>${ic('box', 22)}${tr('Containers')}<span class="count">${cList.length}</span></h2>
    <div class="usage">
      <div><div class="k">Container CPU usage</div><div class="v"><b id="u-cpu">–</b> / ${engine.ncpu ? engine.ncpu * 100 : '…'}%</div><div class="s">(${engine.ncpu || '…'} CPUs allocated)</div></div>
      <div><div class="k">Container memory usage</div><div class="v"><b id="u-mem">–</b> / ${fmt(engine.memTotal)}</div><div class="s">${running} running</div></div>
    </div></div>
    <div class="tools">
      <label class="search">${ic('search', 15)}<input type="text" id="cq" placeholder="Search" value="${esc(cq)}"></label>
      <label class="switch"><input type="checkbox" id="crun" ${onlyRunning ? 'checked' : ''}>Only show running containers</label>
      <label class="switch"><input type="checkbox" id="cstop" ${onlyStopped ? 'checked' : ''}>Only show stopped</label>
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
export function afterContainers() { updateBulk(); applyStats() }

export async function bulk(action) {
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
  if (t.id === 'crun' || t.id === 'cstop') {
    if (t.id === 'crun') { onlyRunning = t.checked; if (t.checked) onlyStopped = false } else { onlyStopped = t.checked; if (t.checked) onlyRunning = false }
    $('#crun').checked = onlyRunning; $('#cstop').checked = onlyStopped
    setLastHtml(''); $('#rows').innerHTML = containerRows(); afterContainers()
  }
  else if (t.id === 'selall') { visible().forEach((c) => (t.checked ? sel.add(c.Id) : sel.delete(c.Id))); $('#rows').innerHTML = containerRows(); afterContainers() }
  else if (t.classList.contains('sel')) { t.checked ? sel.add(t.dataset.id) : sel.delete(t.dataset.id); updateBulk() }
})

// "More actions" (kebab) menu
export function showMenu(btn, id) {
  const c = cList.find((x) => x.Id === id); if (!c) return
  const m = $('#menu')
  const up = c.State === 'running', port = pubPorts(c)[0]
  const item = (icon, label, callJson, cls = '') => `<button class="${cls}" data-call='${esc(callJson)}'>${ic(icon, 15)}${label}</button>`
  m.innerHTML = [
    up && port ? item('ext', `Open localhost:${port.PublicPort}`, call('open.url', `http://localhost:${port.PublicPort}`)) : '',
    port ? item('copy', `Copy http://localhost:${port.PublicPort}`, call('copy', `http://localhost:${port.PublicPort}`)) : '',
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
export const setOnlyRunning = (v) => { onlyRunning = v } // other modules cannot assign to an imported binding
export const setOnlyStopped = (v) => { onlyStopped = v } // other modules cannot assign to an imported binding
export const setCList = (v) => { cList = v } // other modules cannot assign to an imported binding
