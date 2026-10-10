// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { cname } from './containers.js'
import { $, api, call, confirm, esc, fmt, ibtn, ic, rel, tbtn, toast, tr } from './core.js'
import { closeModal } from './dialogs.js'
import { layerCmd } from './image-detail.js'

// ---------- Image updates and comparison ----------
const iUpdates = new Map() // image ref -> true (a newer version is in the registry) | false | null (could not tell)
let iChecking = false
export async function checkImageUpdates() {
  if (iChecking) return
  const refs = iList.filter((r) => !r.dangling && !r.ref.startsWith('sha256:')).map((r) => r.ref)
  if (!refs.length) return toast('No tagged images to check')
  iChecking = true; toast(`Checking ${refs.length} image${refs.length === 1 ? '' : 's'} against their registries…`)
  let i = 0
  const worker = async () => {
    while (i < refs.length) {
      const ref = refs[i++]
      try { iUpdates.set(ref, (await api('image.update.check', ref)).update) } catch { iUpdates.set(ref, null) }
      if ($('#irows')) $('#irows').innerHTML = imageRows()
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  iChecking = false
  const n = [...iUpdates.values()].filter((v) => v === true).length
  toast(n ? `${n} image${n === 1 ? ' has' : 's have'} an update available` : 'Everything checked is up to date')
}

// Side-by-side comparison of two images: size, config, environment and layers.
export async function compareImages(a = '') {
  closeModal()
  const opts = iList.map((r) => ({ v: r.ref, l: r.dangling ? `${short(r.id)} (untagged)` : r.ref }))
  if (opts.length < 2) return toast('You need at least two images to compare', true)
  const m = document.createElement('div')
  m.className = 'modal'
  const sel = (id, cur) => `<select id="${id}">${opts.map((o) => `<option value="${esc(o.v)}" ${o.v === cur ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`
  const second = opts.find((o) => o.v !== a)?.v
  m.innerHTML = `<div class="box xwide"><h3>${ic('layers', 18)}Compare images</h3>
    <div class="two"><label class="fld">Image A${sel('cmpa', a || opts[0].v)}</label><label class="fld">Image B${sel('cmpb', a ? second : opts[1].v)}</label></div>
    <div id="cmpout" class="cmp"></div>
    <div class="row"><button type="button" class="tb" id="cmpx">Close</button><button type="button" class="tb pri" id="cmpgo">${ic('layers', 15)}<span>Compare</span></button></div></div>`
  document.body.append(m)
  m.onclick = (e) => { if (e.target === m) closeModal() }
  $('#cmpx', m).onclick = closeModal
  const out = $('#cmpout', m)
  const load = async (ref) => { const [o, h] = await Promise.all([api('image.inspect', ref), api('image.history', ref)]); return { o, h } }
  const envOf = (o) => Object.fromEntries((o.Config?.Env || []).map((e) => { const k = e.indexOf('='); return k < 0 ? [e, ''] : [e.slice(0, k), e.slice(k + 1)] }))
  const run = async () => {
    const ra = $('#cmpa', m).value, rb = $('#cmpb', m).value
    if (ra === rb) { out.innerHTML = '<div class="meta">Pick two different images.</div>'; return }
    out.innerHTML = '<div class="meta">Comparing…</div>'
    let A, B
    try { [A, B] = await Promise.all([load(ra), load(rb)]) } catch (e) { out.innerHTML = `<div class="err">${esc(e.message)}</div>`; return }
    const val = (x) => (Array.isArray(x) ? x.join(' ') : x == null ? '' : typeof x === 'object' ? Object.keys(x).join(', ') : String(x))
    const rows = [
      ['Size', fmt(A.o.Size), fmt(B.o.Size)],
      ['Layers', String((A.o.RootFS?.Layers || []).length), String((B.o.RootFS?.Layers || []).length)],
      ['Created', A.o.Created?.slice(0, 19).replace('T', ' '), B.o.Created?.slice(0, 19).replace('T', ' ')],
      ['Platform', `${A.o.Os}/${A.o.Architecture}`, `${B.o.Os}/${B.o.Architecture}`],
      ['User', val(A.o.Config?.User), val(B.o.Config?.User)],
      ['Working dir', val(A.o.Config?.WorkingDir), val(B.o.Config?.WorkingDir)],
      ['Entrypoint', val(A.o.Config?.Entrypoint), val(B.o.Config?.Entrypoint)],
      ['Cmd', val(A.o.Config?.Cmd), val(B.o.Config?.Cmd)],
      ['Exposed ports', val(A.o.Config?.ExposedPorts), val(B.o.Config?.ExposedPorts)]
    ]
    const ea = envOf(A.o), eb = envOf(B.o), keys = [...new Set([...Object.keys(ea), ...Object.keys(eb)])].sort()
    const envRows = keys.filter((k) => ea[k] !== eb[k]).map((k) => `<tr><td class="mono">${esc(k)}</td><td class="mono ${k in ea ? '' : 'meta'}">${k in ea ? esc(ea[k]) : 'not set'}</td><td class="mono ${k in eb ? '' : 'meta'}">${k in eb ? esc(eb[k]) : 'not set'}</td></tr>`)
    const key = (l) => `${layerCmd(l.CreatedBy)}\u0000${l.Size || 0}`
    const count = (h) => { const m2 = new Map(); for (const l of h) m2.set(key(l), (m2.get(key(l)) || 0) + 1); return m2 }
    const ca = count(A.h), cb = count(B.h)
    const only = (h, other) => { const left = new Map(other); return h.filter((l) => { const n = left.get(key(l)) || 0; if (n > 0) { left.set(key(l), n - 1); return false } return true }) }
    const oa = only(A.h, cb), ob = only(B.h, ca)
    const shared = A.h.length - oa.length
    const lay = (list) => list.length ? list.map((l) => `<div class="lcmp"><span class="nw meta">${fmt(l.Size || 0)}</span><span class="mono">${esc(layerCmd(l.CreatedBy).slice(0, 200))}</span></div>`).join('') : '<div class="meta">Nothing unique</div>'
    out.innerHTML = `<table class="ctable"><thead><tr><th></th><th>A</th><th>B</th></tr></thead><tbody>${rows.map(([k, x, y]) => `<tr class="${x !== y ? 'diff' : ''}"><td class="meta">${k}</td><td class="mono">${esc(x) || '–'}</td><td class="mono">${esc(y) || '–'}</td></tr>`).join('')}</tbody></table>
      <div class="dsub">Environment differences</div>${envRows.length ? `<table class="ctable"><thead><tr><th>Variable</th><th>A</th><th>B</th></tr></thead><tbody>${envRows.join('')}</tbody></table>` : '<div class="meta">Same environment variables.</div>'}
      <div class="dsub">Layers · ${shared} shared</div><div class="two"><div><div class="meta">Only in A (${oa.length})</div>${lay(oa)}</div><div><div class="meta">Only in B (${ob.length})</div>${lay(ob)}</div></div>`
  }
  $('#cmpgo', m).onclick = run
  run()
}

// ---------- Images ----------
export const volName = (n) => (/^[0-9a-f]{64}$/.test(n) ? n.slice(0, 12) + '…' : n)
export const short = (id) => String(id || '').replace('sha256:', '').slice(0, 12)
export let iq = '', ifilter = 'all', iList = []
export const isel = new Set() // selected image refs (tag, or image id for untagged)

export const splitRef = (ref) => { const i = ref.lastIndexOf(':'); return i > ref.lastIndexOf('/') ? [ref.slice(0, i), ref.slice(i + 1)] : [ref, 'latest'] }

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

export function imageRows() {
  return visibleImages().map((r) => `<tr class="row-click" data-inspect="image:${esc(r.id)}:${esc(r.ref.startsWith('sha256:') ? r.repo : r.ref)}">
    <td class="cb"><input type="checkbox" class="isel" data-ref="${esc(r.ref)}" ${isel.has(r.ref) ? 'checked' : ''}></td>
    <td><div class="namecell"><span class="nm">${esc(r.repo)}</span>${r.usedBy.length ? `<span class="pill running" title="${esc(r.usedBy.join(', '))}">In use</span>` : ''}${r.dangling ? '<span class="pill warn">dangling</span>' : ''}${iUpdates.get(r.ref) === true ? '<span class="pill warn" title="A newer version of this tag exists in the registry">update available</span>' : ''}</div></td>
    <td class="mono">${esc(r.tag)}</td>
    <td class="mono">${short(r.id)}</td>
    <td class="nw">${rel(new Date(r.created * 1000).toISOString())}</td>
    <td class="nw">${fmt(r.size)}</td>
    <td><div class="actions">${ibtn('play', 'Run', call('run', r.ref), 'ok')}${iUpdates.get(r.ref) === true ? ibtn('download', 'Pull the update', call('pull', r.ref)) : ''}${ibtn('more', 'More actions', call('imenu', r.ref))}${ibtn('trash', 'Delete', call('confirm', `Delete ${r.dangling ? short(r.id) : r.ref}?`, 'image.remove', r.ref, false), 'dan')}</div></td></tr>`).join('') ||
    `<tr><td colspan="7"><div class="empty">No matching images</div></td></tr>`
}

export async function images() {
  const [list, cs] = await Promise.all([api('images.list'), api('containers.list')])
  iList = flattenImages(list, cs)
  for (const ref of [...isel]) if (!iList.some((r) => r.ref === ref)) isel.delete(ref)
  const total = list.reduce((a, i) => a + i.Size, 0)
  const inUse = list.filter((i) => cs.some((c) => c.ImageID === i.Id)).reduce((a, i) => a + i.Size, 0)
  return `<div class="head"><h2>${ic('image', 22)}${tr('Images')}<span class="count">${list.length}</span></h2>
    <div class="usage"><div><div class="k">${list.length} image${list.length === 1 ? '' : 's'}</div><div class="v"><b>${fmt(inUse)}</b> / ${fmt(total)}</div><div class="s">in use</div></div></div></div>
    <div class="tools">
      <label class="search">${ic('search', 15)}<input type="text" id="iq" placeholder="Search" value="${esc(iq)}"></label>
      <select id="ifilter">${[['all', 'All images'], ['inuse', 'In use'], ['unused', 'Unused'], ['dangling', 'Dangling']].map(([v, l]) => `<option value="${v}" ${ifilter === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="sp"></span>
      ${tbtn('arrowup', 'Check for updates', call('imgupdates'))}
      ${tbtn('layers', 'Compare', call('cmpimg'))}
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

export function updateIBulk() {
  const b = $('#ibulk'); if (!b) return
  b.classList.toggle('on', isel.size > 0)
  b.innerHTML = isel.size ? `<b>${isel.size} selected</b>${tbtn('trash', 'Delete', call('ibulkdel'), 'dan')}<span class="sp"></span>${tbtn('x', 'Clear', call('ibulkclear'))}` : ''
  const all = $('#iselall'); if (all) { const v = visibleImages(); all.checked = v.length > 0 && v.every((r) => isel.has(r.ref)) }
}
export async function bulkDeleteImages() {
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

export function showImageMenu(btn, ref) {
  const r = iList.find((x) => x.ref === ref); if (!r) return
  const m = $('#menu')
  const item = (icon, label, callJson, cls = '') => `<button class="${cls}" data-call='${esc(callJson)}'>${ic(icon, 15)}${label}</button>`
  m.innerHTML = [
    item('play', 'Run', call('run', ref)),
    item('info', 'View details', call('inspectimg', r.id, r.dangling ? r.repo : ref)),
    r.dangling ? '' : item('download', 'Pull latest', call('pull', ref)),
    item('info', 'Scan for vulnerabilities', call('inspectimg', r.id, r.dangling ? r.repo : ref, 'Vulnerabilities')),
    item('layers', 'Compare with…', call('cmpimg', ref)),
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
export const setIfilter = (v) => { ifilter = v } // other modules cannot assign to an imported binding
