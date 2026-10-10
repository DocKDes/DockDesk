// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { $, TOKEN, api, call, esc, ic, settings, tbtn, tr } from './core.js'
import { refreshStats } from './state.js'

// ---------- Live events: Docker tells us when something changes ----------
export const activity = [] // newest first, in memory only
export let eventsLive = false, evRefresh
let lastEventAt = Math.floor(Date.now() / 1000) - 10 // replay a few seconds on first connect, and from the last event seen after a reconnect
export function startEvents() {
  const es = new EventSource(`/stream/events?since=${Math.max(0, lastEventAt - 1)}&t=${encodeURIComponent(TOKEN)}`)
  let closed = false
  const lost = () => { if (closed) return; closed = true; eventsLive = false; es.close(); setTimeout(startEvents, 3000) } // docker restarted or network blip: reconnect
  es.onopen = () => (eventsLive = true)
  es.onmessage = (m) => { const ev = JSON.parse(m.data); ev.k === 'data' ? onDockerEvent(ev.d) : lost() }
  es.onerror = lost
}
function onDockerEvent(e) {
  lastEventAt = Math.max(lastEventAt, e.t || 0)
  if (!mergeActivity([e])) return // a replayed event we already have: no refresh, no second notification
  clearTimeout(evRefresh)
  evRefresh = setTimeout(() => {
    if (!document.hidden && !$('.detail')) window.refresh?.()
    if (/^(start|die|stop|pause|unpause|oom)$/.test(e.action)) refreshStats()
  }, 400)
  const crashed = e.type === 'container' && (e.action === 'oom' || (e.action === 'die' && !['0', '137', '143'].includes(String(e.exit)))) // 137/143 = normal docker stop
  if (crashed && settings.notify && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(e.action === 'oom' ? 'Container ran out of memory' : 'Container crashed', { body: `${e.name}${e.action === 'die' ? ` exited with code ${e.exit}` : ''}` })
  }
}
const ACT_ICON = { container: 'box', image: 'image', volume: 'database', network: 'network' }
const actFilter = { q: '', type: 'all', problems: false }
let actCtx = { cids: new Set(), imgIds: new Set(), imgByName: new Map() }
const actKey = (e) => `${e.t}|${e.type}|${e.action}|${e.id}`
// Merge events (live or from the daemon's history) newest-first without duplicates.
function mergeActivity(list) {
  const seen = new Set(activity.map(actKey))
  let added = 0
  for (const e of list) if (!seen.has(actKey(e))) { activity.push(e); seen.add(actKey(e)); added++ }
  activity.sort((a, b) => b.t - a.t)
  if (activity.length > 400) activity.length = 400
  return added
}
export async function loadHistory() { try { mergeActivity(await api('events.history', Math.floor(Date.now() / 1000) - 6 * 3600)) } catch {} }
const isProblem = (e) => e.action === 'oom' || (e.action === 'die' && !['0', '137', '143'].includes(String(e.exit))) || (e.action === 'health_status' && /unhealthy/.test(e.detail || ''))

