// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { cname } from './containers.js'
import { api, call, esc, fmt, ic, settings, tbtn, tr } from './core.js'
import { activity } from './events.js'
import { LABS } from './labs.js'
import { engine, hist, stats, totals } from './state.js'

// ---------- Overview ----------
let dashCs = [] // containers as of the last Overview refresh

// Tiny inline sparkline: a filled line of the last 60 samples, right-aligned.
export function spark(vals, peak, w = 240, h = 44) {
  const base = `<line x1="0" y1="${h - 2}" x2="${w}" y2="${h - 2}" stroke="currentColor" stroke-width="1" stroke-dasharray="3 4" opacity=".35" vector-effect="non-scaling-stroke"/>`
  if (vals.length < 6) return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${base}</svg>` // too few samples to draw a meaningful line yet
  const step = w / 59, m = Math.max(peak, 1e-9)
  const pts = vals.map((v, i) => `${(w - (vals.length - 1 - i) * step).toFixed(1)},${(h - 3 - (Math.min(v, m) / m) * (h - 6)).toFixed(1)}`)
  const x0 = pts[0].split(',')[0]
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${base}<polygon points="${pts.join(' ')} ${w},${h} ${x0},${h}" fill="currentColor" opacity=".12"/><polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`
}

export function liveHtml() {
  const t = totals(), cores = engine.ncpu || 1
  const cpuPct = Math.min(100, t.cpu / cores), memPct = engine.memTotal ? Math.min(100, (t.mem / engine.memTotal) * 100) : 0
  if (!settings.stats) return `<div class="meta">Live CPU and memory is turned off. Turn it on in Settings.</div>`
  const peak = (a) => (a.length ? Math.max(...a) : 0)
  return `<div class="meter"><div class="mhead"><span>CPU</span><b>${t.cpu.toFixed(2)}%</b><span class="meta">of ${cores} CPUs · ${cpuPct.toFixed(1)}% of capacity</span></div>
      <div class="bar"><i style="width:${Math.max(cpuPct, t.cpu > 0 ? 1 : 0)}%"></i></div><div class="sparkwrap">${spark(hist.cpu, Math.max(peak(hist.cpu), 5))}</div></div>
    <div class="meter"><div class="mhead"><span>Memory</span><b>${fmt(t.mem)}</b><span class="meta">of ${fmt(engine.memTotal)} · ${memPct.toFixed(1)}%</span></div>
      <div class="bar"><i style="width:${Math.max(memPct, t.mem > 0 ? 1 : 0)}%"></i></div><div class="sparkwrap">${spark(hist.mem, Math.max(peak(hist.mem), engine.memTotal * 0.02))}</div></div>
    <div class="meta">${hist.cpu.length < 6 ? 'Collecting samples…' : `Last ${Math.max(1, Math.round(hist.cpu.length * 5 / 60))} min`} · sampled every 5 s · running containers only</div>`
}

export function topHtml() {
  const run = dashCs.filter((c) => c.State === 'running').map((c) => ({ c, s: stats[c.Id] })).sort((a, b) => (b.s?.cpu || 0) - (a.s?.cpu || 0) || (b.s?.memUsed || 0) - (a.s?.memUsed || 0)).slice(0, 6)
  if (!run.length) return `<div class="empty small">${ic('box', 26)}<div>No containers running.<br><span class="meta">Start one from Containers, or try a lab.</span></div></div>`
  return `<table class="mini"><tbody>${run.map(({ c, s: st }) => `<tr class="row-click" data-open="${c.Id}"><td class="st"><span class="dot running"></span></td>
    <td><div class="nm">${esc(cname(c))}</div><div class="sub mono">${esc(c.Image)}</div></td>
    <td class="num nw">${st ? st.cpu.toFixed(2) + '%' : '–'}</td><td class="num nw">${st ? fmt(st.memUsed) : '–'}</td></tr>`).join('')}</tbody></table>`
}

