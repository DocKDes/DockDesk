// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { $, api, esc, fmt, ic, toast } from './core.js'
import { containerSettings, filesTab } from './files.js'
import { volName } from './images.js'
import { jsonViewer } from './json-viewer.js'
import { logsTab } from './logs.js'
import { statsTab } from './stats-view.js'

// ---------- Container overview ----------
function overview(info) {
  const row = (k, v) => (v ? `<tr><th>${k}</th><td class="mono">${v}</td></tr>` : '')
  const net = info.NetworkSettings
  const ports = Object.entries(net.Ports || {}).map(([p, b]) => esc(p) + (b ? ' → ' + b.map((x) => esc(x.HostIp + ':' + x.HostPort)).join(', ') : ' (not published)')).join('<br>')
  const nets = Object.entries(net.Networks || {}).map(([n, v]) => `${esc(n)} — ${esc(v.IPAddress || 'no IP')}${v.Gateway ? ' (gw ' + esc(v.Gateway) + ')' : ''}`).join('<br>')
  const mounts = (info.Mounts || []).map((m) => `${esc(m.Name ? volName(m.Name) : m.Source)} → ${esc(m.Destination)} <span class="meta">${m.Type}${m.RW ? '' : ', read-only'}</span>`).join('<br>')
  const list = (a) => (a || []).map(esc).join('<br>')
  const st = info.State
  return `<table class="kv"><tbody>
    ${row('ID', esc(info.Id.slice(0, 12)))}
    ${row('Image', esc(info.Config.Image))}
    ${row('Command', esc([info.Path, ...(info.Args || [])].join(' ')))}
    ${row('Status', esc(st.Status) + (st.Running ? ` since ${esc(st.StartedAt)}` : ` (exit code ${st.ExitCode})`) + (st.Health ? ` · health: ${esc(st.Health.Status)}` : ''))}
    ${row('Created', esc(info.Created))}
    ${row('Restart policy', esc(info.HostConfig.RestartPolicy?.Name || 'no') + (info.RestartCount ? ` (restarted ${info.RestartCount}×)` : ''))}
    ${row('Ports', ports)}${row('Networks', nets)}${row('Mounts', mounts)}
    ${row('Working dir', esc(info.Config.WorkingDir))}${row('User', esc(info.Config.User))}
    ${row('Memory limit', info.HostConfig.Memory ? fmt(info.HostConfig.Memory) : '')}
    ${row('Privileged', info.HostConfig.Privileged ? 'yes' : '')}
  </tbody></table>
  <details><summary>Environment (${(info.Config.Env || []).length})</summary><div class="mono pad">${list(info.Config.Env)}</div></details>
  <details><summary>Labels (${Object.keys(info.Config.Labels || {}).length})</summary><div class="mono pad">${list(Object.entries(info.Config.Labels || {}).map(([k, v]) => `${k}=${v}`))}</div></details>`
}

// ---------- Container detail drawer ----------
export let stops = []
export function closeDetail() { stops.forEach((f) => f()); stops = []; $('.detail')?.remove() }

export async function openDetail(id, first = 'Overview') {
  closeDetail()
  let info
  try { info = await api('container.inspect', id) } catch (e) { return toast(e.message, true) }
  const d = document.createElement('div')
  d.className = 'detail'
  d.innerHTML = `<header><span class="dot ${info.State.Status}"></span><b>${esc(info.Name.replace(/^\//, ''))}</b><span class="meta mono">${esc(info.Config.Image)}</span><button class="ib" id="x" title="Close">${ic('x')}</button></header>
    <div class="tabs">${[['Overview', 'info'], ['Logs', 'logs'], ['Stats', 'activity'], ['Files', 'folder'], ['Settings', 'sliders'], ['Inspect', 'box']].map(([t, i]) => `<a data-t="${t}">${ic(i, 14)}${t}</a>`).join('')}</div><div class="pane"></div>`
  document.body.append(d)
  $('#x', d).onclick = closeDetail
  const running = info.State.Running
  const tab = async (t) => {
    stops.forEach((f) => f()); stops = []
    d.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.t === t))
    const pane = $('.pane', d)
    pane.innerHTML = ''; pane.className = 'pane'
    if (t === 'Overview') pane.innerHTML = overview(info)
    else if (t === 'Settings') containerSettings(pane, info)
    else if (t === 'Files') filesTab(pane, info)
    else if (t === 'Inspect') jsonViewer(pane, info, 'container')
    else if (!running && t !== 'Logs') pane.innerHTML = '<div class="empty">Container is not running</div>'
    else if (t === 'Logs') logsTab(pane, info)
    else if (t === 'Stats') statsTab(pane, info)
  }
  d.querySelector('.tabs').onclick = (e) => { const t = e.target.closest('[data-t]')?.dataset.t; if (t) tab(t) }
  tab(first)
}
