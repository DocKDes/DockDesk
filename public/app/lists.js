// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { placeMenu } from './compose.js'
import { cname } from './containers.js'
import { $, api, call, cliButton, confirm, esc, fmt, ibtn, ic, rel, shq, tbtn, toast, tr } from './core.js'
import { closeModal } from './dialogs.js'
import { volName } from './images.js'
import { current } from './shell.js'

// ---------- Volumes / Networks (shared list behaviour) ----------
const SYSTEM_NETS = new Set(['bridge', 'host', 'none'])
export let vList = [], nList = []
export const gq = { volumes: '', networks: '' }, gf = { volumes: 'all', networks: 'all' }
export const gsel = { volumes: new Set(), networks: new Set() }
const matchUse = (f, used) => f === 'all' || (f === 'inuse' && used) || (f === 'unused' && !used)

const volSize = (v) => (v.UsageData?.Size >= 0 ? v.UsageData.Size : 0)
const visibleVolumes = () => vList.filter((v) => matchUse(gf.volumes, v.usedBy.length > 0) && (!gq.volumes || v.Name.toLowerCase().includes(gq.volumes.toLowerCase())))
const visibleNetworks = () => nList.filter((n) => matchUse(gf.networks, Object.keys(n.Containers || {}).length > 0) && !(gf.networks === 'unused' && SYSTEM_NETS.has(n.Name)) && (!gq.networks || n.Name.toLowerCase().includes(gq.networks.toLowerCase())))

export const GPAGES = {
  volumes: { rows: visibleVolumes, key: (v) => v.Name, selectable: () => true, del: 'volume.remove', noun: 'volume', redraw: () => ($('#grows').innerHTML = volumeRows()) },
  networks: { rows: visibleNetworks, key: (n) => n.Id, selectable: (n) => !SYSTEM_NETS.has(n.Name), del: 'network.remove', noun: 'network', redraw: () => ($('#grows').innerHTML = networkRows()) }
}
const pills = (names, none = 'Unused') => names.length ? names.map((n) => `<span class="pill running">${esc(n)}</span>`).join(' ') : `<span class="pill">${none}</span>`
const filterSelect = (page) => `<select id="gfilter">${[['all', 'All'], ['inuse', 'In use'], ['unused', 'Unused']].map(([v, l]) => `<option value="${v}" ${gf[page] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`
const searchBox = (page) => `<label class="search">${ic('search', 15)}<input type="text" id="gq" placeholder="Search" value="${esc(gq[page])}"></label>`

export function updateGBulk() {
  const b = $('#gbulk'); if (!b) return
  const g = GPAGES[current], set = gsel[current]
  b.classList.toggle('on', set.size > 0)
  b.innerHTML = set.size ? `<b>${set.size} selected</b>${tbtn('trash', 'Delete', call('gbulkdel'), 'dan')}<span class="sp"></span>${tbtn('x', 'Clear', call('gbulkclear'))}` : ''
  const all = $('#gselall'); if (all) { const v = g.rows().filter(g.selectable); all.checked = v.length > 0 && v.every((r) => set.has(g.key(r))) }
}
export async function bulkDeleteG() {
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
export function formModal({ title, icon, intro, fields, submit, run, cli }) {
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
  const values = () => Object.fromEntries(fields.map((f) => [f.name, f.type === 'password' ? form.elements[f.name].value : form.elements[f.name].value.trim()]))
  if (cli) cliButton(m, () => cli(values()))
  form.onsubmit = async (e) => {
    e.preventDefault()
    const v = values()
    try { await run(v); closeModal(); window.refresh?.() } catch (err) { $('.merr', m).innerHTML = `<div class="err">${esc(err.message)}</div>` }
  }
}
export const newVolume = () => formModal({ title: 'Create a volume', icon: 'database', fields: [{ name: 'name', label: 'Volume name', placeholder: 'my-data' }], submit: 'Create', cli: (v) => `docker volume create ${shq(v.name)}`, run: (v) => api('volume.create', v.name).then(() => toast(`Created volume ${v.name}`)) })
export const newNetwork = () => formModal({ title: 'Create a network', icon: 'network', intro: 'Creates a bridge network. Leave the subnet empty to let Docker choose.', fields: [{ name: 'name', label: 'Network name', placeholder: 'my-net' }, { name: 'subnet', label: 'Subnet (optional)', placeholder: '10.20.0.0/24' }], submit: 'Create', cli: (v) => `docker network create${v.subnet ? ' --subnet ' + shq(v.subnet) : ''} ${shq(v.name)}`, run: (v) => api('network.create', v.name, v.subnet).then(() => toast(`Created network ${v.name}`)) })

export function showGMenu(btn, page, key) {
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
export async function volumes() {
  const [list, cs] = await Promise.all([api('volumes.list'), api('containers.list')])
  vList = list.map((v) => ({ ...v, usedBy: cs.filter((c) => (c.Mounts || []).some((m) => m.Name === v.Name)).map(cname) }))
  vList.sort((a, b) => volSize(b) - volSize(a) || a.Name.localeCompare(b.Name))
  for (const k of [...gsel.volumes]) if (!vList.some((v) => v.Name === k)) gsel.volumes.delete(k)
  const inUse = vList.filter((v) => v.usedBy.length).reduce((a, v) => a + volSize(v), 0)
  return `<div class="head"><h2>${ic('database', 22)}${tr('Volumes')}<span class="count">${vList.length}</span></h2>
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
export async function networks() {
  nList = await api('networks.list')
  nList.sort((a, b) => SYSTEM_NETS.has(a.Name) - SYSTEM_NETS.has(b.Name) || a.Name.localeCompare(b.Name))
  for (const k of [...gsel.networks]) if (!nList.some((n) => n.Id === k)) gsel.networks.delete(k)
  const used = nList.filter((n) => Object.keys(n.Containers || {}).length).length
  return `<div class="head"><h2>${ic('network', 22)}${tr('Networks')}<span class="count">${nList.length}</span></h2>
    <div class="usage"><div><div class="k">${nList.length} networks</div><div class="v"><b>${used}</b> / ${nList.length}</div><div class="s">in use</div></div></div></div>
    <div class="tools">${searchBox('networks')}${filterSelect('networks')}<span class="sp"></span>
      ${tbtn('plus', 'Create network', call('newnet'), 'pri')}${tbtn('broom', 'Prune unused', call('confirm', 'Remove unused networks?', 'networks.prune'))}</div>
    <div id="gbulk" class="bulk"></div>
    <table><thead><tr><th class="cb"><input type="checkbox" id="gselall" title="Select all"></th><th>Name</th><th>Driver</th><th>Scope</th><th>Subnet / Gateway</th><th>Containers</th><th>Created</th><th class="num">Actions</th></tr></thead><tbody id="grows">${networkRows()}</tbody></table>`
}
