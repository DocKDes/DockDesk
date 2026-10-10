// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { stops } from './container-detail.js'
import { $, esc, fmt, ic, rel, stream } from './core.js'
import { spark } from './dashboard.js'
import { engine } from './state.js'

// ---------- Container stats: tiles with live sparklines and per-second rates ----------
export function statsTab(pane, info) {
  pane.innerHTML = `<div id="s" class="stats"><div class="meta">Waiting for the first sample…</div></div>`
  const h = { cpu: [], mem: [], net: [], io: [] }
  const keep = (a, v) => { a.push(v); if (a.length > 60) a.shift() }
  let prev = null
  const cores = engine.ncpu || 1
  const started = Date.parse(info.State?.StartedAt || '')
  const tile = (icon, title, big, sub, pct, sp) => `<div class="stile"><div class="sk">${ic(icon, 14)}${title}</div><div class="sv">${big}</div><div class="ss">${sub}</div>${pct == null ? '' : `<div class="bar"><i style="width:${pct}%"></i></div>`}<div class="sparkwrap">${sp}</div></div>`
  const peak = (a, min) => Math.max(min, ...a)
  stops.push(stream('stats', { id: info.Id }, (m) => {
    if (m.k !== 'data') return
    const s = m.d, now = Date.now()
    let rx = 0, tx = 0, rd = 0, wr = 0
    if (prev) {
      const dt = Math.max(0.2, (now - prev.t) / 1000), d = (a, b) => Math.max(0, (a - b) / dt)
      rx = d(s.netRx, prev.s.netRx); tx = d(s.netTx, prev.s.netTx); rd = d(s.blkRead, prev.s.blkRead); wr = d(s.blkWrite, prev.s.blkWrite)
    }
    prev = { s, t: now }
    keep(h.cpu, s.cpu); keep(h.mem, s.memUsed); keep(h.net, rx + tx); keep(h.io, rd + wr)
    const limited = s.memLimit && (!engine.memTotal || s.memLimit < engine.memTotal * 0.98)
    const memPct = limited ? Math.min(100, (s.memUsed / s.memLimit) * 100) : engine.memTotal ? Math.min(100, (s.memUsed / engine.memTotal) * 100) : 0
    const up = started ? rel(info.State.StartedAt).replace(' ago', '') : ''
    $('#s', pane).innerHTML = `
      <div class="shead"><span class="live"></span><b>Live</b><span class="meta">${s.pids} process${s.pids === 1 ? '' : 'es'}${up ? ' · up ' + esc(up) : ''} · updates every second</span></div>
      ${tile('activity', 'CPU', s.cpu.toFixed(2) + '%', `of ${cores} CPUs · ${(s.cpu / cores).toFixed(1)}% of capacity`, Math.max(Math.min(100, s.cpu / cores), s.cpu > 0 ? 1 : 0), spark(h.cpu, peak(h.cpu, 5)))}
      ${tile('database', 'Memory', fmt(s.memUsed), limited ? `of ${fmt(s.memLimit)} limit · ${memPct.toFixed(1)}%` : `no limit · ${memPct.toFixed(1)}% of this computer`, Math.max(memPct, s.memUsed > 0 ? 1 : 0), spark(h.mem, limited ? s.memLimit : peak(h.mem, 1)))}
      ${tile('network', 'Network', `<span class="dn">↓</span> ${fmt(rx)}/s <span class="up2">↑</span> ${fmt(tx)}/s`, `total ↓ ${fmt(s.netRx)} · ↑ ${fmt(s.netTx)}`, null, spark(h.net, peak(h.net, 1024)))}
      ${tile('download', 'Disk I/O', `<span class="dn">R</span> ${fmt(rd)}/s <span class="up2">W</span> ${fmt(wr)}/s`, `total read ${fmt(s.blkRead)} · written ${fmt(s.blkWrite)}`, null, spark(h.io, peak(h.io, 1024)))}`
  }))
}