function activityRows() {
  const q = actFilter.q.trim().toLowerCase()
  const list = activity.filter((e) => (actFilter.type === 'all' || e.type === actFilter.type) && (!actFilter.problems || isProblem(e)) &&
    (!q || `${e.name} ${e.action} ${e.type} ${e.image || ''} ${e.detail || ''}`.toLowerCase().includes(q))).slice(0, 300)
  if (!list.length) return `<tr><td colspan="4"><div class="empty">${activity.length ? 'No events match these filters' : 'No events yet'}</div></td></tr>`
  const good = /^(start|create|pull|tag|unpause|restart)$/, bad = /^(die|oom|kill|destroy|delete|untag|stop|pause)$/
  const today = new Date().toDateString(), yest = new Date(Date.now() - 864e5).toDateString()
  let day = '', out = ''
  for (const e of list) {
    const d = new Date(e.t * 1000), ds = d.toDateString()
    if (ds !== day) { day = ds; out += `<tr class="daysep"><td colspan="4">${ds === today ? 'Today' : ds === yest ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</td></tr>` }
    // Link to the thing if it still exists: containers and images are checked; volumes/networks only once destroyed.
    let attr = ''
    if (e.type === 'container' && actCtx.cids.has(e.id)) attr = `data-open="${esc(e.id)}"`
    else if (e.type === 'image') { const iid = actCtx.imgIds.has(e.id) ? e.id : actCtx.imgByName.get(e.id) || actCtx.imgByName.get(e.name); if (iid) attr = `data-inspect="image:${esc(iid)}:${esc(e.name)}"` }
    else if ((e.type === 'volume' || e.type === 'network') && !/^(destroy|remove)$/.test(e.action)) attr = `data-inspect="${e.type}:${esc(e.id)}:${esc(e.name)}"`
    const prob = isProblem(e)
    out += `<tr class="${attr ? 'row-click' : ''} ${prob ? 'prob' : ''}" ${attr}><td class="nw mono" title="${esc(d.toLocaleString())}">${d.toLocaleTimeString()}</td><td class="nw">${ic(ACT_ICON[e.type] || 'info', 15)} ${esc(e.type)}</td>
      <td><span class="pill ${prob ? 'bad' : good.test(e.action) ? 'running' : bad.test(e.action) ? 'warn' : ''}">${esc(e.action)}</span></td>
      <td>${esc(e.name)}${e.action === 'die' && e.exit !== undefined ? ` <span class="meta">exit code ${esc(e.exit)}</span>` : ''}${e.detail ? ` <span class="meta">${esc(e.detail)}</span>` : ''}</td></tr>`
  }
  return out
}

export async function activityPage() {
  const [cs, imgs] = await Promise.all([api('containers.list').catch(() => []), api('images.list').catch(() => [])])
  const imgByName = new Map()
  imgs.forEach((i) => (i.RepoTags || []).forEach((t) => imgByName.set(t, i.Id)))
  actCtx = { cids: new Set(cs.map((c) => c.Id)), imgIds: new Set(imgs.map((i) => i.Id)), imgByName }
  const problems = activity.filter(isProblem).length
  return `<div class="head"><h2>${ic('activity', 22)}${tr('Activity')}<span class="count">${activity.length}</span></h2>
    <div class="usage"><div><div class="k">Problems</div><div class="v"><b style="color:${problems ? 'var(--bad)' : 'var(--ok)'}">${problems}</b></div><div class="s">crashes and failed health checks</div></div></div></div>
    <div class="tools">
      <label class="search">${ic('search', 15)}<input type="text" id="aq" placeholder="Search events…" value="${esc(actFilter.q)}"></label>
      <select id="atype">${[['all', 'All types'], ['container', 'Containers'], ['image', 'Images'], ['volume', 'Volumes'], ['network', 'Networks']].map(([v, l]) => `<option value="${v}" ${actFilter.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="switch"><input type="checkbox" id="aprob" ${actFilter.problems ? 'checked' : ''}>Problems only</label>
      <span class="sp"></span><span class="meta">${eventsLive ? '● live' : 'reconnecting…'} · last 6 hours</span>${tbtn('x', 'Clear', call('actclear'))}
    </div>
    <table><thead><tr><th>Time</th><th>Type</th><th>Event</th><th>Name</th></tr></thead><tbody id="arows">${activityRows()}</tbody></table>`
}
document.addEventListener('input', (e) => { if (e.target.id === 'aq') { actFilter.q = e.target.value; $('#arows').innerHTML = activityRows() } })
document.addEventListener('change', (e) => {
  if (e.target.id === 'atype') { actFilter.type = e.target.value; $('#arows').innerHTML = activityRows() }
  else if (e.target.id === 'aprob') { actFilter.problems = e.target.checked; $('#arows').innerHTML = activityRows() }
})
