#!/usr/bin/env node
// Runs the test files one after another with Node's built-in runner.
//   node tests/run.mjs            everything
//   node tests/run.mjs security   only files starting with "security" (api, ui, registry work the same way)
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const want = process.argv.slice(2)
const order = ['package', 'security', 'api', 'ui', 'registry']
const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs') && (!want.length || want.some((w) => f.startsWith(w))))
  .sort((a, b) => order.findIndex((o) => a.startsWith(o)) - order.findIndex((o) => b.startsWith(o)))
if (!files.length) { console.error(`No test files match: ${want.join(', ')}`); process.exit(2) }
const failed = []
const t0 = Date.now()
for (const f of files) {
  console.log(`\n━━ ${f} ━━`)
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', join(dir, f)], { stdio: 'inherit' })
  if (r.status !== 0) failed.push(f)
}
console.log(failed.length ? `\n✖ failed: ${failed.join(', ')}` : `\n✔ all ${files.length} test file(s) passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
process.exit(failed.length ? 1 : 0)
