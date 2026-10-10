// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { closeDetail } from './container-detail.js'
import { $, api, call, esc, fmt, ic, rel, stream, tbtn, toast } from './core.js'
import { short } from './images.js'
import { jsonViewer } from './json-viewer.js'

// ---------- Inspect drawer for images / volumes / networks ----------
export async function openInspect(kind, id, title) {
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
export function layerCmd(c) {
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
// Vulnerability scan tab: runs on demand (it can take a minute) with Trivy or Grype, whichever is installed.
const SEV_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']
const scanCache = new Map() // image id -> last result, so reopening the tab doesn't rescan
async function vulnTab(pane, id, imageId) {
  let stopScan = null
  const ago = (t) => rel(new Date(t).toISOString())
  const draw = (r, filter = 'ALL', fixable = false) => {
    const rows = r.items.filter((i) => (filter === 'ALL' || i.severity === filter) && (!fixable || i.fixed))
    const old = r.at && Date.now() - r.at > 7 * 864e5
    pane.innerHTML = `<div class="vsum">${SEV_ORDER.map((k) => `<button type="button" class="vchip sev-${k.toLowerCase()} ${filter === k ? 'on' : ''}" data-sev="${k}"><b>${r.counts[k]}</b> ${k.toLowerCase()}</button>`).join('')}
        <button type="button" class="vchip ${fixable ? 'on' : ''}" data-fix title="Only show findings that have a fixed version">fix available</button>
        <span class="sp"></span><span class="meta">${esc(r.tool)} · ${r.total} found${r.at ? ` · scanned ${esc(ago(r.at))}` : ''}</span>${tbtn('restart', 'Rescan', call('rescan'))}</div>
      ${old ? `<div class="meta" style="padding:0 16px 8px">This result is more than a week old; new vulnerabilities are published every day, so rescan.</div>` : ''}
      ${rows.length ? `<table class="vtable"><thead><tr><th>Severity</th><th>CVE</th><th>Package</th><th>Installed</th><th>Fixed in</th></tr></thead><tbody>${rows.slice(0, 500).map((i) => `<tr title="${esc(i.title)}"><td><span class="vchip sev-${i.severity.toLowerCase()}">${i.severity.toLowerCase()}</span></td><td class="mono nw">${esc(i.id)}</td><td class="mono">${esc(i.pkg)}</td><td class="mono meta">${esc(i.version)}</td><td class="mono">${esc(i.fixed) || '<span class="meta">no fix yet</span>'}</td></tr>`).join('')}</tbody></table>${rows.length > 500 ? `<div class="meta">Showing the first 500 of ${rows.length}.</div>` : ''}` : `<div class="allgood">${ic('info', 18)}<div><b>${r.total ? 'Nothing at this level' : 'No known vulnerabilities'}</b></div></div>`}`
    pane.querySelectorAll('[data-sev]').forEach((b) => (b.onclick = () => draw(r, filter === b.dataset.sev ? 'ALL' : b.dataset.sev, fixable)))
    pane.querySelector('[data-fix]').onclick = () => draw(r, filter, !fixable)
    pane.querySelector('[data-call]').onclick = (e) => { e.stopPropagation(); scanCache.delete(imageId); start() }
  }
  // Runs as a stream: scanner progress is shown as it arrives, Cancel (or leaving this tab or closing the panel) stops the scanner.
  const start = () => {
    const t0 = Date.now()
    pane.innerHTML = `<div style="padding:16px"><div class="row"><span class="meta" id="vst">Scanning… this can take a few minutes the first time (the scanner downloads its vulnerability database).</span><span class="sp"></span><button type="button" class="tb" id="vcancel">Cancel</button></div><div class="meta mono" id="vprog" style="margin-top:8px;word-break:break-all"></div></div>`
    const prog = pane.querySelector('#vprog'), st = pane.querySelector('#vst')
    const tick = setInterval(() => { if (!st.isConnected) { clearInterval(tick); stopScan?.(); return } st.dataset.s = Math.round((Date.now() - t0) / 1000); st.textContent = `Scanning… ${st.dataset.s}s` }, 1000)
    const end = () => { clearInterval(tick); stopScan = null }
    stopScan = stream('scan', { ref: id, id: imageId }, (ev) => {
      if (!st.isConnected) { stopScan?.(); return end() } // another tab was opened or the panel closed
      if (ev.k === 'data') prog.textContent = ev.d
      else if (ev.k === 'end') { end(); scanCache.set(imageId, ev.d); draw(ev.d) }
      else { end(); pane.innerHTML = `<div class="err" style="margin:16px">${esc(ev.d)}</div><div style="padding:0 16px">${tbtn('restart', 'Try again', call('retry'))}</div>`; pane.querySelector('[data-call]').onclick = (e) => { e.stopPropagation(); start() } }
    })
    pane.querySelector('#vcancel').onclick = () => { stopScan?.(); end(); pane.innerHTML = `<div class="meta" style="padding:16px">Scan cancelled.</div><div style="padding:0 16px">${tbtn('restart', 'Scan again', call('again'))}</div>`; pane.querySelector('[data-call]').onclick = (e) => { e.stopPropagation(); start() } }
  }
  if (scanCache.has(imageId)) return draw(scanCache.get(imageId))
  try { const saved = await api('scan.last', imageId); if (saved && pane.isConnected) { scanCache.set(imageId, saved); return draw(saved) } } catch {}
  if (pane.isConnected) start()
}
export async function openImageDetail(id, title, first = 'Layers') {
  closeDetail()
  let obj, hist
  try { [obj, hist] = await Promise.all([api('image.inspect', id), api('image.history', id)]) } catch (e) { return toast(e.message, true) }
  const d = document.createElement('div')
  d.className = 'detail'
  d.innerHTML = `<header>${ic('image', 18)}<b>${esc(title)}</b><span class="meta mono">${esc(short(obj.Id))}</span><button class="ib" id="x" title="Close">${ic('x')}</button></header>
    <div class="tabs">${[['Layers', 'layers'], ['Vulnerabilities', 'info'], ['Inspect', 'box']].map(([t, i]) => `<a data-t="${t}">${ic(i, 14)}${t}</a>`).join('')}</div><div class="pane"></div>`
  document.body.append(d)
  $('#x', d).onclick = closeDetail
  const pane = $('.pane', d)
  const tab = (t) => {
    d.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.t === t))
    pane.className = 'pane'; pane.innerHTML = ''
    t === 'Layers' ? (pane.innerHTML = layersHtml(hist, obj)) : t === 'Vulnerabilities' ? vulnTab(pane, id, obj.Id) : jsonViewer(pane, obj, 'image')
  }
  d.querySelector('.tabs').onclick = (e) => { const t = e.target.closest('[data-t]')?.dataset.t; if (t) tab(t) }
  tab(first)
}