function attentionHtml(cs) {
  const items = []
  for (const c of cs) {
    const m = /^Exited \((\d+)\)/.exec(c.Status || '')
    if (c.State === 'exited' && m && m[1] !== '0' && !['137', '143'].includes(m[1])) items.push([c, 'bad', `Crashed with exit code ${m[1]}`])
    else if (/\(unhealthy\)/.test(c.Status || '')) items.push([c, 'bad', 'Health check failing'])
    else if (c.State === 'restarting') items.push([c, 'warn', 'Restarting repeatedly'])
    else if (c.State === 'paused') items.push([c, 'warn', 'Paused'])
  }
  if (!items.length) return `<div class="allgood">${ic('info', 18)}<div><b>All good</b><div class="meta">No crashed, unhealthy or paused containers.</div></div></div>`
  return `<table class="mini"><tbody>${items.slice(0, 6).map(([c, k, why]) => `<tr class="row-click" data-open="${c.Id}"><td class="st"><span class="dot ${k === 'bad' ? 'dead' : 'paused'}"></span></td><td><div class="nm">${esc(cname(c))}</div><div class="sub">${esc(why)}</div></td><td class="num nw meta">${esc((c.Status || '').replace(/^Exited \(\d+\) /, ''))}</td></tr>`).join('')}</tbody></table>`
}

function activityMini() {
  const list = activity.slice(0, 6)
  if (!list.length) return `<div class="meta">Nothing yet. Changes show up here as they happen.</div>`
  const good = /^(start|create|pull|tag|unpause|restart)$/
  return `<table class="mini"><tbody>${list.map((e) => `<tr><td class="nw mono meta">${new Date(e.t * 1000).toLocaleTimeString()}</td><td><span class="pill ${good.test(e.action) ? 'running' : ''}">${esc(e.action)}</span></td><td class="trunc">${esc(e.name)}</td></tr>`).join('')}</tbody></table>`
}

