// DockDesk page: plain JavaScript modules, no framework and no build step.
// This file starts everything; the code lives in ./app/ (one file per area of the UI):
//   core.js          helpers every file uses: $, esc, fmt, api() and stream() calls to the server, toast, icons and buttons, settings, tr()
//   state.js         engine and per-container resource numbers, alerts      shell.js     theme, sidebar, status bar, page routing
//   dispatch.js      the one click handler behind every data-call button    events.js    live Docker events and the Activity page
//   palette.js       Ctrl+K search and the shortcuts sheet                  settings.js  Settings page, update check, settings backup
//   dashboard.js     Overview     containers.js  Containers list     compose.js  Compose projects, editor, graph, logs
//   images.js        Images list, update check, compare     run-dialog.js  the Run dialog     dialogs.js  build, pull, push, export, import, sign-in
//   lists.js         Volumes and Networks     image-detail.js / container-detail.js  the details drawers
//   files.js logs.js json-viewer.js stats-view.js   the container drawer's tabs     terminal.js  the docked terminals
// Files import each other in circles (a list opens a drawer, a drawer refreshes the list); that is fine because everything is used
// when something happens, not while the files load. To add a screen, put it in the matching file and register it in shell.js (PAGES).
// Also loaded below: ./a11y.js (keyboard and screen-reader support) and ./translate.js (translates the rendered page, see ./i18n.js).
import './app/compose.js'
import './app/containers.js'
import './app/dashboard.js'
import './app/dialogs.js'
import './app/dispatch.js'
import './app/files.js'
import './app/image-detail.js'
import './app/images.js'
import './app/json-viewer.js'
import './app/labs.js'
import './app/lists.js'
import './app/logs.js'
import './app/palette.js'
import './app/run-dialog.js'
import './app/stats-view.js'
import { initA11y } from './a11y.js'
import { TR } from './i18n.js'
import { initTranslate } from './translate.js'
import { openDetail } from './app/container-detail.js'
import { START, langCode, settings } from './app/core.js'
import { loadHistory, startEvents } from './app/events.js'
import { checkForUpdate } from './app/settings.js'
import { PAGES, checkDaemon, go, hideMenu, nav, renderStatus } from './app/shell.js'
import { refreshInfo, refreshStats } from './app/state.js'
import { openTerm } from './app/terminal.js'


document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu() })

const [startPage, startId] = START.split('/')
nav(); renderStatus()
go(PAGES[startPage] ? startPage : 'dashboard')
document.documentElement.lang = langCode()
checkDaemon(); refreshInfo(); refreshStats(); startEvents(); loadHistory()
setTimeout(() => { // the daily update check is opt-in
  let last = 0; try { last = Number(localStorage.getItem('lastUpdateCheck')) || 0 } catch {}
  if (settings.autoUpdate && Date.now() - last > 24 * 3600 * 1000) checkForUpdate({ silent: true })
}, 8000)
if (startId) openDetail(startId, 'Overview') // deep link: #containers/<id or name>
if (startPage === 'shell') openTerm('shell') // deep link: #shell
initA11y()
initTranslate((code) => TR[code], langCode)
