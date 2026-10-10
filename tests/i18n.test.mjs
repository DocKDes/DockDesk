// Translations: every language covers every string the app asks for, and keeps the {placeholders}. No Docker or browser needed.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
// public/i18n.js is an ES module loaded by the browser; the package is not marked "type": "module", so older Node versions refuse to import it by path. A data: URL works everywhere.
const { TR, LANGS } = await import('data:text/javascript;base64,' + readFileSync(join(root, 'i18n.js')).toString('base64'))
// the page code is app.js plus one file per area in app/
const app = [join(root, 'app.js'), ...readdirSync(join(root, 'app')).filter((f) => f.endsWith('.js')).map((f) => join(root, 'app', f))].map((f) => readFileSync(f, 'utf8')).join('\n')

// every English string handed to tr('…') or listed in a ternary inside tr(…)
const used = new Set()
for (const m of app.matchAll(/\btr\('((?:[^'\\]|\\.)*)'/g)) used.add(m[1].replace(/\\'/g, "'"))
for (const m of app.matchAll(/\btr\((?!')([^)]*\?[^)]*)\)/g)) for (const q of m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) used.add(q[1])
// strings that reach tr() through a variable (page names, shortcut sheet rows)
for (const k of ['Overview', 'Compose', 'Containers', 'Images', 'Volumes', 'Networks', 'Labs', 'Activity', 'Settings', 'Anywhere', 'Go to a page (press g, then…)', 'In search', 'In the log viewer',
  'Open search and commands', 'Show this cheat sheet', 'Close the open dialog, drawer or menu', 'Show or hide the terminal', 'Refresh the current page', 'Move through the results', 'Run the selected result', 'Next match', 'Previous match']) used.add(k)
// the ternary scan also picks up code words like 'script'/'deb'; those are not UI text
for (const k of ['script', 'deb', '']) used.delete(k)

describe('translations', () => {
  it('lists English plus at least four other languages', () => {
    assert.ok(Object.keys(LANGS).length >= 5)
    assert.deepEqual(Object.keys(LANGS).sort(), Object.keys(TR).sort())
  })
  it('the app really uses translatable strings', () => assert.ok(used.size > 80, `only ${used.size} strings found`))
  const keys = Object.keys(TR.es)
  it('has hundreds of strings, beyond the few that go through tr()', () => assert.ok(keys.length > 600, `only ${keys.length} strings`))
  for (const lang of Object.keys(TR).filter((l) => l !== 'en')) {
    it(`${LANGS[lang]} translates every string that tr() asks for`, () => {
      assert.deepEqual([...used].filter((k) => !(k in TR[lang])), [], `missing in ${lang}`)
    })
    it(`${LANGS[lang]} has exactly the same strings as the other languages`, () => {
      assert.deepEqual(Object.keys(TR[lang]).sort(), [...keys].sort())
    })
    it(`${LANGS[lang]} keeps the placeholders and tags and has no empty text`, () => {
      const ph = (x) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
      const tags = (x) => [...x.matchAll(/<\/?\w+[^>]*>/g)].map((m) => m[0]).sort().join('')
      for (const [k, v] of Object.entries(TR[lang])) {
        assert.ok(v.trim(), `empty translation for "${k}"`)
        assert.equal(ph(v), ph(k), `placeholders differ for "${k}"`)
        assert.equal(tags(v), tags(k), `tags differ for "${k}"`)
      }
    })
    it(`${LANGS[lang]} really translates (most strings differ from English)`, () => {
      const same = keys.filter((k) => TR[lang][k] === k).length
      assert.ok(same < keys.length * 0.25, `${same} of ${keys.length} strings are still English in ${lang}`)
    })
  }
})
