// Translates the rendered page, so the templates in app.js can stay plain English.
//
// app.js builds almost everything from HTML strings; wrapping every phrase in tr() would touch most of the file and every new feature would
// have to remember it. Instead this walks the DOM (and watches it) and swaps any text it has a translation for. The English text is the key
// (see i18n.js), a missing entry stays English, and what the user owns is left alone: container, image and volume names, logs, file
// contents, the terminal, and anything marked translate="no".
//
// Placeholder values are translated too when they match a key, so 'Up {t}' gives 'Activo 3 horas (saludable)'.
// Three kinds of key are understood:
//   'Stop'                  exact text of one piece of text (also tooltips, placeholders and aria-labels)
//   'Delete {name}?'        text with a changing part; {name} matches anything and is copied into the translation
//   '<b>docker</b> group'   a sentence with inline markup (b, code, kbd, em, span...), matched against the element's HTML
//                           (only for elements with nothing interactive inside, so no event handler can be lost)

const SKIP = '[translate=no],pre,code,textarea,script,style,svg,.mono,.xterm,.jl,.log,.buildlog,#dock-body,.cname,.jv'
const ATTRS = ['title', 'placeholder', 'aria-label', 'alt']
const INLINE_OK = new Set(['B', 'STRONG', 'I', 'EM', 'CODE', 'KBD', 'SPAN', 'SMALL', 'BR', 'MARK'])
const HAS_LETTER = /\p{L}/u

let getDict = () => null // () => { exact: Map, patterns: [{re, names, out}] } for the current language
let compiled = { code: null, exact: new Map(), patterns: [], values: new Set() }
let observer = null
const cache = new Map() // normalised English -> translation, or null for "none"
const textOrig = new WeakMap() // text node -> { src, out }
const rich = new WeakSet()

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function compile(code, dict) {
  const exact = new Map(), patterns = []
  for (const [k, v] of Object.entries(dict || {})) {
    if (!/\{\w+\}/.test(k)) { exact.set(k, v); continue }
    const names = []
    const src = k.split(/(\{\w+\})/).map((part) => { const m = /^\{(\w+)\}$/.exec(part); if (!m) return esc(part); names.push(m[1]); return '(.*?)' }).join('')
    patterns.push({ re: new RegExp(`^${src}$`, 's'), names, out: v })
  }
  // longest literal part first, so the most specific pattern wins
  patterns.sort((a, b) => b.re.source.length - a.re.source.length)
  return { code, exact, patterns, values: new Set(Object.values(dict || {})) }
}
const norm = (s) => s.replace(/\s+/g, ' ').trim()

function lookup(core) {
  if (cache.has(core)) return cache.get(core)
  let out = compiled.exact.get(core) ?? null
  if (out === null) {
    for (const p of compiled.patterns) {
      const m = p.re.exec(core)
      if (!m) continue
      out = p.out
      // what a {placeholder} caught may itself be translatable ('Up {t}' with t = '3 hours (healthy)')
      p.names.forEach((n, i) => { const v = m[i + 1]; out = out.replaceAll(`{${n}}`, HAS_LETTER.test(v) ? (lookup(norm(v)) ?? v) : v) })
      break
    }
  }
  // "3 of 11 unused · deleting loses their data": translate each part on its own
  if (out === null && core.includes(' · ')) {
    const parts = core.split(' · '), done = parts.map((x) => lookup(x))
    if (done.some((x) => x !== null)) out = parts.map((x, i) => done[i] ?? x).join(' · ')
  }
  if (cache.size > 5000) cache.clear()
  cache.set(core, out)
  return out
}

const skipped = (node) => (node.nodeType === 3 ? node.parentElement : node)?.closest(SKIP)
const inRich = (node) => { for (let e = node.parentElement; e; e = e.parentElement) if (rich.has(e)) return true; return false }

