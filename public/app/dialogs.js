// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { closeDetail } from './container-detail.js'
import { $, api, cliButton, esc, fmt, ic, shq, stream, toast } from './core.js'
import { short, splitRef } from './images.js'
import { formModal } from './lists.js'

// Build an image from a folder containing a Dockerfile (runs `docker build`, output streams live).
export async function buildImage() {
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
      <div class="row"><button type="button" class="tb" id="bclose">Close</button><button type="button" class="tb" id="bstop" style="display:none">Stop</button><button class="tb pri" id="bgo">${ic('hammer', 15)}<span>Build</span></button></div>
    </form><pre class="log buildlog" id="blog" hidden></pre><div id="berr"></div></div>`
  document.body.append(m)
  const dir = $('#bdir', m), pick = $('#bpick', m), file = $('#bfile', m), log = $('#blog', m)
  cliButton(m, () => { const d = dir.value.trim(), t = $('#btag', m).value.trim(); if (!d) throw new Error('Choose a folder first'); return `docker build -f ${shq(d.replace(/\/$/, '') + '/' + file.value)}${t ? ' -t ' + shq(t) : ''}${$('#bnc', m).checked ? ' --no-cache' : ''} ${shq(d)}` })
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
    const bstop = $('#bstop', m); bstop.style.display = ''
    bstop.onclick = () => { stopBuild?.(); stopBuild = null; bstop.style.display = 'none'; go.disabled = false; $('#berr', m).innerHTML = `<div class="err">Build stopped.</div>` }
    let pending = '', raf = 0
    stopBuild = stream('build', { dir: dir.value.trim(), tag: $('#btag', m).value.trim(), file: file.value, nocache: $('#bnc', m).checked ? '1' : '0' }, (ev) => {
      if (ev.k === 'data') {
        pending += ev.d
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; log.append(pending); pending = ''; log.scrollTop = log.scrollHeight })
      } else {
        go.disabled = false; stopBuild = null; bstop.style.display = 'none'
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
export function exportImage(ref) {
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
  cliButton(m, () => `docker save -o ${shq(dir.value.trim().replace(/\/$/, '') + '/' + $('#xname', m).value.trim())} ${shq(ref)}`)
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
export function importImage() {
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
  cliButton(m, () => { if (!path.value.trim()) throw new Error('Pick or type an archive file first'); return `docker load -i ${shq(path.value.trim())}` })
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

export function tagImage(ref) {
  const [repo, tag] = ref.startsWith('sha256:') ? ['', 'latest'] : splitRef(ref)
  formModal({ title: 'Tag image', icon: 'layers', intro: 'Adds another name to this image. To push to a registry, start the name with its address, e.g. localhost:5000/myapp or myuser/myapp.',
    fields: [{ name: 'repo', label: 'Name', value: repo, placeholder: 'myuser/myapp' }, { name: 'tag', label: 'Tag', value: tag === '<none>' ? 'latest' : tag, placeholder: 'latest' }],
    submit: 'Tag', cli: (v) => `docker tag ${shq(ref)} ${shq(v.repo + ':' + v.tag)}`, run: (v) => api('image.tag', ref, v.repo, v.tag).then(() => toast(`Tagged ${v.repo}:${v.tag}`)) })
}

// Push an image with `docker push`; sign-in lives in Settings → Registries.
export function pushImage(ref) {
  closeModal()
  const m = document.createElement('div')
  m.className = 'modal'
  m.innerHTML = `<div class="box wide"><h3>${ic('ext', 18)}Push ${esc(ref)}</h3><pre class="log buildlog" id="plog"></pre><div id="perr"></div>
    <div class="row"><button type="button" class="tb" id="pclose">Close</button><button type="button" class="tb" id="pstop">Stop</button></div></div>`
  document.body.append(m)
  const log = $('#plog', m)
  cliButton(m, () => `docker push ${shq(ref)}`)
  let pending = '', raf = 0
  const stop = stream('push', { ref }, (ev) => {
    if (ev.k !== 'data') $('#pstop', m).style.display = 'none'
    if (ev.k === 'data') { pending += ev.d; if (!raf) raf = requestAnimationFrame(() => { raf = 0; log.append(pending); pending = ''; log.scrollTop = log.scrollHeight }) }
    else if (ev.k === 'end') { toast(`Pushed ${ref}`) }
    else $('#perr', m).innerHTML = `<div class="err">${esc(ev.d)}${/no basic auth|denied|unauthorized/i.test(log.textContent) ? '<br>You may need to sign in first: Settings → Registries.' : ''}</div>`
  })
  $('#pstop', m).onclick = () => { stop(); $('#pstop', m).style.display = 'none'; $('#perr', m).innerHTML = `<div class="err">Push stopped.</div>` }
  $('#pclose', m).onclick = () => { stop(); closeModal() }
  m.onclick = (e) => { if (e.target === m) { stop(); closeModal() } }
}

export function registryLogin() {
  formModal({ title: 'Sign in to a registry', icon: 'download', intro: 'Leave the registry empty for Docker Hub. For Docker Hub use an access token instead of your password.',
    fields: [{ name: 'server', label: 'Registry (optional)', placeholder: 'ghcr.io, localhost:5000, …' }, { name: 'user', label: 'Username' }, { name: 'password', label: 'Password or access token', type: 'password' }],
    submit: 'Sign in', cli: (v) => `docker login${v.server ? ' ' + shq(v.server) : ''} -u ${shq(v.user)}`, run: (v) => api('registry.login', v.server, v.user, v.password).then(() => toast('Signed in')) })
}

export function pullImage(prefill = '', auto = false) {
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
  cliButton(m, () => { const n = input.value.trim(); if (!n) throw new Error('Type an image name first'); return `docker pull ${shq(n)}` })
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
export function closeModal() { $('.modal')?.remove() }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { stopPull?.(); closeModal(); closeDetail() } })
