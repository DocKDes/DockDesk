// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { closeDetail, stops } from './container-detail.js'
import { cname, pubPorts, setCList } from './containers.js'
import { $, api, call, cliButton, confirm, esc, ibtn, ic, portLink, shq, stream, tbtn, toast, tr } from './core.js'
import { closeModal } from './dialogs.js'
import { formModal } from './lists.js'
import { lineLevel, logLineHtml, plainOf } from './logs.js'
import { applyStats } from './state.js'

// ---------- Compose ----------
export const cexp = new Set() // expanded project names
let cProjects = {}

let compq = '', compf = 'all'
const projState = (p) => { const run = p.cs.filter((c) => c.State === 'running').length; return run === 0 ? 'stopped' : run === p.cs.length ? 'running' : 'partial' }
const svcName = (c) => c.Labels['com.docker.compose.service'] || cname(c)

export function visibleProjects() {
  const q = compq.trim().toLowerCase()
  return Object.values(cProjects).filter((p) => (compf === 'all' || projState(p) === compf) &&
    (!q || [p.name, p.dir, p.files, ...p.cs.map((c) => svcName(c) + ' ' + cname(c) + ' ' + c.Image)].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => (projState(a) === 'stopped') - (projState(b) === 'stopped') || a.name.localeCompare(b.name))
}

export function composeRows() {
  const q = compq.trim().toLowerCase()
  return visibleProjects().map((p) => {
    const st = projState(p), run = p.cs.filter((c) => c.State === 'running').length
    const inside = q && !p.name.toLowerCase().includes(q) // the match is a service/container: show it without an extra click
    const open = cexp.has(p.name) || inside
    const toggle = st === 'running'
      ? ibtn('stop', 'Stop', call('compose.action', p.name, p.dir, p.files, 'stop'), 'stop')
      : ibtn('play', st === 'partial' ? 'Start remaining' : 'Start', call('compose.action', p.name, p.dir, p.files, 'up'), 'ok')
    const ports = [...new Map(p.cs.flatMap(pubPorts).map((q2) => [q2.PublicPort, q2])).values()]
    const sorted = [...p.cs].sort((a, b) => svcName(a).localeCompare(svcName(b)))
    const chips = sorted.slice(0, 4).map((c) => `<span class="chip" title="${esc(c.Status)}"><span class="dot ${c.State}"></span>${esc(svcName(c))}</span>`).join('') + (sorted.length > 4 ? `<span class="chip more">+${sorted.length - 4}</span>` : '')
    const sub = open ? `<tr class="subrow"><td colspan="7"><table class="nested"><tbody>${sorted.map((c) => `<tr>
        <td class="st"><span class="dot ${c.State}"></span></td>
        <td class="nm">${esc(svcName(c))}</td>
        <td class="mono">${esc(cname(c))}</td>
        <td class="mono trunc" title="${esc(c.Image)}">${esc(c.Image)}</td>
        <td class="mono">${pubPorts(c).map((x) => portLink(x.PublicPort, `${x.PublicPort}:${x.PrivatePort}`)).join(' ') || '–'}</td>
        <td class="nw">${esc(c.Status)}</td>
        <td class="num nw" data-cpu="${c.Id}" data-run="${c.State === 'running' ? 1 : 0}">${c.State === 'running' ? '–' : '0%'}</td>
        <td><div class="actions">${c.State === 'running' ? ibtn('stop', 'Stop', call('container.action', c.Id, 'stop'), 'stop') : ibtn('play', 'Start', call('container.action', c.Id, c.State === 'paused' ? 'unpause' : 'start'), 'ok')}${ibtn('logs', 'View logs', call('open', c.Id, 'Logs'))}${ibtn('restart', 'Restart this service', call('compose.service', p.name, p.dir, p.files, svcName(c), 'restart'))}${ibtn('layers', 'Scale this service', call('svcscale', p.name, svcName(c), p.cs.filter((x) => svcName(x) === svcName(c)).length))}${ibtn('more', 'More actions', call('menu', c.Id))}</div></td></tr>`).join('')}</tbody></table></td></tr>` : ''
    return `<tr class="row-click cprow ${open ? 'open' : ''}" data-cp="${esc(p.name)}">
      <td class="cb">${ibtn(open ? 'chevdown' : 'chevright', open ? 'Collapse' : 'Expand', call('cexp', p.name))}</td>
      <td><div class="namecell"><span class="dot ${st === 'stopped' ? 'exited' : st === 'partial' ? 'paused' : 'running'}"></span><div><div class="nm">${esc(p.name)}</div><div class="sub mono" title="${esc(p.dir)}">${esc(p.dir)}</div></div></div></td>
      <td><div class="chips">${chips}</div></td>
      <td><span class="pill ${st === 'running' ? 'running' : st === 'partial' ? 'warn' : ''}">${run} of ${p.cs.length} running</span></td>
      <td class="mono">${ports.slice(0, 3).map((x) => portLink(x.PublicPort, x.PublicPort)).join(' ') || '–'}${ports.length > 3 ? ` <span class="meta">+${ports.length - 3}</span>` : ''}</td>
      <td class="num nw" data-pstat="${p.cs.filter((c) => c.State === 'running').map((c) => c.Id).join(',')}">–</td>
      <td><div class="actions">${toggle}${ibtn('more', 'More actions', call('cmenu', p.name))}${ibtn('trash', 'Down: remove containers', call('confirm', `Remove all containers and networks of “${p.name}”? Volumes are kept.`, 'compose.action', p.name, p.dir, p.files, 'down'), 'dan')}</div></td></tr>${sub}`
  }).join('') || `<tr><td colspan="7"><div class="empty">No matching projects</div></td></tr>`
}

export async function compose() {
  const list = await api('containers.list')
  setCList(list) // the per-container ⋮ menu reads from this
  cProjects = {}
  for (const c of list) {
    const l = c.Labels || {}
    const pn = l['com.docker.compose.project']
    if (!pn) continue
    const x = (cProjects[pn] ||= { name: pn, dir: l['com.docker.compose.project.working_dir'] || '', files: l['com.docker.compose.project.config_files'] || '', cs: [] })
    x.cs.push(c)
  }
  const all = Object.values(cProjects)
  const running = all.filter((p) => projState(p) !== 'stopped').length
  const svc = all.reduce((a, p) => a + p.cs.length, 0), svcUp = all.reduce((a, p) => a + p.cs.filter((c) => c.State === 'running').length, 0)
  return `<div class="head"><h2>${ic('layers', 22)}${tr('Compose')}<span class="count">${all.length}</span></h2>
    <div class="usage">
      <div><div class="k">Projects running</div><div class="v"><b>${running}</b> / ${all.length}</div><div class="s">${all.length - running} stopped</div></div>
      <div><div class="k">Services running</div><div class="v"><b>${svcUp}</b> / ${svc}</div><div class="s">across all projects</div></div>
      <div><div class="k">Project CPU / memory</div><div class="v"><b id="cp-cpu">–</b> · <b id="cp-mem">–</b></div><div class="s">compose containers only</div></div>
    </div></div>` + (all.length ? `
    <div class="tools">
      <label class="search">${ic('search', 15)}<input type="text" id="cpq" placeholder="Search projects, services, images…" value="${esc(compq)}"></label>
      <select id="cpf">${[['all', 'All projects'], ['running', 'Running'], ['partial', 'Partly running'], ['stopped', 'Stopped']].map(([v, l]) => `<option value="${v}" ${compf === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="sp"></span>${tbtn('plus', 'New project', call('newproject'), 'pri')}${tbtn('chevdown', 'Expand all', call('cexpall', 1))}${tbtn('chevright', 'Collapse all', call('cexpall', 0))}
    </div>
    <table class="cptable"><thead><tr><th class="cb"></th><th>Project</th><th>Services</th><th>Status</th><th>Ports</th><th class="num">CPU · Memory</th><th class="num">Actions</th></tr></thead><tbody id="cprows">${composeRows()}</tbody></table>`
    : `<div class="empty">${ic('layers', 32)}<div>No compose projects yet.<br><span class="meta">Create one here, or run <span class="mono">docker compose up -d</span> in a folder with a compose file.</span></div>${tbtn('plus', 'New project', call('newproject'), 'pri')}</div>`)
}

document.addEventListener('input', (e) => { if (e.target.id === 'cpq') { compq = e.target.value; $('#cprows').innerHTML = composeRows(); applyStats() } })
document.addEventListener('change', (e) => { if (e.target.id === 'cpf') { compf = e.target.value; $('#cprows').innerHTML = composeRows(); applyStats() } })

const COMPOSE_TEMPLATES = {
  'Nginx web server': 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "127.0.0.1:8080:80"\n',
  'Postgres + Adminer': 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: change-me\n    volumes:\n      - db-data:/var/lib/postgresql/data\n  adminer:\n    image: adminer\n    ports:\n      - "127.0.0.1:8081:8080"\n    depends_on:\n      - db\nvolumes:\n  db-data:\n',
  'Redis': 'services:\n  redis:\n    image: redis:7-alpine\n    ports:\n      - "127.0.0.1:6379:6379"\n',
  'WordPress + MariaDB': 'services:\n  db:\n    image: mariadb:11\n    environment:\n      MARIADB_ROOT_PASSWORD: change-me\n      MARIADB_DATABASE: wordpress\n    volumes:\n      - db-data:/var/lib/mysql\n  wordpress:\n    image: wordpress:latest\n    depends_on:\n      - db\n    environment:\n      WORDPRESS_DB_HOST: db\n      WORDPRESS_DB_USER: root\n      WORDPRESS_DB_PASSWORD: change-me\n      WORDPRESS_DB_NAME: wordpress\n    ports:\n      - "127.0.0.1:8082:80"\nvolumes:\n  db-data:\n',
  'Kali toolbox': 'services:\n  kali:\n    image: kalilinux/kali-rolling\n    tty: true\n    stdin_open: true\n    cap_add:\n      - NET_ADMIN\n      - NET_RAW\n'
}

// Write or edit a compose file, validate it with `docker compose config`, then run it.
export function composeEditor({ project = '', file = '', text = '', writable = true } = {}) {
  closeModal()
  const isNew = !file
  const m = document.createElement('div')
  m.className = 'modal'
  m.innerHTML = `<div class="box xwide"><h3>${ic('layers', 18)}${isNew ? 'New compose project' : 'Edit ' + esc(project)}</h3>
    <form><div class="two"><label class="fld">Project name<input type="text" id="cename" value="${esc(project)}" ${isNew ? '' : 'readonly'} placeholder="my-project" spellcheck="false" autocomplete="off"></label>
      ${isNew ? `<label class="fld">Start from a template<select id="cetpl"><option value="">Choose…</option>${Object.keys(COMPOSE_TEMPLATES).map((k) => `<option>${esc(k)}</option>`).join('')}</select></label>` : `<div class="fld">File<div class="mono meta" style="padding-top:8px;word-break:break-all">${esc(file)}</div></div>`}</div>
      ${writable ? '' : `<div class="err">This file is read-only for your user, so changes can't be saved.</div>`}
      <textarea id="ceyaml" class="yaml" spellcheck="false" wrap="off" placeholder="services:&#10;  web:&#10;    image: nginx:alpine">${esc(text)}</textarea>
      <div id="cestat" class="cestat"></div>
      <div class="row"><button type="button" class="tb" id="ceclose">Close</button><button type="button" class="tb" id="cevalidate">${ic('info', 14)}<span>Validate</span></button>
        <button type="button" class="tb" id="cesave" ${writable ? '' : 'disabled'}>${ic('copy', 14)}<span>Save</span></button><button type="button" class="tb" id="cestop" style="display:none">Stop</button><button class="tb pri" id="cego" ${writable ? '' : 'disabled'}>${ic('play', 14)}<span>Save and start</span></button></div></form>
    <pre class="log buildlog" id="ceout" hidden></pre></div>`
  document.body.append(m)
  const ta = $('#ceyaml', m), nameIn = $('#cename', m), stat = $('#cestat', m), out = $('#ceout', m)
  let curFile = file, stopRun = null
  cliButton(m, () => `docker compose -p ${shq(isNew ? nameIn.value.trim() || 'my-project' : project)} -f ${shq(curFile || 'compose.yaml')} up -d`)
  const say = (html, kind) => { stat.className = 'cestat ' + (kind || ''); stat.innerHTML = html }
  $('#ceclose', m).onclick = () => { stopRun?.(); closeModal() }
  m.onclick = (e) => { if (e.target === m) { stopRun?.(); closeModal() } }
  ta.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  ') } })
  if (isNew) $('#cetpl', m).onchange = (e) => { if (e.target.value && (!ta.value.trim() || confirm('Replace the current text with this template?'))) { ta.value = COMPOSE_TEMPLATES[e.target.value]; say('') } e.target.value = '' }
  const validate = async () => {
    say('Checking…')
    try {
      const r = await api('compose.validate', ta.value)
      say(`✓ Valid · ${r.services.length} service${r.services.length === 1 ? '' : 's'}: ${esc(r.services.join(', '))}${r.warnings.length ? `<div class="meta">${r.warnings.map(esc).join('<br>')}</div>` : ''}`, 'ok')
      return true
    } catch (e) { say(esc(e.message), 'bad'); return false }
  }
  const nameOk = () => {
    const n = nameIn.value.trim()
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(n)) { say('Project name: lowercase letters, digits, - and _ only.', 'bad'); nameIn.focus(); return null }
    return n
  }
  const save = async () => {
    if (isNew && !curFile) { const n = nameOk(); if (!n) return false; curFile = (await api('compose.save', n, ta.value)).file }
    else await api('compose.write', curFile, ta.value)
    return true
  }
  $('#cevalidate', m).onclick = validate
  $('#cesave', m).onclick = async () => { if (!(await validate())) return; try { if (await save()) { say(`✓ Saved to <span class="mono">${esc(curFile)}</span>`, 'ok'); toast('Saved'); window.refresh?.() } } catch (e) { say(esc(e.message), 'bad') } }
  $('form', m).onsubmit = async (e) => {
    e.preventDefault()
    const name = isNew ? nameOk() : project; if (!name) return
    if (!(await validate())) return
    try { if (!(await save())) return } catch (err) { return say(esc(err.message), 'bad') }
    out.hidden = false; out.textContent = ''; say('Starting…')
    let pending = '', raf = 0
    $('#cego', m).disabled = true
    const cestop = $('#cestop', m); cestop.style.display = ''
    cestop.onclick = () => { stopRun?.(); stopRun = null; cestop.style.display = 'none'; $('#cego', m).disabled = false; say('Stopped. Containers already started keep running.', 'bad') }
    stopRun = stream('compose', { project: name, file: curFile, verb: 'up' }, (ev) => {
      if (ev.k === 'data') { pending += ev.d; if (!raf) raf = requestAnimationFrame(() => { raf = 0; out.append(pending); pending = ''; out.scrollTop = out.scrollHeight }) }
      else { $('#cego', m).disabled = false; stopRun = null; cestop.style.display = 'none'
        if (ev.k === 'end') { say(`✓ ${esc(name)} is running`, 'ok'); toast(`${name} started`); window.refresh?.() } else say(esc(ev.d), 'bad') }
    })
  }
  ta.focus()
}

export async function editProject(name) {
  const p = cProjects[name]
  const file = (p?.files || '').split(',')[0]
  if (!file) return toast('This project has no compose file on record', true)
  try {
    const r = await api('compose.read', file)
    composeEditor({ project: name, file: r.file, text: r.text, writable: r.writable })
    if ((p.files || '').includes(',')) toast('This project uses several compose files; only the first is shown.')
  } catch (e) { toast(e.message, true) }
}

export function showComposeMenu(btn, name) {
  const p = cProjects[name]; if (!p) return
  const m = $('#menu')
  const act = (v) => call('compose.action', p.name, p.dir, p.files, v)
  const item = (icon, label, callJson, cls = '') => `<button class="${cls}" data-call='${esc(callJson)}'>${ic(icon, 15)}${label}</button>`
  m.innerHTML = [
    item('play', 'Start (up -d)', act('up')), item('play', 'Start with profiles…', call('composeprofiles', p.name)), item('restart', 'Restart', act('restart')), item('stop', 'Stop', act('stop')),
    '<hr>', item('download', 'Pull images', act('pull')), item('hammer', 'Build images', act('build')),
    '<hr>', item('down', 'Down (remove containers)', call('confirm', `Remove all containers and networks of “${p.name}”? Volumes are kept.`, 'compose.action', p.name, p.dir, p.files, 'down'), 'dan'),
    '<hr>', item('logs', 'View combined logs', call('projectlogs', p.name)), item('layers', 'Dependency graph', call('composegraph', p.name)), item('logs', 'Environment (.env)…', call('composeenv', p.name)), item('logs', 'Edit compose file…', call('editproject', p.name)),
    p.dir ? item('copy', 'Copy project folder', call('copy', p.dir)) : ''
  ].join('')
  placeMenu(btn)
}

// ---------- Compose: profiles, .env, dependency graph, per-service scale ----------
export function scaleService(name, svc, current) {
  const p = cProjects[name]; if (!p) return
  formModal({ title: `Scale ${svc}`, icon: 'layers', intro: 'How many containers of this service should run. Services with a fixed container name or a fixed host port cannot be scaled.',
    fields: [{ name: 'n', label: 'Number of containers', value: String(current) }], submit: 'Scale',
    cli: (v) => `docker compose -p ${shq(p.name)} ${(p.files || '').split(',').filter(Boolean).map((f) => '-f ' + shq(f)).join(' ')} up -d --no-recreate --scale ${shq(svc + '=' + v.n)} ${shq(svc)}`.replace(/\s+/g, ' '),
    run: (v) => api('compose.service', p.name, p.dir, p.files, svc, 'scale', Number(v.n)).then(() => toast(`${svc}: ${v.n} container${v.n === '1' ? '' : 's'}`)) })
}
export async function composeProfiles(name) {
  const p = cProjects[name]; if (!p) return
  const file = (p.files || '').split(',')[0]
  let profiles = []
  try { profiles = file ? await api('compose.profiles', file) : [] } catch (e) { return toast(e.message, true) }
  closeModal()
  const m = document.createElement('div')
  m.className = 'modal'
  m.innerHTML = `<div class="box"><h3>${ic('play', 18)}Start ${esc(name)} with profiles</h3>
    ${profiles.length ? `<p class="meta">Services that belong to a profile only start when you turn that profile on.</p><div class="profs">${profiles.map((x) => `<label class="chk"><input type="checkbox" value="${esc(x)}"> ${esc(x)}</label>`).join('')}</div>` : '<p class="meta">This project does not define any profiles.</p>'}
    <div class="row"><button type="button" class="tb" id="pfx">Cancel</button><button type="button" class="tb pri" id="pfgo" ${profiles.length ? '' : 'disabled'}>${ic('play', 15)}<span>Start</span></button></div><div class="merr"></div></div>`
  document.body.append(m)
  const chosen = () => [...m.querySelectorAll('.profs input:checked')].map((x) => x.value)
  cliButton(m, () => `docker compose -p ${shq(p.name)} ${(p.files || '').split(',').filter(Boolean).map((f) => '-f ' + shq(f)).join(' ')} ${chosen().map((x) => '--profile ' + shq(x)).join(' ')} up -d`.replace(/\s+/g, ' '))
  m.onclick = (e) => { if (e.target === m) closeModal() }
  $('#pfx', m).onclick = closeModal
  $('#pfgo', m).onclick = async () => {
    try { await api('compose.action', p.name, p.dir, p.files, 'up', chosen()); toast(`${name} started`); closeModal(); window.refresh?.() } catch (e) { $('.merr', m).innerHTML = `<div class="err">${esc(e.message)}</div>` }
  }
}
export async function composeEnv(name) {
  const p = cProjects[name]; if (!p) return
  const file = (p.files || '').split(',')[0]
  if (!file) return toast('This project has no compose file on record', true)
  let r
  try { r = await api('compose.env.read', file) } catch (e) { return toast(e.message, true) }
  closeModal()
  const m = document.createElement('div')
  m.className = 'modal'
  m.innerHTML = `<div class="box xwide"><h3>${ic('logs', 18)}Environment of ${esc(name)}</h3>
    <p class="meta">Variables for <span class="mono">\${…}</span> in the compose file. <span class="mono">${esc(r.file)}</span>${r.exists ? '' : ' (does not exist yet; saving creates it)'}. Changes apply the next time the project is started.</p>
    ${r.writable ? '' : '<div class="err">This file is read-only for your user, so changes can\'t be saved.</div>'}
    <textarea id="envta" class="yaml" spellcheck="false" wrap="off" placeholder="KEY=value">${esc(r.text)}</textarea><div class="merr"></div>
    <div class="row"><button type="button" class="tb" id="envx">Close</button><button type="button" class="tb" id="envs" ${r.writable ? '' : 'disabled'}>${ic('copy', 14)}<span>Save</span></button><button type="button" class="tb pri" id="envgo" ${r.writable ? '' : 'disabled'}>${ic('play', 14)}<span>Save and apply</span></button></div></div>`
  document.body.append(m)
  const ta = $('#envta', m)
  m.onclick = (e) => { if (e.target === m) closeModal() }
  $('#envx', m).onclick = closeModal
  ta.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  ') } })
  const save = async () => { try { await api('compose.env.write', file, ta.value); return true } catch (e) { $('.merr', m).innerHTML = `<div class="err">${esc(e.message)}</div>`; return false } }
  $('#envs', m).onclick = async () => { if (await save()) toast('Saved') }
  $('#envgo', m).onclick = async () => {
    if (!(await save())) return
    try { await api('compose.action', p.name, p.dir, p.files, 'up'); toast('Saved and applied'); closeModal(); window.refresh?.() } catch (e) { $('.merr', m).innerHTML = `<div class="err">${esc(e.message)}</div>` }
  }
}
export async function composeGraph(name) {
  const p = cProjects[name]; if (!p) return
  const file = (p.files || '').split(',')[0]
  if (!file) return toast('This project has no compose file on record', true)
  let svcs
  try { svcs = await api('compose.graph', file) } catch (e) { return toast(e.message, true) }
  closeModal()
  const byName = new Map(svcs.map((s) => [s.name, s]))
  const depth = new Map()
  const dep = (n, seen = new Set()) => {
    if (depth.has(n)) return depth.get(n)
    if (seen.has(n)) return 0 // a cycle: stop here
    seen.add(n)
    const d = Math.max(-1, ...(byName.get(n)?.depends || []).filter((x) => byName.has(x)).map((x) => dep(x, seen))) + 1
    depth.set(n, d); return d
  }
  svcs.forEach((s) => dep(s.name))
  const cols = []
  for (const s of [...svcs].sort((a, b) => a.name.localeCompare(b.name))) (cols[depth.get(s.name)] ||= []).push(s)
  const W = 190, H = 48, GX = 80, GY = 22, pos = new Map()
  cols.forEach((col, ci) => col.forEach((s, ri) => pos.set(s.name, { x: 20 + ci * (W + GX), y: 20 + ri * (H + GY) })))
  const width = 40 + cols.length * (W + GX) - GX, height = 40 + Math.max(...cols.map((c) => c.length)) * (H + GY) - GY
  const stateOf = (n) => { const cs = p.cs.filter((c) => svcName(c) === n); return !cs.length ? 'none' : cs.some((c) => c.State === 'running') ? 'running' : 'stopped' }
  const edges = svcs.flatMap((s) => s.depends.filter((d) => pos.has(d)).map((d) => { const a = pos.get(d), b = pos.get(s.name), x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2; return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 2},${y2}" fill="none" stroke="var(--mut)" stroke-width="1.4" marker-end="url(#arr)"/>` }))
  const nodes = svcs.map((s) => { const q = pos.get(s.name), st = stateOf(s.name); return `<g transform="translate(${q.x},${q.y})"><rect width="${W}" height="${H}" rx="8" fill="var(--panel)" stroke="var(--line)"/><circle cx="14" cy="${H / 2}" r="5" fill="${st === 'running' ? 'var(--ok)' : st === 'stopped' ? 'var(--warn)' : 'var(--mut)'}"/><text x="28" y="${H / 2 - 3}" fill="var(--fg)" font-size="13" font-weight="600">${esc(s.name.length > 20 ? s.name.slice(0, 19) + '…' : s.name)}</text><text x="28" y="${H / 2 + 13}" fill="var(--mut)" font-size="11">${esc((s.profiles.length ? 'profile: ' + s.profiles.join(', ') : s.image || '').slice(0, 26))}</text></g>` })
  const m = document.createElement('div')
  m.className = 'modal'
  m.innerHTML = `<div class="box xwide"><h3>${ic('layers', 18)}Dependencies of ${esc(name)}</h3>
    <p class="meta">An arrow points from a service to the services that wait for it (<span class="mono">depends_on</span>). Green is running, orange stopped, grey not created.</p>
    <div class="graph"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--mut)"/></marker></defs>${edges.join('')}${nodes.join('')}</svg></div>
    <div class="row"><button type="button" class="tb" id="gx">Close</button></div></div>`
  document.body.append(m)
  m.onclick = (e) => { if (e.target === m) closeModal() }
  $('#gx', m).onclick = closeModal
}