export async function dashboard() {
  const [info, df, cs] = await Promise.all([api('info'), api('df'), api('containers.list')])
  dashCs = cs
  const sum = (a, f) => (a || []).reduce((x, y) => x + (f(y) || 0), 0)
  // Same arithmetic as `docker system df`
  const imgTotal = df.LayersSize || 0
  const imgUsed = sum((df.Images || []).filter((i) => i.Containers !== 0 && i.SharedSize >= 0), (i) => i.Size - i.SharedSize)
  const imgUnused = (df.Images || []).filter((i) => i.Containers === 0)
  const volSize = (v) => (v.UsageData?.Size > 0 ? v.UsageData.Size : 0)
  const D = {
    images: { total: imgTotal, rec: Math.max(0, imgTotal - imgUsed), n: (df.Images || []).length },
    containers: { total: sum(df.Containers, (c) => c.SizeRw), rec: sum((df.Containers || []).filter((c) => c.State !== 'running'), (c) => c.SizeRw), n: (df.Containers || []).length },
    volumes: { total: sum(df.Volumes, volSize), rec: sum((df.Volumes || []).filter((v) => v.UsageData?.RefCount === 0), volSize), n: (df.Volumes || []).length },
    cache: { total: sum(df.BuildCache, (c) => c.Size), rec: sum((df.BuildCache || []).filter((c) => !c.InUse), (c) => c.Size), n: (df.BuildCache || []).length }
  }
  const grand = D.images.total + D.containers.total + D.volumes.total + D.cache.total || 1
  const seg = [['images', 'Images', 'var(--acc)'], ['volumes', 'Volumes', 'var(--ok)'], ['containers', 'Containers', 'var(--warn)'], ['cache', 'Build cache', 'var(--mut)']]
  const projects = {}
  for (const c of cs) { const pn = c.Labels?.['com.docker.compose.project']; if (pn) (projects[pn] ||= []).push(c) }
  const projUp = Object.values(projects).filter((l) => l.some((c) => c.State === 'running')).length
  const labsUp = LABS.filter((l) => cs.some((c) => c.Labels?.['dockdesk.lab'] === l.id && c.State === 'running')).length
  const tile = (page, icon, label, big, sub) => `<div class="tile" data-call='${esc(call('goto', page))}' role="link" tabindex="0">${ic(icon, 18)}<div><div class="k">${label}</div><div class="v">${big}</div><div class="s">${sub}</div></div></div>`
  // The left part is a button that opens the matching page already filtered to the unused items, so you can see what Clean would remove
  const clean = (label, sub, right, callJson, page, filter) => `<div class="crow"><button type="button" class="cgo" title="Show them" data-call='${esc(call('showunused', page, filter))}'><span class="nm">${label}${ic('chevright', 13)}</span><span class="meta">${sub}</span></button><div class="num nw">${right}</div>${tbtn('broom', 'Clean', callJson)}</div>`
  const sizeOrNone = (n) => (n > 0 ? fmt(n) : '<span class="meta">nothing to clean</span>')
  const volUnused = (df.Volumes || []).filter((v) => v.UsageData?.RefCount === 0).length
  const stopped = cs.filter((c) => c.State !== 'running').length
  return `<div class="head"><h2>${ic('dashboard', 22)}${tr('Overview')}</h2>
      <div class="hostline"><span class="dot up"></span>Docker ${esc(info.ServerVersion)} · ${esc(info.OperatingSystem)} · ${info.NCPU} CPUs · ${fmt(info.MemTotal)}</div></div>
    <div class="tiles">
      ${tile('containers', 'box', 'Containers', `<b>${info.ContainersRunning}</b> running`, `${info.Containers} total · ${info.ContainersPaused} paused`)}
      ${tile('compose', 'layers', 'Compose projects', `<b>${projUp}</b> / ${Object.keys(projects).length}`, 'running')}
      ${tile('images', 'image', 'Images', `<b>${info.Images}</b>`, fmt(imgTotal) + ' on disk')}
      ${tile('volumes', 'database', 'Volumes', `<b>${D.volumes.n}</b>`, fmt(D.volumes.total) + ' used')}
      ${tile('labs', 'flask', 'Labs', `<b>${labsUp}</b> / ${LABS.length}`, 'running')}
    </div>
    <div class="dgrid">
      <div class="dcol">
        <div class="dcard"><div class="dtitle">${ic('activity', 16)}Live resources</div><div id="d-live">${liveHtml()}</div></div>
        <div class="dcard"><div class="dtitle">${ic('database', 16)}Disk used by Docker<span class="sp"></span><span class="meta">${fmt(grand === 1 ? 0 : grand)} total</span></div>
          <div class="stack">${seg.map(([k, , col]) => `<i style="width:${(D[k].total / grand) * 100}%;background:${col}" title="${k}"></i>`).join('')}</div>
          <div class="legend">${seg.map(([k, l, col]) => `<div class="lg"><span class="sw" style="background:${col}"></span><div><div class="nm">${l}</div><div class="meta">${fmt(D[k].total)} · ${D[k].n} item${D[k].n === 1 ? '' : 's'}</div></div></div>`).join('')}</div>
          <div class="dsub">Clean up</div>
          ${clean('Unused images', imgUnused.length + ' of ' + D.images.n + ' not used by any container', sizeOrNone(D.images.rec), call('confirm', 'Remove ALL images that no container uses? They can be pulled again.', 'images.prune', true), 'images', 'unused')}
          ${clean('Stopped containers', stopped + ' stopped', sizeOrNone(D.containers.rec), call('confirm', 'Remove all stopped containers?', 'containers.prune'), 'containers', 'stopped')}
          ${clean('Unused volumes', volUnused + ' of ' + D.volumes.n + ' unused · deleting loses their data', sizeOrNone(D.volumes.rec), call('confirm', 'Remove ALL unused volumes? Their data will be lost.', 'volumes.prune'), 'volumes', 'unused')}
          ${clean('Build cache', (df.BuildCache || []).filter((c) => !c.InUse).length + ' of ' + D.cache.n + ' entries not in use', sizeOrNone(D.cache.rec), call('confirm', 'Clear the build cache? The next build will be slower.', 'builds.prune'), 'images', 'all')}
          ${clean('Unused networks', 'custom networks no container uses', '<span class="meta">–</span>', call('confirm', 'Remove unused networks?', 'networks.prune'), 'networks', 'unused')}
        </div>
      </div>
      <div class="dcol">
        <div class="dcard"><div class="dtitle">${ic('box', 16)}Busiest containers</div><div id="d-top">${topHtml()}</div></div>
        <div class="dcard"><div class="dtitle">${ic('info', 16)}Needs attention</div>${attentionHtml(cs)}</div>
        <div class="dcard"><div class="dtitle">${ic('activity', 16)}Recent activity<span class="sp"></span><a class="link" data-call='${esc(call('goto', 'activity'))}'>View all</a></div>${activityMini()}</div>
      </div>
    </div>
    <div class="dsub" style="margin-top:6px">Quick actions</div>
    <div class="tools">
      ${tbtn('download', 'Pull image', '["pull"]')}${tbtn('hammer', 'Build image', call('build'))}${tbtn('plus', 'New volume', call('newvol'))}${tbtn('plus', 'New network', call('newnet'))}
      ${tbtn('terminal', 'Open terminal', call('dock'))}${tbtn('flask', 'Browse labs', call('goto', 'labs'))}<span class="sp"></span>
      ${tbtn('broom', 'Clean everything', call('cleanall'), 'dan')}
      ${tbtn('power', 'Stop Docker', call('engine'), 'dan')}
    </div>`
}
