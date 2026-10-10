// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { $, copyText, esc, ic, toast } from './core.js'

// ---------- JSON viewer (Inspect): section chips, line numbers, syntax colours, search ----------
const CHIPS = {
  container: [['Platform', 'Platform'], ['Cmd', 'Config/Cmd'], ['State', 'State'], ['Image', 'Config/Image'], ['Env', 'Config/Env'], ['Labels', 'Config/Labels'], ['Mounts', 'Mounts'], ['Volumes', 'Config/Volumes'],
    ['PortBindings', 'HostConfig/PortBindings'], ['Runtime', 'HostConfig/Runtime'], ['Networks', 'NetworkSettings/Networks'], ['HostConfig', 'HostConfig'], ['Config', 'Config'], ['GraphDriver', 'GraphDriver']],
  image: [['Architecture', 'Architecture'], ['Os', 'Os'], ['Cmd', 'Config/Cmd'], ['Entrypoint', 'Config/Entrypoint'], ['Env', 'Config/Env'], ['ExposedPorts', 'Config/ExposedPorts'], ['Labels', 'Config/Labels'], ['RootFS', 'RootFS'], ['Metadata', 'Metadata'], ['Config', 'Config']],
  volume: [['Labels', 'Labels'], ['Options', 'Options'], ['Mountpoint', 'Mountpoint'], ['UsageData', 'UsageData']],
  network: [['IPAM', 'IPAM'], ['Containers', 'Containers'], ['Options', 'Options'], ['Labels', 'Labels']]
}

// Pretty-print into one HTML string per line, remembering which line each key path starts on.
function jsonModel(obj) {
  const lines = [], paths = new Map()
  const scalar = (v) => (typeof v === 'string' ? `<span class="js">${esc(JSON.stringify(v))}</span>` : typeof v === 'number' ? `<span class="jnum">${v}</span>` : `<span class="jb">${v}</span>`)
  const walk = (v, depth, path, key, comma) => {
    const pad = '  '.repeat(depth), k = key === null ? '' : `<span class="jk">${esc(JSON.stringify(String(key)))}</span>: `
    if (path) paths.set(path, lines.length)
    if (v !== null && typeof v === 'object') {
      const arr = Array.isArray(v), keys = arr ? v.map((_, i) => i) : Object.keys(v)
      if (!keys.length) { lines.push(pad + k + (arr ? '[]' : '{}') + comma); return }
      lines.push(pad + k + (arr ? '[' : '{'))
      keys.forEach((kk, i) => walk(v[kk], depth + 1, path ? `${path}/${kk}` : String(kk), arr ? null : kk, i < keys.length - 1 ? ',' : ''))
      lines.push(pad + (arr ? ']' : '}') + comma)
    } else lines.push(pad + k + scalar(v) + comma)
  }
  walk(obj, 0, '', null, '')
  return { lines, paths }
}

export function jsonViewer(pane, obj, kind) {
  const { lines, paths } = jsonModel(obj)
  // plain text of each line for searching (never inserted as HTML): remove tags until none are left, so "<<b>script>" cannot survive, then unescape
  const stripTags = (l) => { let prev; do { prev = l; l = l.replace(/<[^<>]*>/g, '') } while (l !== prev); return l }
  const plain = lines.map((l) => stripTags(l).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
  const spec = CHIPS[kind] || Object.entries(obj).filter(([, v]) => v && typeof v === 'object').slice(0, 12).map(([k]) => [k, k])
  const chips = spec.filter(([, p]) => paths.has(p)).map(([label, p]) => ({ label, line: paths.get(p) })).sort((a, b) => a.line - b.line)
  pane.classList.add('flush')
  pane.innerHTML = `<div class="jv">
    <div class="jchips">${chips.map((c) => `<button class="jchip" data-line="${c.line}">${esc(c.label)}</button>`).join('')}</div>
    <div class="jbar"><label class="search">${ic('search', 14)}<input type="text" id="jq" placeholder="Search in JSON" autocomplete="off" spellcheck="false"></label>
      <button class="ib" id="jprev" title="Previous match">${ic('chevup')}</button><button class="ib" id="jnext" title="Next match (Enter)">${ic('chevdown')}</button><span class="meta" id="jcount"></span>
      <span class="sp"></span><label class="chk"><input type="checkbox" id="jwrap"> Wrap</label><button class="tb" id="jcopy">${ic('copy', 14)}<span>Copy</span></button></div>
    <div class="jcode" id="jcode"><div class="jlines">${lines.map((l, i) => `<div class="jl"><span class="jno">${i + 1}</span><span class="jt">${l}</span></div>`).join('')}</div></div></div>`
  const code = $('#jcode', pane), rows = code.querySelectorAll('.jl'), chipEls = pane.querySelectorAll('.jchip'), q = $('#jq', pane)
  const flash = (i) => { rows[i].classList.add('flash'); setTimeout(() => rows[i].classList.remove('flash'), 1400) }
  const scrollTo = (i, center) => code.scrollTo({ top: Math.max(0, rows[i].offsetTop - (center ? code.clientHeight / 2 : 0)), behavior: 'smooth' })
  const setActive = (idx) => chipEls.forEach((el, i) => el.classList.toggle('on', i === idx))
  let quiet = 0 // after a chip click, ignore scroll-spy briefly so the clicked chip stays highlighted
  chipEls.forEach((el, i) => (el.onclick = () => { const l = +el.dataset.line; quiet = Date.now() + 800; setActive(i); scrollTo(l); flash(l) }))
  let raf
  code.addEventListener('scroll', () => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      if (Date.now() < quiet) return
      let active = -1
      chips.forEach((c, i) => { if (rows[c.line].offsetTop <= code.scrollTop + 4) active = i })
      setActive(active)
    })
  })
  // search
  let hits = [], cur = -1, tmr
  const show = () => {
    rows.forEach((r) => r.classList.remove('cur'))
    if (cur < 0) return
    rows[hits[cur]].classList.add('cur'); scrollTo(hits[cur], true)
    $('#jcount', pane).textContent = `${cur + 1} / ${hits.length}`
  }
  const search = () => {
    const t = q.value.toLowerCase()
    rows.forEach((r) => r.classList.remove('hit', 'cur'))
    hits = t ? plain.map((x, i) => (x.toLowerCase().includes(t) ? i : -1)).filter((i) => i >= 0) : []
    hits.forEach((i) => rows[i].classList.add('hit'))
    cur = hits.length ? 0 : -1
    $('#jcount', pane).textContent = t && !hits.length ? 'No matches' : ''
    show()
  }
  const step = (d) => { if (hits.length) { cur = (cur + d + hits.length) % hits.length; show() } }
  q.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(search, 150) })
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1) } })
  $('#jnext', pane).onclick = () => step(1)
  $('#jprev', pane).onclick = () => step(-1)
  $('#jwrap', pane).onchange = (e) => code.classList.toggle('wrap', e.target.checked)
  $('#jcopy', pane).onclick = async () => (await copyText(JSON.stringify(obj, null, 2))) ? toast('Copied JSON') : toast('Could not copy', true)
}
