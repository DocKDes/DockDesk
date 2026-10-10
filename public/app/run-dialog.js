// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { $, $$, api, confirm, copyText, esc, ic, prompt, shq, toast } from './core.js'
import { closeModal } from './dialogs.js'
import { go_ } from './shell.js'

// ---- Run dialog helpers: a "spec" is the form's content: { image, name, ports: [[host, container, proto]], volumes: [[host, container]], env: [[k, v]], bind, net, restart, mem, cpu, caps: [], dev: [], it, priv }
function runCommand(sp) {
  const a = ['docker run -d']
  if (sp.name) a.push('--name', shq(sp.name))
  if (sp.it) a.push('-it')
  if (sp.net && sp.net !== 'bridge') a.push('--network', shq(sp.net))
  if (sp.net !== 'host') for (const [h, c, pr] of sp.ports) if (c) a.push('-p', `${sp.bind || '127.0.0.1'}:${h}:${c}${pr === 'udp' ? '/udp' : ''}`)
  for (const [h, c] of sp.volumes) if (h && c) a.push('-v', shq(`${h}:${c}`))
  for (const [k, v] of sp.env) if (k) a.push('-e', shq(`${k}=${v}`))
  if (sp.restart && sp.restart !== 'no') a.push('--restart', sp.restart)
  if (sp.mem) a.push('--memory', `${sp.mem}m`)
  if (sp.cpu) a.push('--cpus', String(sp.cpu))
  for (const c of sp.caps) a.push('--cap-add', c.toUpperCase())
  for (const d of sp.dev) a.push('--device', shq(d))
  if (sp.priv) a.push('--privileged')
  a.push(shq(sp.image))
  return a.join(' ')
}
function composeFromSpec(sp) {
  const q = (x) => JSON.stringify(String(x)) // a JSON string is a valid YAML string
  const svc = (sp.name || sp.image.split('/').pop().split(':')[0] || 'app').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'app'
  const L = ['services:', `  ${svc}:`, `    image: ${q(sp.image)}`]
  if (sp.name) L.push(`    container_name: ${q(sp.name)}`)
  const ports = sp.net === 'host' ? [] : sp.ports.filter(([, c]) => c)
  if (ports.length) { L.push('    ports:'); for (const [h, c, pr] of ports) L.push(`      - ${q(`${sp.bind || '127.0.0.1'}:${h}:${c}${pr === 'udp' ? '/udp' : ''}`)}`) }
  const vols = sp.volumes.filter(([h, c]) => h && c)
  if (vols.length) { L.push('    volumes:'); for (const [h, c] of vols) L.push(`      - ${q(`${h}:${c}`)}`) }
  const env = sp.env.filter(([k]) => k)
  if (env.length) { L.push('    environment:'); for (const [k, v] of env) L.push(`      - ${q(`${k}=${v}`)}`) }
  if (sp.restart && sp.restart !== 'no') L.push(`    restart: ${sp.restart}`)
  if (sp.mem) L.push(`    mem_limit: ${q(sp.mem + 'm')}`)
  if (sp.cpu) L.push(`    cpus: ${sp.cpu}`)
  if (sp.caps.length) { L.push('    cap_add:'); for (const c of sp.caps) L.push(`      - ${c.toUpperCase()}`) }
  if (sp.dev.length) { L.push('    devices:'); for (const d of sp.dev) L.push(`      - ${q(d)}`) }
  if (sp.priv) L.push('    privileged: true')
  if (sp.it) L.push('    tty: true', '    stdin_open: true')
  const custom = sp.net && !['bridge', 'host', 'none'].includes(sp.net)
  if (sp.net === 'host' || sp.net === 'none') L.push(`    network_mode: ${sp.net}`)
  else if (custom) L.push('    networks:', `      - ${q(sp.net)}`)
  if (custom) L.push('', 'networks:', `  ${q(sp.net)}:`, '    external: true')
  return L.join('\n') + '\n'
}
// Split a shell command line into words (quotes and backslashes only; no expansion).
function shellWords(text) {
  const out = []; let cur = '', has = false, q = '', i = 0
  text = text.replace(/\\\r?\n/g, ' ')
  for (; i < text.length; i++) {
    const ch = text[i]
    if (q) { if (ch === q) q = ''; else if (ch === '\\' && q === '"' && /["\\$`]/.test(text[i + 1] || '')) cur += text[++i]; else cur += ch }
    else if (ch === '"' || ch === "'") { q = ch; has = true }
    else if (ch === '\\') { cur += text[++i] ?? ''; has = true }
    else if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ''; has = false }
    else cur += ch
  }
  if (cur || has) out.push(cur)
  return out
}
// The reverse of runCommand: read a `docker run …` line back into a spec. Returns { spec, skipped: [flags we don't know] }.
function parseRunCommand(text) {
  let w = shellWords(String(text).trim().replace(/^\$\s*/, ''))
  if (w[0] === 'sudo') w = w.slice(1)
  if (w[0] !== 'docker') throw new Error('That does not start with “docker run”')
  w = w.slice(1)
  if (w[0] === 'container') w = w.slice(1)
  if (w[0] !== 'run') throw new Error('That does not start with “docker run”')
  w = w.slice(1)
  const sp = { image: '', name: '', ports: [], volumes: [], env: [], bind: '127.0.0.1', net: 'bridge', restart: 'no', mem: '', cpu: '', caps: [], dev: [], it: false, priv: false }
  const skipped = []
  const WITH_VALUE = new Set(['--name', '-p', '--publish', '-v', '--volume', '-e', '--env', '--network', '--net', '--restart', '-m', '--memory', '--cpus', '--cap-add', '--device'])
  const SKIP_VALUE = new Set(['-w', '--workdir', '-u', '--user', '-h', '--hostname', '--entrypoint', '-l', '--label', '--env-file', '--add-host', '--dns', '--platform', '--pull', '--log-driver', '--ulimit', '--shm-size', '--memory-swap', '--cpu-shares', '--health-cmd', '--mount', '--tmpfs', '--security-opt', '--pid', '--ipc', '--ip', '--expose', '--group-add', '--runtime', '--gpus', '--stop-signal', '--stop-timeout', '--workdir'])
  let i = 0
  for (; i < w.length; i++) {
    let a = w[i], val
    if (!a.startsWith('-') || a === '-') break
    if (a.startsWith('--') && a.includes('=')) { val = a.slice(a.indexOf('=') + 1); a = a.slice(0, a.indexOf('=')) }
    if (/^-[a-zA-Z]{2,}$/.test(a) && !WITH_VALUE.has(a)) { // combined short flags like -dit
      for (const f of a.slice(1)) { if (f === 'i' || f === 't') sp.it = true; else if (!'d'.includes(f)) skipped.push('-' + f) }
      continue
    }
    const next = () => (val !== undefined ? val : w[++i])
    if (a === '-d' || a === '--detach' || a === '--rm' || a === '--init') continue
    if (a === '-i' || a === '-t' || a === '--interactive' || a === '--tty') { sp.it = true; continue }
    if (a === '--privileged') { sp.priv = val !== 'false'; continue }
    if (WITH_VALUE.has(a)) {
      const v = next() ?? ''
      if (a === '--name') sp.name = v
      else if (a === '-p' || a === '--publish') {
        const parts = v.split('/'); const proto = parts[1] === 'udp' ? 'udp' : 'tcp'
        const seg = parts[0].split(':')
        let host = '', cont = ''
        if (seg.length === 1) cont = seg[0]
        else if (seg.length === 2) [host, cont] = seg
        else { if (seg[0] === '0.0.0.0' || seg[0] === '127.0.0.1') sp.bind = seg[0]; else skipped.push(`${seg[0]} (bind address)`); host = seg[1]; cont = seg[2] }
        if (!/^\d+$/.test(cont)) skipped.push('-p ' + v); else sp.ports.push([host, cont, proto])
      }
      else if (a === '-v' || a === '--volume') { const k = v.indexOf(':'); if (k < 0) skipped.push('-v ' + v); else { const dst = v.slice(k + 1); if (/:(ro|z|Z)$/.test(dst)) skipped.push(`${v} (volume options)`); sp.volumes.push([v.slice(0, k), dst.replace(/:(ro|rw|z|Z)$/, '')]) } }
      else if (a === '-e' || a === '--env') { const k = v.indexOf('='); sp.env.push(k < 0 ? [v, ''] : [v.slice(0, k), v.slice(k + 1)]) }
      else if (a === '--network' || a === '--net') sp.net = v
      else if (a === '--restart') sp.restart = v.replace(/:\d+$/, '')
      else if (a === '-m' || a === '--memory') { const mm = /^(\d+(?:\.\d+)?)([bkmg]?)$/i.exec(v); if (mm) sp.mem = String(Math.max(1, Math.round(Number(mm[1]) * ({ b: 1 / 1048576, k: 1 / 1024, m: 1, g: 1024, '': 1 / 1048576 }[mm[2].toLowerCase()])))); else skipped.push('--memory ' + v) }
      else if (a === '--cpus') sp.cpu = v
      else if (a === '--cap-add') sp.caps.push(v)
      else if (a === '--device') sp.dev.push(v.split(':')[0])
      continue
    }
    skipped.push(a); if (SKIP_VALUE.has(a) && val === undefined) i++
  }
  sp.image = w[i] || ''
  if (!sp.image) throw new Error('No image name found in that command')
  return { spec: sp, skipped }
}
const RUN_PRESETS_KEY = 'runPresets'
export const loadPresets = () => { try { return JSON.parse(localStorage.getItem(RUN_PRESETS_KEY) || '{}') } catch { return {} } }
export const savePresets = (o) => { try { localStorage.setItem(RUN_PRESETS_KEY, JSON.stringify(o)) } catch { toast('Could not save presets in this browser', true) } }

// "Run a new container" dialog: name, ports, volumes, environment variables.
export async function runImage(ref) {
  closeModal()
  let exposed = [], nets = [], img = ref
  try {
    const imgInfo = await api('image.inspect', ref)
    exposed = Object.keys(imgInfo.Config?.ExposedPorts || {}).map((p) => p.split('/')) // [['5432','tcp']]
    nets = (await api('networks.list')).map((n) => n.Name).filter((n) => !['bridge', 'host', 'none'].includes(n))
  } catch (e) { return toast(e.message, true) }
  const m = document.createElement('div')
  m.className = 'modal'
  const rowsOf = (kind) => `<div class="rows" data-kind="${kind}"></div><button type="button" class="tb" data-add="${kind}">${ic('plus', 14)}<span>Add ${kind === 'ports' ? 'port' : kind === 'volumes' ? 'volume' : 'variable'}</span></button>`
  m.innerHTML = `<div class="box wide"><h3>${ic('play', 18)}Run a new container</h3>
    <p class="meta mono" id="rimg">${esc(ref)}</p>
    <div class="presetbar"><select id="rpre"></select><button type="button" class="tb" id="rpsave" title="Save this setup under a name">${ic('copy', 14)}<span>Save preset</span></button><button type="button" class="tb" id="rpdel" hidden>${ic('trash', 14)}<span>Delete</span></button><span class="sp"></span><button type="button" class="tb" id="rpaste" title="Fill the form from a docker run command">${ic('terminal', 14)}<span>Paste docker run…</span></button></div>
    <div id="rpastebox" class="pastebox" hidden><textarea class="yaml" spellcheck="false" placeholder="docker run -d --name web -p 8080:80 nginx:alpine"></textarea><div class="row"><button type="button" class="tb pri" id="rpapply">Fill the form</button></div></div>
    <form>
      <label class="fld">Container name<input type="text" id="rn" placeholder="Leave empty for a random name" autocomplete="off" spellcheck="false"></label>
      <div class="fld">Ports <span class="meta">(host port empty = random)</span>${rowsOf('ports')}<div id="rwarn"></div></div>
      <div class="fld">Volumes <span class="meta">(host path or volume name → container path)</span>${rowsOf('volumes')}</div>
      <div class="fld">Environment variables${rowsOf('env')}</div>
      <details class="fld adv"><summary>Advanced options</summary>
        <label class="fld">Publish ports on<select id="ra-bind"><option value="127.0.0.1">This computer only (recommended)</option><option value="0.0.0.0">All network interfaces (reachable from your LAN)</option></select></label>
        <label class="fld">Network<select id="ra-net"><option>bridge</option><option>host</option><option>none</option>${nets.map((n) => `<option>${esc(n)}</option>`).join('')}</select></label>
        <div class="meta" id="ra-hostnote" hidden>Host mode shares this computer's network stack: the container can see and bind every host port, and published ports are ignored.</div>
        <label class="fld">Restart policy<select id="ra-restart"><option value="no">Never</option><option value="unless-stopped">Unless stopped</option><option value="always">Always</option><option value="on-failure">On failure</option></select></label>
        <div class="two"><label class="fld">Memory limit (MB)<input type="text" id="ra-mem" placeholder="unlimited" inputmode="numeric"></label><label class="fld">CPUs<input type="text" id="ra-cpu" placeholder="unlimited" inputmode="decimal"></label></div>
        <label class="fld">Capabilities (comma separated)<input type="text" id="ra-caps" placeholder="NET_ADMIN, NET_RAW" spellcheck="false"></label>
        <label class="fld">Devices (comma separated, under /dev)<input type="text" id="ra-dev" placeholder="/dev/net/tun" spellcheck="false"></label>
        <label class="chk"><input type="checkbox" id="ra-it"> Keep it open with a terminal (needed for shell images such as Kali)</label>
        <label class="chk danger"><input type="checkbox" id="ra-priv"> Privileged: full access to this machine's devices and kernel</label>
      </details>
      <div class="row"><button type="button" class="tb" id="rcopy" title="Copy the equivalent docker run command">${ic('terminal', 15)}<span>Copy as docker run</span></button><button type="button" class="tb" id="rccopy" title="Copy as a compose file">${ic('layers', 15)}<span>Copy as Compose</span></button><span class="sp"></span><button type="button" class="tb" id="rcancel">Cancel</button><button class="tb pri" id="rgo">${ic('play', 15)}<span>Run</span></button></div>
    </form><div id="rerr"></div></div>`
  document.body.append(m)
  const form = $('form', m)
  const addRow = (kind, a = '', b = '') => {
    const d = document.createElement('div'); d.className = 'rrow'
    d.innerHTML = kind === 'ports'
      ? `<input type="text" placeholder="host" value="${esc(a)}" inputmode="numeric"><span>:</span><input type="text" placeholder="container" value="${esc(b)}" inputmode="numeric"><select><option>tcp</option><option>udp</option></select>`
      : kind === 'volumes'
        ? `<input type="text" placeholder="/host/path or volume" value="${esc(a)}"><span>→</span><input type="text" placeholder="/container/path" value="${esc(b)}">`
        : `<input type="text" placeholder="KEY" value="${esc(a)}"><span>=</span><input type="text" placeholder="value" value="${esc(b)}">`
    d.insertAdjacentHTML('beforeend', `<button type="button" class="ib" title="Remove">${ic('x', 14)}</button>`)
    d.querySelector('button').onclick = () => d.remove()
    $(`.rows[data-kind="${kind}"]`, m).append(d)
  }
  exposed.forEach(([p, proto]) => { addRow('ports', '', p); if (proto === 'udp') [...$$('.rows[data-kind="ports"] select', m)].pop().value = 'udp' })
  m.onclick = (e) => { if (e.target === m) closeModal(); const a = e.target.closest('[data-add]'); if (a) addRow(a.dataset.add) }
  $('#rcancel', m).onclick = closeModal
  $('#rn', m).focus()
  $('#ra-net', m).onchange = (e) => ($('#ra-hostnote', m).hidden = e.target.value !== 'host')
  const collect = (kind) => [...$$(`.rows[data-kind="${kind}"] .rrow`, m)].map((r) => [...r.querySelectorAll('input,select')].map((x) => x.value))
  const list = (id) => $(id, m).value.split(',').map((x) => x.trim()).filter(Boolean)
  const readSpec = () => ({
    image: img, name: $('#rn', m).value.trim(), ports: collect('ports'), volumes: collect('volumes'), env: collect('env'),
    bind: $('#ra-bind', m).value, net: $('#ra-net', m).value, restart: $('#ra-restart', m).value,
    mem: Number($('#ra-mem', m).value) || '', cpu: Number($('#ra-cpu', m).value) || '', caps: list('#ra-caps'), dev: list('#ra-dev'),
    it: $('#ra-it', m).checked, priv: $('#ra-priv', m).checked
  })
  const writeSpec = (sp) => {
    img = sp.image || img; $('#rimg', m).textContent = img
    for (const k of ['ports', 'volumes', 'env']) $(`.rows[data-kind="${k}"]`, m).textContent = ''
    sp.ports.forEach(([h, c, pr]) => { addRow('ports', h, c); if (pr === 'udp') [...$$('.rows[data-kind="ports"] select', m)].pop().value = 'udp' })
    sp.volumes.forEach(([h, c]) => addRow('volumes', h, c)); sp.env.forEach(([k, v]) => addRow('env', k, v))
    $('#rn', m).value = sp.name || ''
    $('#ra-bind', m).value = sp.bind === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1'
    const net = $('#ra-net', m)
    if (sp.net && ![...net.options].some((o) => o.value === sp.net)) net.add(new Option(sp.net))
    net.value = sp.net || 'bridge'; $('#ra-hostnote', m).hidden = net.value !== 'host'
    $('#ra-restart', m).value = ['no', 'unless-stopped', 'always', 'on-failure'].includes(sp.restart) ? sp.restart : 'no'
    $('#ra-mem', m).value = sp.mem || ''; $('#ra-cpu', m).value = sp.cpu || ''
    $('#ra-caps', m).value = (sp.caps || []).join(', '); $('#ra-dev', m).value = (sp.dev || []).join(', ')
    $('#ra-it', m).checked = !!sp.it; $('#ra-priv', m).checked = !!sp.priv
    if (sp.net !== 'bridge' || sp.restart !== 'no' || sp.mem || sp.cpu || sp.caps?.length || sp.dev?.length || sp.it || sp.priv || sp.bind === '0.0.0.0') $('.adv', m).open = true
    checkPorts()
  }
  $('#rcopy', m).onclick = async () => { const ok = await copyText(runCommand(readSpec())); toast(ok ? 'Copied the docker run command' : 'Could not copy', !ok) }
  $('#rccopy', m).onclick = async () => { const ok = await copyText(composeFromSpec(readSpec())); toast(ok ? 'Copied as a compose file' : 'Could not copy', !ok) }
  // presets (kept in this browser)
  const drawPresets = (cur = '') => {
    const ps = loadPresets()
    $('#rpre', m).innerHTML = '<option value="">Presets…</option>' + Object.keys(ps).sort().map((n) => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('')
    $('#rpdel', m).hidden = !cur
  }
  drawPresets()
  $('#rpre', m).onchange = (e) => { const sp = loadPresets()[e.target.value]; drawPresets(e.target.value); if (sp) { writeSpec(sp); toast(`Loaded “${e.target.value}”${sp.image !== ref ? ` (image ${sp.image})` : ''}`) } }
  $('#rpsave', m).onclick = () => {
    const name = (prompt('Save this setup as…', $('#rpre', m).value || $('#rn', m).value.trim() || img.split('/').pop().split(':')[0]) || '').trim().slice(0, 60)
    if (!name) return
    const ps = loadPresets(); ps[name] = readSpec(); savePresets(ps); drawPresets(name); toast(`Saved preset “${name}”`)
  }
  $('#rpdel', m).onclick = () => { const n = $('#rpre', m).value; if (!n || !confirm(`Delete the preset “${n}”?`)) return; const ps = loadPresets(); delete ps[n]; savePresets(ps); drawPresets(); toast('Preset deleted') }
  // paste a `docker run …` command to fill the form
  $('#rpaste', m).onclick = () => { const b = $('#rpastebox', m); b.hidden = !b.hidden; if (!b.hidden) $('textarea', b).focus() }
  $('#rpapply', m).onclick = () => {
    try {
      const { spec, skipped } = parseRunCommand($('#rpastebox textarea', m).value)
      writeSpec(spec); $('#rpastebox', m).hidden = true
      toast(skipped.length ? `Filled the form. Not supported here, so left out: ${skipped.join(', ')}` : 'Filled the form from the command', !!skipped.length)
    } catch (err) { toast(err.message, true) }
  }
  // warn about host ports that something else already uses
  let portTmr, portSeq = 0
  const checkPorts = () => {
    clearTimeout(portTmr)
    portTmr = setTimeout(async () => {
      const seq = ++portSeq, hosts = collect('ports').map((r) => Number(r[0])).filter((n) => n > 0)
      const w = $('#rwarn', m)
      if (!hosts.length || $('#ra-net', m).value === 'host') { w.innerHTML = ''; return }
      try {
        const used = await api('ports.check', hosts)
        if (seq !== portSeq || !m.isConnected) return
        const bad = Object.entries(used)
        w.innerHTML = bad.length ? `<div class="warnbox">${ic('info', 15)}<div>${bad.map(([pt, who]) => `Port <b>${pt}</b> is already in use by ${esc(who)}.`).join('<br>')}<div class="meta">Docker will fail to start the container. Pick another host port, or leave it empty for a random one.</div></div></div>` : ''
      } catch { w.innerHTML = '' }
    }, 300)
  }
  m.addEventListener('input', (e) => { if (e.target.closest('.rows[data-kind="ports"]')) checkPorts() })
  checkPorts()
  form.onsubmit = async (e) => {
    e.preventDefault()
    const go = $('#rgo', m); go.disabled = true
    $('#rerr', m).innerHTML = ''
    if ($('#ra-priv', m).checked && !confirm('Privileged containers can take over this machine (they get its devices and can change the kernel). Run it privileged anyway?')) { go.disabled = false; return }
    try {
      await api('container.run', {
        bindIp: $('#ra-bind', m).value, network: $('#ra-net', m).value, restart: $('#ra-restart', m).value,
        memoryMb: Number($('#ra-mem', m).value) || 0, cpus: Number($('#ra-cpu', m).value) || 0,
        caps: list('#ra-caps'), devices: list('#ra-dev'), interactive: $('#ra-it', m).checked, privileged: $('#ra-priv', m).checked,
        image: img, name: $('#rn', m).value,
        ports: collect('ports').map(([host, container, proto]) => ({ host, container, proto })),
        volumes: collect('volumes').map(([host, container]) => ({ host, container })),
        env: collect('env').map(([key, value]) => ({ key, value }))
      })
      toast(`Started a container from ${img}`); closeModal(); go_('containers')
    } catch (err) { $('#rerr', m).innerHTML = `<div class="err">${esc(err.message)}</div>`; go.disabled = false }
  }
}