// Combined logs of every container in a Compose project: one live stream per container, merged in arrival order,
// each line prefixed with a colour-coded service name. Service chips hide or show a service.
const SVC_COLORS = ['#4f9cf9', '#e0a030', '#4cc38a', '#d86fcf', '#e5645a', '#36c5c5', '#a38af0', '#c0c050']
export function projectLogs(name) {
  const p = cProjects[name]; if (!p) return
  closeDetail()
  const MAX = 20000
  const svcs = [...new Set(p.cs.map(svcName))].sort()
  const color = (s) => SVC_COLORS[svcs.indexOf(s) % SVC_COLORS.length]
  const o = { q: '', follow: true, hidden: new Set() }
  let lines = [], rendered = 0, raf = 0
  const d = document.createElement('div')
  d.className = 'detail'
  d.innerHTML = `<header>${ic('logs', 18)}<b>${esc(name)}</b><span class="meta">combined logs</span><button class="ib" id="x" title="Close">${ic('x')}</button></header>
    <div class="pane flush"><div class="lv"><div class="lbar2">
      <label class="search">${ic('search', 14)}<input type="text" id="pq" placeholder="Filter lines" autocomplete="off" spellcheck="false"></label>
      <label class="chk"><input type="checkbox" id="pfollow" checked> Follow</label><span class="sp"></span>
      <button class="tb" id="pclear">${ic('x', 14)}<span>Clear</span></button></div>
      <div class="lbar2" id="pchips">${svcs.map((s) => `<button type="button" class="vchip on" data-svc="${esc(s)}" style="border-color:${color(s)}"><span class="sw" style="background:${color(s)}"></span> ${esc(s)}</button>`).join('')}</div>
      <div class="lscroll" id="pscroll"><div id="plines"></div></div><div class="lstat meta" id="pstat"></div></div></div>`
  document.body.append(d)
  $('#x', d).onclick = closeDetail
  const scroll = $('#pscroll', d), box = $('#plines', d)
  const ok = (l) => !o.hidden.has(l.svc) && (!o.q || plainOf(l.text).toLowerCase().includes(o.q.toLowerCase()))
  const mk = (l) => { const e = document.createElement('div'); e.className = 'll ' + lineLevel(plainOf(l.text)); e.innerHTML = `<span class="psvc" style="color:${color(l.svc)}">${esc(l.svc.padEnd(Math.min(16, Math.max(...svcs.map((x) => x.length)))))}</span> ${logLineHtml(l.text, o.q) || ' '}`; return e }
  const flush = () => {
    raf = 0
    const frag = document.createDocumentFragment()
    for (; rendered < lines.length; rendered++) if (ok(lines[rendered])) frag.append(mk(lines[rendered]))
    box.append(frag)
    $('#pstat', d).textContent = `${lines.length.toLocaleString()} lines from ${p.cs.length} container${p.cs.length === 1 ? '' : 's'}`
    if (o.follow) scroll.scrollTop = scroll.scrollHeight
  }
  const renderAll = () => { box.textContent = ''; rendered = 0; flush() }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(flush) }
  for (const c of p.cs) {
    const svc = svcName(c); let partial = ''
    const stop = stream('logs', { id: c.Id, tail: '100', ts: '0' }, (m) => {
      if (m.k !== 'data') return
      const parts = (partial + m.d.replace(/\r/g, '')).split('\n'); partial = parts.pop()
      if (!parts.length) return
      for (const t of parts) lines.push({ svc, text: t })
      if (lines.length > MAX) { lines = lines.slice(-MAX + 2000); renderAll() } else schedule()
    })
    stops.push(stop)
  }
  let tmr
  $('#pq', d).addEventListener('input', (e) => { clearTimeout(tmr); tmr = setTimeout(() => { o.q = e.target.value; renderAll() }, 180) })
  $('#pfollow', d).onchange = (e) => { o.follow = e.target.checked; if (o.follow) scroll.scrollTop = scroll.scrollHeight }
  $('#pclear', d).onclick = () => { lines = []; renderAll() }
  $('#pchips', d).onclick = (e) => {
    const b = e.target.closest('[data-svc]'); if (!b) return
    const sv = b.dataset.svc
    o.hidden.has(sv) ? o.hidden.delete(sv) : o.hidden.add(sv)
    b.classList.toggle('on', !o.hidden.has(sv)); b.style.opacity = o.hidden.has(sv) ? .45 : 1
    renderAll()
  }
  scroll.addEventListener('scroll', () => {
    const atBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 24
    if (atBottom !== o.follow && !raf) { o.follow = atBottom; $('#pfollow', d).checked = atBottom }
  })
}
export function placeMenu(btn) {
  const m = $('#menu'); m.hidden = false
  const b = btn.getBoundingClientRect(), mh = m.offsetHeight
  m.style.left = Math.max(8, b.right - 200) + 'px'
  m.style.top = (b.bottom + mh + 8 > innerHeight - 30 ? b.top - mh - 4 : b.bottom + 4) + 'px'
}
