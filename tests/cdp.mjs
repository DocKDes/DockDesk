// A tiny Chrome DevTools Protocol client, so UI tests need no npm packages. Needs Node 22+ (global WebSocket) and Chromium/Chrome.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sleep, waitFor } from './helpers.mjs'

export function findBrowser() {
  for (const b of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'brave-browser']) if (spawnSync('which', [b], { stdio: 'ignore' }).status === 0) return b
  return null
}
export const uiSkipReason = () => (typeof WebSocket === 'undefined' ? 'needs Node 22+ (global WebSocket)' : !findBrowser() ? 'no Chromium/Chrome found' : null)

export async function openPage(url, { width = 1360, height = 860, scheme = 'light' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ddtest-chrome-'))
  const proc = spawn(findBrowser(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', `--user-data-dir=${dir}`, '--remote-debugging-port=0', `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' })
  const port = await waitFor(() => { const t = readFileSync(join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]; return t && Number(t) }, { timeout: 15000, what: 'browser to start' })
  const tabs = await waitFor(async () => { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); return t.find((x) => x.type === 'page') && t }, { what: 'a page target' })
  const ws = new WebSocket(tabs.find((x) => x.type === 'page').webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
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
    async close() { try { ws.close() } catch {} proc.kill('SIGKILL'); await sleep(100); rmSync(dir, { recursive: true, force: true }) }
  }
  await page.goto(url)
  return page
}
