// Accessibility checks that need no browser: colour contrast of the theme colours, and the CSS rules that keep keyboard users oriented.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './helpers.mjs'

const css = readFileSync(join(ROOT, 'public/style.css'), 'utf8')
const vars = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]))
const dark = vars(/:root\{([^}]*)\}/.exec(css)[1])
const light = { ...dark, ...vars(/:root\[data-theme=light\]\{([^}]*)\}/.exec(css)[1]) }
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)

describe('accessibility: colours and CSS', () => {
  for (const [name, t] of [['dark', dark], ['light', light]]) {
    it(`${name} theme: text colours reach 4.5:1 on the page and panel backgrounds`, () => {
      for (const c of ['fg', 'mut', 'acc', 'ok', 'bad', 'warn']) for (const bg of ['bg', 'panel'])
        assert.ok(ratio(t[c], t[bg]) >= 4.5, `${c} on ${bg} is ${ratio(t[c], t[bg]).toFixed(2)}:1`)
    })
    it(`${name} theme: muted text on raised surfaces and white text on filled buttons are readable`, () => {
      assert.ok(ratio(t.mut, t.raise) >= 4.5, `mut on raise is ${ratio(t.mut, t.raise).toFixed(2)}:1`)
      assert.ok(ratio('#ffffff', t['acc-solid']) >= 4.5, `white on acc-solid is ${ratio('#ffffff', t['acc-solid']).toFixed(2)}:1`)
    })
  }
  it('severity chips with white text are readable', () => {
    for (const m of css.matchAll(/\.sev-(critical|high)\{color:#fff;background:(#[0-9a-f]{6})/g)) assert.ok(ratio('#ffffff', m[2]) >= 4.5, `sev-${m[1]} is ${ratio('#ffffff', m[2]).toFixed(2)}:1`)
  })
  it('has a visible focus ring, honours reduced motion, and has a skip link style', () => {
    assert.match(css, /:focus-visible\{outline:2px solid/)
    assert.match(css, /prefers-reduced-motion:\s*reduce/)
    assert.match(css, /\.skip:focus/)
  })
  it('the page declares its landmarks and a live region for messages', () => {
    const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8')
    assert.match(html, /<html lang=/)
    assert.match(html, /role="navigation" aria-label="Main"/)
    assert.match(html, /<main/)
    assert.match(html, /id="toast" role="status" aria-live="polite"/)
    assert.match(html, /class="skip" href="#page"/)
  })
})
