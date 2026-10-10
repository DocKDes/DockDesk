// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { cname } from './containers.js'
import { $, api, fmt, settings, toast } from './core.js'
import { liveHtml, topHtml } from './dashboard.js'
import { renderStatus } from './shell.js'

export let updateAvail = null // { latest, current, install } when a newer version exists
export const engine = { up: true, version: '', ncpu: 0, memTotal: 0, disk: 0 }
export let stats = {} // container id -> { cpu, memUsed, ... }
export const hist = { cpu: [], mem: [] } // last ~5 minutes of totals (one sample per 5 s), for the Overview sparklines

export async function refreshInfo() {
  try {
    const [info, df] = await Promise.all([api('info'), api('df')])
    engine.version = info.ServerVersion; engine.ncpu = info.NCPU; engine.memTotal = info.MemTotal
    const sum = (a, f) => (a || []).reduce((x, y) => x + (f(y) || 0), 0)
    engine.disk = (df.LayersSize || 0) + sum(df.Volumes, (v) => (v.UsageData?.Size > 0 ? v.UsageData.Size : 0)) + sum(df.BuildCache, (c) => c.Size)
    renderStatus()
  } catch {}
}
export async function refreshStats() {
  if (document.hidden || !engine.up || !settings.stats) return
  try {
    stats = await api('stats.all')
    checkAlerts().catch(() => {})
    const t = totals()
    hist.cpu.push(t.cpu); hist.mem.push(t.mem)
    if (hist.cpu.length > 60) { hist.cpu.shift(); hist.mem.shift() }
    applyStats()
  } catch {}
}
// Resource alerts: a container above the CPU or memory threshold for 3 samples in a row (about 15 s) raises one
// notification, and is re-armed once it drops back under. Memory is a share of the container's own limit,
// or of the host's memory when it has none.
export const breach = new Map() // "id|cpu" or "id|mem" -> { n: consecutive samples over, fired }
async function checkAlerts() {
  if (!settings.alertCpu && !settings.alertMem) return breach.clear()
  let names = null // container names are looked up only when an alert actually fires
  const seen = new Set()
  for (const [id, s] of Object.entries(stats)) {
    for (const [kind, over, text] of [
      ['cpu', settings.alertCpu > 0 && s.cpu >= settings.alertCpu, `CPU at ${s.cpu.toFixed(0)}% (limit ${settings.alertCpu}%)`],
      ['mem', settings.alertMem > 0 && s.memLimit > 0 && (s.memUsed / s.memLimit) * 100 >= settings.alertMem, `memory at ${((s.memUsed / s.memLimit) * 100).toFixed(0)}% of ${fmt(s.memLimit)} (limit ${settings.alertMem}%)`]
    ]) {
      const key = id + '|' + kind; seen.add(key)
      const b = breach.get(key) || { n: 0, fired: false }
      b.n = over ? b.n + 1 : 0
      if (!over) b.fired = false
      if (b.n >= 3 && !b.fired) {
        b.fired = true
        names ||= new Map((await api('containers.list').catch(() => [])).map((c) => [c.Id, cname(c)]))
        const name = names.get(id) || id.slice(0, 12), msg = `${name}: ${text}`
        if ('Notification' in window && Notification.permission === 'granted') new Notification('High resource usage', { body: msg })
        toast(msg, true)
      }
      breach.set(key, b)
    }
  }
  for (const k of breach.keys()) if (!seen.has(k)) breach.delete(k)
}
export const totals = () => Object.values(stats).reduce((a, s) => ({ cpu: a.cpu + s.cpu, mem: a.mem + s.memUsed }), { cpu: 0, mem: 0 })

export function applyStats() {
  const t = totals()
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v }
  set('#u-cpu', t.cpu.toFixed(2) + '%'); set('#u-mem', fmt(t.mem))
  document.querySelectorAll('[data-cpu]').forEach((td) => {
    const s = stats[td.dataset.cpu]
    td.textContent = s ? s.cpu.toFixed(2) + '%' : td.dataset.run === '1' ? '–' : '0%'
  })
  document.querySelectorAll('[data-pstat]').forEach((td) => {
    const ids = td.dataset.pstat.split(',').filter(Boolean).map((id) => stats[id]).filter(Boolean)
    td.textContent = ids.length ? `${ids.reduce((a, x) => a + x.cpu, 0).toFixed(2)}% · ${fmt(ids.reduce((a, x) => a + x.memUsed, 0))}` : '–'
  })
  const cpuEl = $('#cp-cpu')
  if (cpuEl) {
    const ids = [...new Set([...document.querySelectorAll('[data-pstat]')].flatMap((td) => td.dataset.pstat.split(',').filter(Boolean)))].map((id) => stats[id]).filter(Boolean)
    cpuEl.textContent = ids.length ? ids.reduce((a, x) => a + x.cpu, 0).toFixed(2) + '%' : '–'
    $('#cp-mem').textContent = ids.length ? fmt(ids.reduce((a, x) => a + x.memUsed, 0)) : '–'
  }
  const dl = $('#d-live'); if (dl) dl.innerHTML = liveHtml()
  const dt = $('#d-top'); if (dt) dt.innerHTML = topHtml()
  renderStatus()
}
export const setUpdateAvail = (v) => { updateAvail = v } // other modules cannot assign to an imported binding
export const setStats = (v) => { stats = v } // other modules cannot assign to an imported binding
