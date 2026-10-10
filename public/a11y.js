// Keyboard and screen-reader support, layered over the plain-HTML templates in app.js.
//
// The page is built from innerHTML strings, and many things you can click are plain <div>, <a> without href or <tr>, which the keyboard and
// assistive technology cannot see. Rather than touch every template, this watches the DOM and, for what appears, adds the missing
// tabindex, roles, names and key handling. It only adds attributes; it never changes what a click does.

const NATIVE = 'a[href],button,input,select,textarea,summary,[contenteditable=true]'
// Things that react to a click through the delegated handlers in app.js but are not buttons.
const CLICKABLE = '#nav a[data-p],.engine,.tabs a,.drow,.palrow,.cgo,[data-call]:not(button),[data-open]:not(tr),[data-cp]:not(tr),[data-inspect]:not(tr)'
const ROWS = 'tr.row-click'
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

// Names for controls that have none in their template (the visible text sits next to them, not inside a <label>).
const SELECT_NAMES = { cpf: 'Filter projects', ifilter: 'Filter images', gfilter: 'Filter by usage', atype: 'Filter by type', ltail: 'Lines to load', rpre: 'Run preset', bfile: 'Dockerfile' }
const text = (e) => (e?.textContent || '').replace(/\s+/g, ' ').trim()
let uid = 0
const idOf = (e) => e.id || (e.id = `a11y-${++uid}`)
// The lists are redrawn on every refresh, so the button that opened a dialog may be gone by the time it closes. Remember how to find its twin.
const LOCATORS = ['data-call', 'data-open', 'data-inspect', 'data-cp', 'data-p', 'id']
function locate(e) {
  if (!e) return null
  for (const a of LOCATORS) if (e.getAttribute?.(a)) return [a, e.getAttribute(a)]
  return null
}
const relocate = (loc) => loc && [...document.querySelectorAll(`[${loc[0]}]`)].find((x) => x.getAttribute(loc[0]) === loc[1])

function nameCheckbox(c) {
  if (c.closest('label') || c.getAttribute('aria-label') || c.getAttribute('aria-labelledby')) return
  const row = c.closest('tr')
  if (c.closest('thead')) return c.setAttribute('aria-label', 'Select all')
  const n = text(row?.querySelector('.nm')) || text(row?.querySelector('td:nth-child(2)'))
  c.setAttribute('aria-label', n ? `Select ${n}` : 'Select row')
}
function nameSelect(s) {
  if (s.closest('label') || s.getAttribute('aria-label') || s.getAttribute('aria-labelledby')) return
  // Settings: the control sits beside a row title
  const label = s.title || SELECT_NAMES[s.id] || text(s.closest('.srow,.set,.row')?.querySelector('b,.t,.nm')) || text(s.closest('div')?.previousElementSibling)
  s.setAttribute('aria-label', label || 'Choose')
}

