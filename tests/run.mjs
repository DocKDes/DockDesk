#!/usr/bin/env node
// Runs the test files one after another with Node's built-in runner.
//   node tests/run.mjs            everything
//   node tests/run.mjs security   only files starting with "security" (api, ui, registry, package work the same way)
// Each file gets a hard time limit (DD_TEST_FILE_TIMEOUT_MS, default 10 minutes). On timeout, Ctrl+C, or exit, the whole process
// group is killed, so a stuck browser or server can never leave the run hanging or leave processes behind.
import { spawn, spawnSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const want = process.argv.slice(2)
const order = ['static', 'package', 'i18n', 'a11y', 'scan', 'security', 'api', 'ui', 'registry']
const LIMIT = Number(process.env.DD_TEST_FILE_TIMEOUT_MS) || 10 * 60 * 1000
const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs') && (!want.length || want.some((w) => f.startsWith(w))))
  .sort((a, b) => order.findIndex((o) => a.startsWith(o)) - order.findIndex((o) => b.startsWith(o)))
if (!files.length) { console.error(`No test files match: ${want.join(', ')}`); process.exit(2) }

let current = null
const killGroup = (sig = 'SIGKILL') => { if (current?.pid) try { process.kill(-current.pid, sig) } catch {} }
// Ctrl+C / SIGTERM: ask the running file to stop (so it stops its own browser), force it after a grace period, then ALWAYS sweep and exit 130.
let interrupted = false
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  if (interrupted) return
  interrupted = true
  killGroup('SIGTERM')
  if (!current) { sweep(); process.exit(130) }
  setTimeout(() => { killGroup(); sweep(); process.exit(130) }, 3000)
})

// After a file had to be killed its own cleanup never ran, so remove what it may have left behind. Only objects whose names start with
// "ddtest-" (the prefix every test uses) are touched; `rm -v` also drops their anonymous volumes.
function sweep() {
  // test browsers run in their own process group, so killing the file's group does not reach them: stop them by their profile folder name
  spawnSync('pkill', ['-9', '-f', `--user-data-dir=${tmpdir()}/ddtest-chrome-`])
  try { for (const d of readdirSync(tmpdir())) if (d.startsWith('ddtest-chrome-')) rmSync(join(tmpdir(), d), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch {}
  const docker = (...a) => spawnSync('docker', a, { encoding: 'utf8' })
  if (docker('info').status !== 0) return
  const ids = (...a) => (docker(...a).stdout || '').split('\n').map((x) => x.trim()).filter(Boolean)
  for (const id of ids('ps', '-aq', '--filter', 'name=ddtest-')) docker('rm', '-fv', id)
  for (const id of ids('network', 'ls', '-q', '--filter', 'name=ddtest-')) docker('network', 'rm', id)
  for (const t of ids('images', '--format', '{{.Repository}}:{{.Tag}}')) if (t.startsWith('ddtest-')) docker('rmi', '-f', t)
}

const runOne = (f) => new Promise((resolve) => {
  const child = spawn(process.execPath, ['--test', '--test-reporter=spec', join(dir, f)], { stdio: 'inherit', detached: true })
  current = child
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    console.error(`\n✖ ${f} did not finish within ${Math.round(LIMIT / 1000)} s: stopping it and cleaning up.`)
    killGroup('SIGTERM'); setTimeout(() => killGroup(), 3000) // graceful first, so the test process can stop its own browser
  }, LIMIT)
  child.on('exit', (code) => { clearTimeout(timer); killGroup(); if (timedOut || interrupted) sweep(); current = null; resolve(timedOut ? 'timeout' : code === 0 ? 'ok' : 'fail') })
})

const failed = []
const t0 = Date.now()
for (const f of files) {
  console.log(`\n━━ ${f} ━━`)
  const r = await runOne(f)
  if (interrupted) { console.error('\nInterrupted: cleaned up the test containers and browsers.'); process.exit(130) }
  if (r !== 'ok') failed.push(`${f}${r === 'timeout' ? ' (timed out)' : ''}`)
}
console.log(failed.length ? `\n✖ failed: ${failed.join(', ')}` : `\n✔ all ${files.length} test file(s) passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
process.exit(failed.length ? 1 : 0)
