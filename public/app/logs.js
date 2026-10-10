// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { stops } from './container-detail.js'
import { $, TOKEN, esc, ic, stream } from './core.js'

// ---------- Log viewer: search, filter, colours, download ----------
const ANSI_COLOR = { 30: 'a30', 31: 'a31', 32: 'a32', 33: 'a33', 34: 'a34', 35: 'a35', 36: 'a36', 37: 'a37', 90: 'a90', 91: 'a91', 92: 'a92', 93: 'a93', 94: 'a94', 95: 'a95', 96: 'a96', 97: 'a97' }
// Split a line with ANSI colour codes into [{t: text, c: css classes}] (other escape sequences are dropped).
function ansiSegs(raw) {
  const segs = [], re = /\x1b\[([0-9;?]*)([A-Za-z])/g
  let last = 0, fg = '', bold = false, m
  const push = (t) => { if (t) segs.push({ t, c: [fg, bold ? 'ab' : ''].filter(Boolean).join(' ') }) }
  while ((m = re.exec(raw))) {
    push(raw.slice(last, m.index)); last = re.lastIndex
    if (m[2] !== 'm') continue
    for (const code of (m[1] || '0').split(';').map(Number)) {
      if (code === 0) { fg = ''; bold = false }
      else if (code === 1) bold = true
      else if (code === 22) bold = false
      else if (code === 39) fg = ''
      else if (ANSI_COLOR[code]) fg = ANSI_COLOR[code]
    }
  }
  push(raw.slice(last))
  return segs.length ? segs : [{ t: '', c: '' }]
}
export const plainOf = (raw) => raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
// HTML for one line, with <mark> around search matches (matches can span colour changes).
export function logLineHtml(raw, q) {
  const segs = ansiSegs(raw)
  const wrap = (txt, c, mk) => (txt ? (() => { let h = esc(txt); if (mk) h = `<mark>${h}</mark>`; return c ? `<span class="${c}">${h}</span>` : h })() : '')
  if (!q) return segs.map((x) => wrap(x.t, x.c, false)).join('')
  const low = segs.map((x) => x.t).join('').toLowerCase(), ql = q.toLowerCase(), marks = []
  for (let i = low.indexOf(ql); i >= 0; i = low.indexOf(ql, i + ql.length)) marks.push([i, i + ql.length])
  if (!marks.length) return segs.map((x) => wrap(x.t, x.c, false)).join('')
  let out = '', pos = 0, mi = 0
  for (const sg of segs) {
    const start = pos, end = pos + sg.t.length
    let cur = start
    while (cur < end) {
      while (mi < marks.length && marks[mi][1] <= cur) mi++
      if (mi < marks.length && marks[mi][0] <= cur) { const e = Math.min(end, marks[mi][1]); out += wrap(sg.t.slice(cur - start, e - start), sg.c, true); cur = e }
      else { const e = mi < marks.length ? Math.min(end, marks[mi][0]) : end; out += wrap(sg.t.slice(cur - start, e - start), sg.c, false); cur = e }
    }
    pos = end
  }
  return out
}
export const lineLevel = (p) => (/\b(error|err|fatal|panic|exception|critical)\b/i.test(p) ? 'lvl-err' : /\b(warn|warning)\b/i.test(p) ? 'lvl-warn' : '')

export function logsTab(pane, info) {
  const id = info.Id
  const o = { tail: '300', ts: false, follow: true, wrap: false, only: false, q: '' }
  const MAX = 20000
  let lines = [], partial = '', rendered = 0, marksEl = [], cur = -1, raf = 0, stopStream = null, state = 'connecting'
  pane.classList.add('flush')
  pane.innerHTML = `<div class="lv"><div class="lbar2">
      <label class="search">${ic('search', 14)}<input type="text" id="lq" placeholder="Search logs" autocomplete="off" spellcheck="false"></label>
      <button class="ib" id="lprev" title="Previous match (Shift+Enter)">${ic('chevup')}</button><button class="ib" id="lnext" title="Next match (Enter)">${ic('chevdown')}</button><span class="meta" id="lcount"></span>
      <label class="chk"><input type="checkbox" id="lonly"> Only matching</label><span class="sp"></span>
      <select id="ltail" title="How many past lines to load">${[['100', 'Last 100'], ['300', 'Last 300'], ['1000', 'Last 1,000'], ['5000', 'Last 5,000'], ['all', 'All']].map(([v, l]) => `<option value="${v}" ${v === o.tail ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="chk"><input type="checkbox" id="lts"> Timestamps</label><label class="chk"><input type="checkbox" id="lwrap"> Wrap</label><label class="chk"><input type="checkbox" id="lfollow" checked> Follow</label>
      <button class="tb" id="lclear" title="Clear what is shown (does not delete the container's logs)">${ic('x', 14)}<span>Clear</span></button>
      <a class="tb" id="ldl" title="Download all logs as a .log file">${ic('download', 14)}<span>Download</span></a></div>
    <div class="lscroll" id="lscroll"><div id="llines"></div></div><div class="lstat meta" id="lstat"></div></div>`
  const scroll = $('#lscroll', pane), box = $('#llines', pane), q = $('#lq', pane)
  const visible = (raw) => !o.only || !o.q || plainOf(raw).toLowerCase().includes(o.q.toLowerCase())
  const mk = (raw) => { const d = document.createElement('div'); d.className = 'll ' + lineLevel(plainOf(raw)); d.innerHTML = logLineHtml(raw, o.q) || ' '; return d }
  const status = () => { $('#lstat', pane).textContent = `${lines.length.toLocaleString()} line${lines.length === 1 ? '' : 's'} · ${state}${lines.length >= MAX ? ' · oldest lines dropped' : ''}` }
  const refreshMarks = () => {
    marksEl = [...box.querySelectorAll('mark')]
    $('#lcount', pane).textContent = o.q ? (marksEl.length ? `${cur >= 0 ? cur + 1 : 0} / ${marksEl.length}` : 'No matches') : ''
  }
  const flushDom = () => {
    raf = 0
    if (rendered < lines.length) {
      const frag = document.createDocumentFragment()
      for (; rendered < lines.length; rendered++) if (visible(lines[rendered])) frag.append(mk(lines[rendered]))
      box.append(frag)
    }
    status(); refreshMarks()
    if (o.follow) scroll.scrollTop = scroll.scrollHeight
  }
  const renderAll = () => {
    box.textContent = ''; rendered = 0; cur = -1
    flushDom()
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(flushDom) }
  const ingest = (text) => {
    partial += text.replace(/\r/g, '')
    const parts = partial.split('\n'); partial = parts.pop()
    if (!parts.length) return
    lines.push(...parts)
    if (lines.length > MAX) { lines = lines.slice(-MAX + 2000); renderAll(); return }
    schedule()
  }
  const startStream = () => {
    stopStream?.(); lines = []; partial = ''; state = 'streaming'; renderAll()
    stopStream = stream('logs', { id, tail: o.tail, ts: o.ts ? '1' : '0' }, (m) => {
      if (m.k === 'data') ingest(m.d)
      else { if (partial) { lines.push(partial); partial = '' } state = m.k === 'end' ? 'stream ended (the container stopped or was removed)' : 'error: ' + m.d; schedule() }
    })
    stops.push(() => stopStream?.())
    setDl()
  }
  const setDl = () => { $('#ldl', pane).href = `/download/logs?id=${encodeURIComponent(id)}&tail=all&timestamps=${o.ts ? 1 : 0}&t=${encodeURIComponent(TOKEN)}` }
  const goMark = (i) => {
    if (!marksEl.length) return
    cur = (i + marksEl.length) % marksEl.length
    marksEl.forEach((m) => m.classList.remove('cur')); marksEl[cur].classList.add('cur')
    o.follow = false; $('#lfollow', pane).checked = false
    marksEl[cur].scrollIntoView({ block: 'center' })
    $('#lcount', pane).textContent = `${cur + 1} / ${marksEl.length}`
  }
  let tmr
  q.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => { o.q = q.value; renderAll(); if (o.q && marksEl.length) goMark(0) }, 180) })
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); goMark(cur + (e.shiftKey ? -1 : 1)) } })
  $('#lnext', pane).onclick = () => goMark(cur + 1)
  $('#lprev', pane).onclick = () => goMark(cur - 1)
  $('#lonly', pane).onchange = (e) => { o.only = e.target.checked; renderAll() }
  $('#lwrap', pane).onchange = (e) => scroll.classList.toggle('wrap', (o.wrap = e.target.checked))
  $('#lfollow', pane).onchange = (e) => { o.follow = e.target.checked; if (o.follow) scroll.scrollTop = scroll.scrollHeight }
  $('#lts', pane).onchange = (e) => { o.ts = e.target.checked; startStream() }
  $('#ltail', pane).onchange = (e) => { o.tail = e.target.value; startStream() }
  $('#lclear', pane).onclick = () => { lines = []; partial = ''; renderAll() }
  // scrolling up pauses follow; reaching the bottom again resumes it
  scroll.addEventListener('scroll', () => {
    const atBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 24
    if (atBottom !== o.follow && !raf) { o.follow = atBottom; $('#lfollow', pane).checked = atBottom }
  })
  startStream()
}