function enhance(root) {
  if (root.nodeType !== 1) return
  const all = (sel) => (root.matches(sel) ? [root] : []).concat([...root.querySelectorAll(sel)])
  for (const e of all(CLICKABLE)) {
    if (e.matches(NATIVE) || e.tagName === 'TR') continue
    if (!e.hasAttribute('tabindex')) e.tabIndex = 0
    if (!e.hasAttribute('role')) e.setAttribute('role', e.matches('#nav a[data-p]') ? 'link' : e.closest('.tabs') ? 'tab' : e.matches('.palrow') ? 'option' : 'button')
    if (e.matches('#nav a[data-p]') && e.classList.contains('on')) e.setAttribute('aria-current', 'page')
    if (!e.getAttribute('aria-label') && !text(e) && e.title) e.setAttribute('aria-label', e.title)
  }
  for (const r of all(ROWS)) if (!r.hasAttribute('tabindex')) r.tabIndex = 0
  for (const t of all('.tabs')) {
    t.setAttribute('role', 'tablist')
    for (const a of t.querySelectorAll('a')) a.setAttribute('aria-selected', String(a.classList.contains('on')))
  }
  for (const c of all('input[type=checkbox]')) nameCheckbox(c)
  for (const s of all('select')) nameSelect(s)
  for (const th of all('th:not([scope])')) th.setAttribute('scope', 'col')
  for (const i of all('input[type=text],input[type=search],input:not([type]),textarea')) if (!i.closest('label') && !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby') && (i.placeholder || i.title)) i.setAttribute('aria-label', i.title || i.placeholder)
  for (const m of all('#menu')) m.setAttribute('role', 'menu')
  for (const b of all('#menu button')) b.setAttribute('role', 'menuitem')
  if (root.parentElement?.id === 'menu' && root.matches('button')) root.setAttribute('role', 'menuitem')
  // Command palette: a combobox (the text box) controlling a listbox (the results)
  for (const p of all('.pal')) {
    p.querySelector('.palbox')?.setAttribute('role', 'dialog')
    p.querySelector('.palbox')?.setAttribute('aria-modal', 'true')
    p.querySelector('.palbox')?.setAttribute('aria-label', 'Search everything')
    const q = p.querySelector('#palq'), res = p.querySelector('#palres')
    if (q && res) { q.setAttribute('role', 'combobox'); q.setAttribute('aria-expanded', 'true'); q.setAttribute('aria-controls', 'palres'); q.setAttribute('aria-autocomplete', 'list'); res.setAttribute('role', 'listbox') }
  }
  for (const r of all('.palrow')) { idOf(r); r.setAttribute('role', 'option'); r.setAttribute('aria-selected', String(r.classList.contains('on'))) }
}

// ---- dialogs: label them, move focus in, keep Tab inside the modal ones, and give focus back to what opened them ----
const stack = [] // { el, opener }
// Dialog code often focuses its own first field before we see the dialog, so remember where focus was one step earlier.
let focusNow = null, focusBefore = null
document.addEventListener('focusin', (e) => { if (e.target !== focusNow) { focusBefore = focusNow; focusNow = e.target } })
// What was just activated is the best opener (some browsers don't focus a button when it is clicked, and an unfocused window sends no focus events).
let lastClick = null
document.addEventListener('click', (e) => { const el = e.target instanceof Element ? e.target.closest('button,a,[role=button],[role=tab],tr[tabindex],[tabindex]') : null; lastClick = el && { el, loc: null, t: Date.now() }; if (lastClick) lastClick.loc = locate(el) }, true)
const recentClick = () => (lastClick && Date.now() - lastClick.t < 1500 ? lastClick : null)
function dialogOpened(el) {
  const modal = el.matches('.modal,.pal')
  const box = el.matches('.modal') ? el.querySelector('.box') || el : el.matches('.pal') ? el.querySelector('.palbox') || el : el
  if (!box.hasAttribute('role') || box.getAttribute('role') === 'dialog') {
    box.setAttribute('role', 'dialog')
    if (modal) box.setAttribute('aria-modal', 'true')
    const title = box.querySelector('h3,header b,h2')
    if (title && !box.getAttribute('aria-label')) box.setAttribute('aria-labelledby', idOf(title))
  }
  const rc = recentClick(), from = rc ? rc.el : el.contains(focusNow) ? focusBefore : focusNow
  const opener = from instanceof HTMLElement && from !== document.body && !el.contains(from) ? from : null
  stack.push({ el, opener, loc: opener && (rc?.loc || locate(opener)), modal })
  const first = (el.matches('.pal') ? el.querySelector('#palq') : null) || (el.matches('.modal') ? el.querySelector('input:not([type=hidden]):not([type=checkbox]),textarea,select') : null) || el.querySelector(FOCUSABLE) || box
  if (!first.matches(FOCUSABLE)) box.tabIndex = -1
  requestAnimationFrame(() => first.focus({ preventScroll: true }))
}
function dialogClosed(el) {
  const i = stack.findIndex((d) => d.el === el)
  if (i < 0) return
  const [d] = stack.splice(i, 1)
  // only restore when focus was lost with the dialog (not when the user moved on, e.g. to a dialog opened from this one)
  if (document.activeElement === document.body || !document.activeElement?.isConnected) (d.opener?.isConnected ? d.opener : relocate(d.loc))?.focus({ preventScroll: true })
}

document.addEventListener('keydown', (e) => {
  const t = e.target
  // Enter / Space on something that is only clickable by script
  if ((e.key === 'Enter' || e.key === ' ') && t instanceof HTMLElement && !t.matches(NATIVE) && (t.matches(CLICKABLE) || t.matches(ROWS)) && !e.ctrlKey && !e.metaKey) {
    e.preventDefault(); t.click(); return
  }
  // Tab stays inside the topmost modal dialog
  const top = stack[stack.length - 1]
  if (e.key === 'Tab' && top?.modal && top.el.isConnected) {
    const f = [...top.el.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement)
    if (!f.length) return e.preventDefault()
    const a = document.activeElement
    if (e.shiftKey && (a === f[0] || !top.el.contains(a))) { e.preventDefault(); f[f.length - 1].focus() }
    else if (!e.shiftKey && (a === f[f.length - 1] || !top.el.contains(a))) { e.preventDefault(); f[0].focus() }
  }
  // Arrow keys: between tabs, and through an open menu
  if (t instanceof HTMLElement && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && t.closest('.tabs') && t.matches('[role=tab]')) {
    const tabs = [...t.closest('.tabs').querySelectorAll('[role=tab]')], n = tabs[(tabs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
    e.preventDefault(); n.focus(); n.click()
  }
  const menu = t instanceof HTMLElement && t.closest('#menu')
  if (menu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
    const items = [...menu.querySelectorAll('button:not([disabled])')], i = items.indexOf(t)
    e.preventDefault()
    items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }
})

let menuOpener = null, menuLoc = null
export function initA11y() {
  const menu = document.querySelector('#menu')
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') {
        const t = r.target
        if (t === menu && r.attributeName === 'hidden') {
          if (!menu.hidden) { menu.setAttribute('role', 'menu'); menu.querySelectorAll('button').forEach((b) => b.setAttribute('role', 'menuitem')); const rc = recentClick(); menuOpener = rc ? rc.el : menu.contains(focusNow) ? focusBefore : focusNow; menuLoc = rc?.loc || locate(menuOpener); requestAnimationFrame(() => menu.querySelector('button')?.focus({ preventScroll: true })) }
          else if (menu.contains(document.activeElement) || document.activeElement === document.body) { (menuOpener?.isConnected ? menuOpener : relocate(menuLoc))?.focus({ preventScroll: true }); menuOpener = null }
        } else if (t.matches?.('.tabs a')) t.setAttribute('aria-selected', String(t.classList.contains('on')))
        else if (t.matches?.('#nav a[data-p]')) t.classList.contains('on') ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current')
        else if (t.matches?.('.palrow')) {
          t.setAttribute('aria-selected', String(t.classList.contains('on')))
          if (t.classList.contains('on')) document.querySelector('#palq')?.setAttribute('aria-activedescendant', idOf(t))
        }
        continue
      }
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue
        enhance(n)
        if (n.matches('.modal,.pal,.detail')) dialogOpened(n)
      }
      for (const n of r.removedNodes) if (n.nodeType === 1 && n.matches('.modal,.pal,.detail')) dialogClosed(n)
    }
  })
  obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] })
  enhance(document.body)
  // The skip link would change the URL hash; just move focus instead
  document.querySelector('.skip')?.addEventListener('click', (e) => { e.preventDefault(); const p = document.querySelector('#page'); p?.focus(); p?.scrollIntoView?.() })
}