function translateText(node) {
  const known = textOrig.get(node)
  if (known && node.data === known.out) return // our own write
  const raw = node.data
  if (!HAS_LETTER.test(raw)) return
  if (skipped(node) || inRich(node)) return
  const core = norm(raw)
  const out = lookup(core)
  if (out === null || out === core) { textOrig.delete(node); return }
  const lead = /^\s*/.exec(raw)[0], trail = /\s*$/.exec(raw)[0]
  const next = lead + out + trail
  textOrig.set(node, { src: raw, out: next })
  node.nodeValue = next
}

// a vulnerability row's tooltip is the scanner's own description (data)
const attrSkipped = (el) => skipped(el) || (el.tagName === 'TR' && el.closest('.vtable') !== null)
function translateAttrs(el) {
  if (attrSkipped(el)) return
  for (const a of ATTRS) {
    const v = el.getAttribute(a)
    if (!v || !HAS_LETTER.test(v)) continue
    const store = (el.__tra ||= {})
    if (store[a] && store[a].out === v) continue // ours
    const out = lookup(norm(v))
    if (out === null) { delete store[a]; continue }
    store[a] = { src: v, out }
    el.setAttribute(a, out)
  }
}

// An element that mixes text with inline markup: translate it as one sentence.
const INTERACTIVE = 'a,button,input,select,textarea,[data-call],[data-open],[data-inspect],[data-cp],[data-p]'
function richCandidate(el) {
  if (!el.children.length || el.dataset.tr !== undefined || el.matches(INTERACTIVE)) return false
  if (![...el.childNodes].some((n) => n.nodeType === 3 && HAS_LETTER.test(n.data))) return false
  for (const d of el.querySelectorAll('*')) if (!INLINE_OK.has(d.tagName) || d.matches(INTERACTIVE)) return false
  return true
}
// A translation written with a few inline tags becomes DOM nodes without handing a string to the HTML parser: tags are matched against an
// allow-list (the same inline tags richCandidate accepts, attributes class and id only) and everything else is added as plain text.
// Elements are only ever created from these literal names; the tag text found in a translation is just a key, never the name itself.
const INLINE_TAGS = new Set(['b', 'strong', 'i', 'em', 'code', 'kbd', 'span', 'small', 'br', 'mark'])
function makeInline(tag) {
  switch (tag) {
    case 'b': return document.createElement('b')
    case 'strong': return document.createElement('strong')
    case 'i': return document.createElement('i')
    case 'em': return document.createElement('em')
    case 'code': return document.createElement('code')
    case 'kbd': return document.createElement('kbd')
    case 'small': return document.createElement('small')
    case 'br': return document.createElement('br')
    case 'mark': return document.createElement('mark')
    default: return document.createElement('span')
  }
}
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }
const decode = (t) => t.replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m])
function nodesFrom(markup) {
  const frag = document.createDocumentFragment(), open = [frag]
  for (const m of markup.matchAll(/<(\/?)([a-z]+)((?:\s+[a-z-]+="[^"<>]*")*)\s*(\/?)>|([^<]+)/g)) {
    if (m[5] !== undefined) { open.at(-1).append(document.createTextNode(decode(m[5]))); continue }
    const [all, close, tag, attrs, self] = m
    if (!INLINE_TAGS.has(tag)) { open.at(-1).append(document.createTextNode(all)); continue }
    if (close) { if (open.length > 1) open.pop(); continue }
    const el = makeInline(tag)
    for (const a of attrs.matchAll(/([a-z-]+)="([^"<>]*)"/g)) if (a[1] === 'class' || a[1] === 'id') el.setAttribute(a[1], decode(a[2]))
    open.at(-1).append(el)
    if (!self && tag !== 'br') open.push(el)
  }
  return frag
}
function translateRich(el) {
  if (!richCandidate(el) || skipped(el)) return false
  const src = norm(el.innerHTML) // only compared with the dictionary, never written back
  const out = lookup(src)
  if (out === null || out === src) return false
  el.__trOrig = [...el.childNodes] // the original nodes, put back on a language change
  el.dataset.tr = '1'
  rich.add(el)
  el.replaceChildren(nodesFrom(out))
  return true
}

function walk(root) {
  if (root.nodeType === 3) { translateText(root); return }
  if (root.nodeType !== 1 || skipped(root)) return
  // sentences with inline markup first; their children are then left alone
  const els = [root, ...root.querySelectorAll('*')]
  for (const el of els) {
    if (rich.has(el) || inRich(el) || el.closest(SKIP)) continue
    if (el.children.length && translateRich(el)) continue
  }
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = tw.nextNode(); n; n = tw.nextNode()) translateText(n)
  for (const el of els) if (el.nodeType === 1 && el.getAttributeNames().some((a) => ATTRS.includes(a))) translateAttrs(el)
}

function apply(fn) { fn(); observer?.takeRecords() } // our own edits must not be seen as changes

let runAll = () => {}, syncLang = () => false
export function initTranslate(dictFor, lang) {
  getDict = dictFor
  const sync = () => { const code = lang(); if (compiled.code !== code) { compiled = compile(code, getDict(code)); cache.clear() } return compiled.patterns.length + compiled.exact.size > 0 }
  syncLang = sync
  observer = new MutationObserver((records) => {
    if (!sync()) return
    apply(() => {
      for (const r of records) {
        if (r.type === 'characterData') translateText(r.target)
        else if (r.type === 'attributes') { if (ATTRS.includes(r.attributeName)) translateAttrs(r.target) }
        else for (const n of r.addedNodes) if (n.nodeType === 1 || n.nodeType === 3) walk(n)
      }
    })
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS })
  runAll = () => { if (sync()) apply(() => walk(document.body)) }
  runAll()
}

// Language changed: put the English back where we replaced it, then translate again with the new language.
export function retranslate() {
  if (!observer) return
  apply(() => {
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = tw.nextNode(); n; n = tw.nextNode()) { const k = textOrig.get(n); if (k && n.data === k.out) { n.nodeValue = k.src; textOrig.delete(n) } }
    for (const el of document.querySelectorAll('[data-tr]')) { if (el.__trOrig) el.replaceChildren(...el.__trOrig); delete el.__trOrig; delete el.dataset.tr; rich.delete(el) }
    for (const el of document.querySelectorAll('*')) if (el.__tra) { for (const [a, k] of Object.entries(el.__tra)) if (el.getAttribute(a) === k.out) el.setAttribute(a, k.src); delete el.__tra }
  })
  compiled = { code: null, exact: new Map(), patterns: [], values: new Set() }
  runAll()
}

