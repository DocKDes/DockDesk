// A tiny Chrome DevTools Protocol client, so UI tests need no npm packages. Needs Node 22+ (global WebSocket) and Chromium/Chrome.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sleep, waitFor } from './helpers.mjs'

// DD_TEST_BROWSER=/path/to/chrome picks a browser explicitly. Otherwise: prefer Google Chrome (GitHub's runners ship a real one), and only
// accept a candidate that can actually run `--version`. That rejects Ubuntu's `chromium-browser`, which is often just a stub for the snap.
let cachedBrowser
export function findBrowser() {
  if (process.env.DD_TEST_BROWSER) return process.env.DD_TEST_BROWSER
  if (cachedBrowser !== undefined) return cachedBrowser
  for (const b of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'brave-browser']) {
    const w = spawnSync('which', [b], { encoding: 'utf8' })
    if (w.status !== 0) continue
    const path = w.stdout.trim()
    const v = spawnSync(path, ['--version'], { encoding: 'utf8', timeout: 8000 })
    if (v.status === 0 && /chrom|brave/i.test(v.stdout)) return (cachedBrowser = path)
  }
  return (cachedBrowser = null)
}
export const uiSkipReason = () =>
  process.env.DD_TEST_UI === '0' ? 'DD_TEST_UI=0'
  : typeof WebSocket === 'undefined' ? 'needs Node 22+ (global WebSocket)'
  : !findBrowser() ? 'no Chromium/Chrome found (set DD_TEST_BROWSER=/path/to/chrome)'
  : null

// Snap-packaged Chromium (the default `chromium-browser` on Ubuntu) runs in a sandbox with its own private /tmp, so a profile folder
// created here is invisible to it and it never reports its debugging port. Say so, instead of just timing out.
function snapHint(bin) {
  try {
    const real = realpathSync(bin)
    const head = readFileSync(real, { encoding: 'utf8', flag: 'r' }).slice(0, 400)
    if (real.startsWith('/snap/') || /\/snap\/|snap run|snapctl/.test(head)) return 'This looks like a snap-packaged browser, whose sandbox cannot use the temporary profile folder. Install Google Chrome or the distribution\'s non-snap Chromium, or point DD_TEST_BROWSER at one.'
  } catch {}
  return ''
}

export async function openPage(url, { width = 1360, height = 860, scheme = 'light' } = {}) {
  const bin = findBrowser()
  const dir = mkdtempSync(join(tmpdir(), 'ddtest-chrome-'))
  let proc = null, stderr = ''
  const killBrowser = () => { try { proc?.kill('SIGKILL') } catch {} }
  process.once('exit', killBrowser) // never leave a browser behind, whatever happens
  const abandon = () => { killBrowser(); rmSync(dir, { recursive: true, force: true }) }
  try {
    // Newer Chrome wants --headless=new; older builds only know plain --headless. Try both, each with its own short wait.
    let port = null
    for (const headless of ['--headless=new', '--headless']) {
      stderr = ''
      proc = spawn(bin, [headless, '--no-sandbox', '--disable-gpu', '--no-first-run', `--user-data-dir=${dir}`, '--remote-debugging-port=0', `--window-size=${width},${height}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
      proc.unref(); proc.stderr.on('data', (c) => (stderr = (stderr + c).slice(-1500))); proc.stderr.unref?.()
      try { port = await waitFor(() => { const t = readFileSync(join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]; return t && Number(t) }, { timeout: 10000, what: 'the browser to report its debugging port' }); break }
      catch { killBrowser(); rmSync(join(dir, 'DevToolsActivePort'), { force: true }); await sleep(300) }
    }
    if (!port) throw new Error(`The browser (${bin}) did not start. ${snapHint(bin)}${stderr.trim() ? `\n--- browser output (last lines):\n${stderr.trim()}` : ''}`)

    const tabs = await waitFor(async () => { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); return t.find((x) => x.type === 'page') && t }, { what: 'a page target' })
    const ws = new WebSocket(tabs.find((x) => x.type === 'page').webSocketDebuggerUrl)
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('could not open the DevTools connection')) })
    let id = 0; const pending = new Map(), exceptions = [], dialogs = []
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data)
      if (d.id) pending.get(d.id)?.(d)
      else if (d.method === 'Runtime.exceptionThrown') exceptions.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)
      else if (d.method === 'Page.javascriptDialogOpening') { dialogs.push(d.params.message); send('Page.handleJavaScriptDialog', { accept: true }) }
    }
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
    await send('Runtime.enable'); await send('Page.enable')
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
    const page = {
      exceptions, dialogs,
      async eval(expr) {
        const r = (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result
        if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
        return r.result?.value
      },
      text: (sel) => page.eval(`document.querySelector(${JSON.stringify(sel)})?.textContent.replace(/\\s+/g,' ').trim() ?? null`),
      count: (sel) => page.eval(`document.querySelectorAll(${JSON.stringify(sel)}).length`),
      click: (sel) => page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw new Error('no element: '+${JSON.stringify(sel)});e.click();return true})()`),
      // click the first element matching sel whose text contains `text`
      clickText: (sel, text) => page.eval(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.includes(${JSON.stringify(text)}));if(!e)throw new Error('no ${sel} containing '+${JSON.stringify(text)});e.click();return true})()`),
      set: (sel, v, evs = ['input', 'change']) => page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw new Error('no element: '+${JSON.stringify(sel)});e.value=${JSON.stringify(v)};${evs.map((x) => `e.dispatchEvent(new Event('${x}',{bubbles:true}))`).join(';')};return true})()`),
      key: (sel, key, mods = {}) => page.eval(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,${Object.entries(mods).map(([a, b]) => a + ':' + b).join(',')}}))`),
      waitFor: (expr, opts) => waitFor(() => page.eval(expr), { what: expr.slice(0, 70), ...opts }),
      async goto(u) { await send('Page.navigate', { url: u }) },
      async screenshot(file) { writeFileSync(file, Buffer.from((await send('Page.captureScreenshot')).result.data, 'base64')) },
      async close() { try { ws.close() } catch {} abandon(); await sleep(100) }
    }
    await page.goto(url)
    return page
  } catch (e) { abandon(); throw e } // a failed start must not leave a browser running: it would keep the whole test process alive
}

// Can a browser be started here at all? Returns null when yes, or a human-readable reason when not.
export async function probeBrowser() {
  try { const p = await openPage('about:blank'); await p.close(); return null } catch (e) { return `the browser could not be started: ${e.message}` }
}
