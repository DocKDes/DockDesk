// Static checks that need no Docker and no browser, so they run everywhere (and fast): every source file parses, shell and Python helpers
// are valid, the files the page imports exist, and the CI workflows follow basic hygiene.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT } from './helpers.mjs'

const read = (f) => readFileSync(join(ROOT, f), 'utf8')
const list = (d, re) => readdirSync(join(ROOT, d)).filter((f) => re.test(f)).map((f) => `${d}/${f}`)
const hasCmd = (c) => spawnSync('which', [c]).status === 0

describe('static checks', () => {
  it('server.js and the helper scripts parse', () => {
    for (const f of ['server.js', ...list('tests', /\.mjs$/)]) {
      const r = spawnSync(process.execPath, ['--check', join(ROOT, f)], { encoding: 'utf8' })
      assert.equal(r.status, 0, `${f}: ${r.stderr}`)
    }
  })
  it('every browser module parses (they are ES modules; the package itself is not)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ddtest-static-'))
    try {
      for (const f of [...list('public', /\.js$/), ...list('public/app', /\.js$/)]) {
        const tmp = join(dir, 'm.mjs'); writeFileSync(tmp, read(f))
        const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' })
        assert.equal(r.status, 0, `${f}: ${r.stderr}`)
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('everything app.js imports is a file in public/', () => {
    for (const f of [...list('public', /\.js$/), ...list('public/app', /\.js$/)]) for (const m of read(f).matchAll(/(?:from|import) '(\.{1,2}\/[^']+)'/g)) assert.ok(existsSync(join(ROOT, f, '..', m[1])), `${f} imports missing ${m[1]}`)
    const html = read('public/index.html')
    for (const m of html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css|png))"/g)) assert.ok(existsSync(join(ROOT, 'public', m[1])), `index.html references missing ${m[1]}`)
  })
  it('shell scripts are valid POSIX sh', () => {
    for (const f of ['install.sh', 'uninstall.sh', 'bin/dockdesk', ...list('packaging', /\.sh$/)]) {
      const r = spawnSync('sh', ['-n', join(ROOT, f)], { encoding: 'utf8' })
      assert.equal(r.status, 0, `${f}: ${r.stderr}`)
    }
  })
  it('Python helpers compile', { skip: hasCmd('python3') ? false : 'python3 not installed' }, () => {
    for (const f of ['pty-shell.py', 'tray.py']) {
      const r = spawnSync('python3', ['-I', '-c', `import sys;compile(open(sys.argv[1]).read(), sys.argv[1], 'exec')`, join(ROOT, f)], { encoding: 'utf8' })
      assert.equal(r.status, 0, `${f}: ${r.stderr}`)
    }
  })
  it('the changelog has a section for the version in package.json, or an Unreleased one', () => {
    const v = JSON.parse(read('package.json')).version
    assert.match(read('CHANGELOG.md'), new RegExp(`^## (Unreleased|${v.replaceAll('.', '\\.')}\\b)`, 'm'))
  })
  it('CI workflows: least-privilege permissions and no floating action versions', () => {
    for (const f of list('.github/workflows', /\.ya?ml$/)) {
      const y = read(f)
      assert.match(y, /^permissions:/m, `${f} should declare permissions at the top`)
      for (const m of y.matchAll(/uses:\s*([^\s#]+)/g)) assert.doesNotMatch(m[1], /@(main|master|latest)$/, `${f}: ${m[1]} is not pinned to a version`)
    }
  })
})