// Visible text that has no translation in the current language (for the coverage test and for finding what is left to translate).
export function untranslated(root = document.body) {
  const text = new Set(), attr = new Set(), richOut = new Set()
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 || r.height > 0 }
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (!HAS_LETTER.test(n.data) || skipped(n) || textOrig.has(n) || inRich(n) || !n.parentElement || !visible(n.parentElement)) continue
    const core = norm(n.data)
    if (lookup(core) === null && !compiled.values.has(core) && /\p{L}{2}/u.test(core)) text.add(core)
  }
  for (const el of root.querySelectorAll('*')) {
    if (attrSkipped(el)) continue
    for (const a of ATTRS) { const v = el.getAttribute(a); if (v && /\p{L}{2}/u.test(v) && !(el.__tra && el.__tra[a]) && lookup(norm(v)) === null && !compiled.values.has(norm(v))) attr.add(norm(v)) }
    if (visible(el) && !rich.has(el) && !inRich(el) && richCandidate(el)) richOut.add(norm(el.innerHTML))
  }
  return { text: [...text], attr: [...attr], rich: [...richOut] }
}

// For text that never reaches the page (confirm(), prompt()): the translation of one English message, or the message itself.
export function translateString(text) {
  if (!syncLang()) return String(text)
  return lookup(norm(String(text))) ?? String(text)
}
