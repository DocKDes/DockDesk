// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { openDetail } from './container-detail.js'
import { $, TOKEN, api, cliButton, confirm, esc, fmt, ic, shq, toast } from './core.js'
import { closeModal } from './dialogs.js'

// ---------- Container files: browse, preview, upload, download ----------
export function filesTab(pane, info) {
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
      if (d.source === 'archive') { note.hidden = false; note.innerHTML = `${ic('info', 16)}<div>Listed from the container's filesystem, because it is stopped or has no <span class="mono">ls</span>.${d.partial ? ' This folder is very large, so the list may be incomplete.' : ''}</div>` }
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
      <div class="row"><a class="tb" href="${dl('file', p)}" download>${ic('download', 14)}<span>Download</span></a><span class="sp"></span>${r.binary || r.truncated || lines.length > 5000 ? '' : `<button type="button" class="tb" id="pve">${ic('logs', 14)}<span>Edit</span></button>`}<button type="button" class="tb" id="pvc">Close</button></div></div>`
    document.body.append(m)
    $('#pvc', m).onclick = closeModal
    if ($('#pve', m)) $('#pve', m).onclick = () => {
      const ta = document.createElement('textarea')
      ta.className = 'yaml'; ta.spellcheck = false; ta.value = r.text; ta.setAttribute('wrap', 'off')
      ta.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  ') } })
      $('.pvcode', m).replaceWith(ta)
      const row = $('.row', m)
      row.innerHTML = `<span class="meta">Saved straight into the container's filesystem. It is lost if the container is recreated.</span><span class="sp"></span><button type="button" class="tb" id="pvcancel">Cancel</button><button type="button" class="tb pri" id="pvsave">${ic('copy', 14)}<span>Save</span></button>`
      ta.focus()
      $('#pvcancel', m).onclick = () => preview(p)
      $('#pvsave', m).onclick = async () => {
        try { await api('container.write', id, p, ta.value); toast('Saved'); preview(p); load(cwd) } catch (err) { toast(err.message, true) }
      }
    }
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

export function containerSettings(pane, info) {
  const hc = info.HostConfig
  const mem = hc.Memory ? Math.round(hc.Memory / 1048576) : '', cpu = hc.NanoCpus ? hc.NanoCpus / 1e9 : ''
  const pol = hc.RestartPolicy?.Name || 'no'
  pane.innerHTML = `<form class="cform">
    <label class="fld">Name<input type="text" id="cs-name" value="${esc(info.Name.replace(/^\//, ''))}" spellcheck="false"></label>
    <label class="fld">Restart policy<select id="cs-restart">${[['no', 'Never'], ['unless-stopped', 'Unless stopped'], ['always', 'Always'], ['on-failure', 'On failure']].map(([v, l]) => `<option value="${v}" ${pol === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="two"><label class="fld">Memory limit (MB)<input type="text" id="cs-mem" value="${mem}" placeholder="unlimited" inputmode="numeric"></label>
    <label class="fld">CPUs<input type="text" id="cs-cpu" value="${cpu}" placeholder="unlimited" inputmode="decimal"></label></div>
    <div class="meta">Applies immediately, without restarting the container. Docker can raise or lower a limit but can't remove one from an existing container: leave a field unchanged to keep it, or remove the limit below.</div>
    <div><button class="tb pri" id="cs-save">${ic('copy', 15)}<span>Save changes</span></button></div>
    ${hc.Memory || hc.NanoCpus ? `<div class="limits"><div class="meta">Remove a limit: DockDesk recreates the container with the same settings, volumes and networks (${info.State.Running ? 'it is stopped and started again, so it restarts briefly' : 'it stays stopped'}). The old one is kept until the new one works. Changes made inside the container's filesystem are lost.</div>
      <div class="row">${hc.Memory ? `<button type="button" class="tb" id="cs-nomem">${ic('trash', 15)}<span>Remove memory limit</span></button>` : ''}${hc.NanoCpus ? `<button type="button" class="tb" id="cs-nocpu">${ic('trash', 15)}<span>Remove CPU limit</span></button>` : ''}</div></div>` : ''}</form>`
  const removeLimit = async (what, label) => {
    if (!confirm(`Remove the ${label} limit? The container will be recreated (files you changed inside it are lost; volumes are kept).`)) return
    toast('Recreating the container…')
    try { const r = await api('container.removeLimits', info.Id, what); toast('Limit removed'); window.refresh?.(); openDetail(r.id, 'Settings') } catch (err) { toast(err.message, true) }
  }
  cliButton(null, () => {
    const old = info.Name.replace(/^\//, ''), nn = $('#cs-name', pane).value.trim(), mem = Number($('#cs-mem', pane).value) || 0, cpus = Number($('#cs-cpu', pane).value) || 0
    const u = ['docker update', '--restart', $('#cs-restart', pane).value]
    if (mem) u.push('--memory', `${mem}m`, '--memory-swap', `${mem * 2}m`)
    if (cpus) u.push('--cpus', String(cpus))
    u.push(shq(old))
    return [u.join(' '), nn && nn !== old ? `docker rename ${shq(old)} ${shq(nn)}` : ''].filter(Boolean).join(' && ')
  }, { after: $('#cs-save', pane) })
  if ($('#cs-nomem', pane)) $('#cs-nomem', pane).onclick = () => removeLimit({ memory: true }, 'memory')
  if ($('#cs-nocpu', pane)) $('#cs-nocpu', pane).onclick = () => removeLimit({ cpus: true }, 'CPU')
  $('.cform', pane).onsubmit = async (e) => {
    e.preventDefault()
    try {
      await api('container.update', info.Id, { name: $('#cs-name', pane).value.trim(), restart: $('#cs-restart', pane).value, memoryMb: Number($('#cs-mem', pane).value) || 0, cpus: Number($('#cs-cpu', pane).value) || 0 })
      toast('Saved'); window.refresh?.(); openDetail(info.Id, 'Settings')
    } catch (err) { toast(err.message, true) }
  }
}
