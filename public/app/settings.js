// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { LANGS, TR } from '../i18n.js'
import { retranslate } from '../translate.js'
import { api, call, confirm, esc, ibtn, ic, langCode, saveSettings, settings, tbtn, toast, tr } from './core.js'
import { loadPresets, savePresets } from './run-dialog.js'
import { applyTheme, current, go, nav, renderStatus } from './shell.js'
import { applyStats, breach, refreshStats, setStats, setUpdateAvail, updateAvail } from './state.js'

// ---------- Settings ----------
// ---------- Updates, backup of settings ----------
const UPDATE_HOW = { npm: 'npm install -g dockdesk@latest', deb: null, script: null, source: 'git pull' }
export async function checkForUpdate({ silent = false } = {}) {
  try {
    const r = await api('update.check')
    try { localStorage.setItem('lastUpdateCheck', String(Date.now())) } catch {}
    setUpdateAvail(r.newer ? r : null)
    renderStatus()
    if (current === 'settings') window.refresh?.()
    if (r.newer) toast(tr('DockDesk {v} is available', { v: r.latest }))
    else if (!silent) toast(tr('You have the latest version ({v})', { v: r.current }))
    return r
  } catch (e) { if (!silent) toast(e.message, true) }
}
// Download and verify (deb and install.sh installs): the server fetches the release file, checks its SHA-256 against the release's SHA256SUMS
// and its build attestation, and saves it. Nothing is installed; the command to do that is shown.
let updateDl = null // { busy } | { error } | the server's result
export async function downloadUpdate() {
  updateDl = { busy: true }; window.refresh?.()
  try { updateDl = await api('update.download') } catch (e) { updateDl = { error: e.message } }
  if (current === 'settings') window.refresh?.()
}
function updateRow(app) {
  const how = (r) => r.install === 'deb' ? `sudo apt install ./dockdesk_${r.latest}_all.deb` : UPDATE_HOW[r.install]
  const can = updateAvail && (updateAvail.install === 'deb' || updateAvail.install === 'script')
  const dl = !can || !updateDl ? '' : updateDl.busy ? `<div class="meta">${esc(tr('Downloading and checking…'))}</div>`
    : updateDl.error ? `<div class="err">${esc(updateDl.error)}</div>`
    : `<div class="meta">✓ ${esc(tr('Checksum matches the SHA256SUMS published with the release'))}</div>
       <div class="meta">${updateDl.attestation?.state === 'verified' ? '✓ ' + esc(tr('Build attestation verified (built by this project’s release workflow)')) : esc(tr('Build attestation not checked: {reason}', { reason: updateDl.attestation?.reason || '' }))}</div>
       <div class="meta">${esc(tr('Saved to {file}', { file: updateDl.file }))}</div>
       <div class="meta">${esc(tr('Then install it with'))}: <span class="mono">${esc(updateDl.install)}</span> ${ibtn('copy', tr('Copy command'), call('copy', updateDl.install))}</div>
       <div class="meta">${esc(tr('Nothing was installed. Installing is your decision.'))}</div>`
  const info = updateAvail
    ? `<div class="pending">${esc(tr('DockDesk {v} is available', { v: updateAvail.latest }))}.</div>${can ? `<div class="row">${tbtn('download', tr('Download and verify'), call('downloadupdate'))}</div>` : ''}${dl}${!updateDl && how(updateAvail) ? `<div class="meta">${esc(tr('Update with'))}: <span class="mono">${esc(how(updateAvail))}</span> ${ibtn('copy', tr('Copy command'), call('copy', how(updateAvail)))}</div>` : ''}${!updateDl ? `<div class="meta">${esc(tr(updateAvail.install === 'script' ? 'Download the new .tar.gz from the releases page, unpack it and run ./install.sh' : updateAvail.install === 'deb' ? 'Download the new .deb from the releases page first.' : ''))}</div>` : ''}`
    : ''
  return { app, info }
}
const SETTING_KEYS = { refresh: 'number', stats: 'boolean', notify: 'boolean', alertCpu: 'number', alertMem: 'number', lang: 'string', autoUpdate: 'boolean' }
export async function exportSettings() {
  let theme = 'auto'; try { theme = localStorage.getItem('theme') || 'auto' } catch {}
  let tray = false; try { tray = (await api('tray.status')).enabled } catch {}
  const doc = { app: 'dockdesk', format: 1, exported: new Date().toISOString(), settings: { ...settings }, theme, runPresets: loadPresets(), tray }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }))
  a.download = 'dockdesk-settings.json'
  document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  toast(tr('Settings exported'))
}
async function importSettings(file) {
  try {
    if (file.size > 1e6) throw new Error(tr('That file is too large to be a DockDesk settings file.'))
    let doc; try { doc = JSON.parse(await file.text()) } catch { throw new Error(tr('That is not a DockDesk settings file.')) }
    if (!doc || doc.app !== 'dockdesk' || doc.format !== 1 || typeof doc.settings !== 'object') throw new Error(tr('That is not a DockDesk settings file.'))
    const next = {}
    for (const [k, type] of Object.entries(SETTING_KEYS)) if (typeof doc.settings[k] === type) next[k] = doc.settings[k]
    if (next.lang && next.lang !== 'auto' && !TR[next.lang]) delete next.lang
    for (const k of ['refresh', 'alertCpu', 'alertMem']) if (k in next && !(Number.isFinite(next[k]) && next[k] >= 0 && next[k] <= 10000)) delete next[k]
    if ('refresh' in next && next.refresh < 1) delete next.refresh
    const presets = {}
    if (doc.runPresets && typeof doc.runPresets === 'object') for (const [n, v] of Object.entries(doc.runPresets).slice(0, 100)) if (v && typeof v.image === 'string' && Array.isArray(v.ports) && Array.isArray(v.volumes) && Array.isArray(v.env)) presets[String(n).slice(0, 60)] = v
    Object.assign(settings, next); saveSettings()
    if (Object.keys(presets).length) savePresets({ ...loadPresets(), ...presets })
    if (['auto', 'light', 'dark'].includes(doc.theme)) applyTheme(doc.theme)
    if (typeof doc.tray === 'boolean') { try { await api('tray.set', doc.tray) } catch (e) { if (doc.tray) toast(e.message, true) } }
    toast(tr('Settings imported: {n} settings, {p} presets', { n: Object.keys(next).length, p: Object.keys(presets).length }))
    nav(); renderStatus(); go(current)
  } catch (e) { toast(e.message, true) }
}
document.addEventListener('change', (e) => { if (e.target.id === 'importfile') { const f = e.target.files[0]; e.target.value = ''; if (f) importSettings(f) } })

export async function settingsPage() {
  const [d, info, grp, reg, app, tray] = await Promise.all([api('engine.diag'), api('info'), api('group.list'), api('registry.status'), api('app.info'), api('tray.status')])
  let themeSel = 'auto'; try { themeSel = localStorage.getItem('theme') || 'auto' } catch {}
  const row = (title, desc, control) => `<div class="srow"><div><div class="nm">${title}</div><div class="meta">${desc}</div></div><div class="sctl">${control}</div></div>`
  const sel = (key, opts, cur) => `<select data-setting="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`
  const sw = (key, on, extra = '') => `<label class="switch"><input type="checkbox" data-setting="${key}" ${on ? 'checked' : ''} ${extra}></label>`
  const val = (v) => `<span class="mono">${esc(v)}</span>`
  const u = updateRow(app)
  return `<div class="head"><h2>${ic('sliders', 22)}${tr('Settings')}</h2></div>
    <div class="section">${tr('General')}</div><div class="panel">
      ${row(tr('Theme'), tr('Follow the system, or force light or dark.'), sel('theme', [['auto', tr('System')], ['light', tr('Light')], ['dark', tr('Dark')]], themeSel))}
      ${row(tr('Language'), tr('Language of the app. Names (containers, images, volumes), logs, files and messages from Docker itself are shown as they are.'), sel('lang', [['auto', tr('Automatic')], ...Object.entries(LANGS)], settings.lang))}
      ${row(tr('Refresh interval'), tr('How often the lists update while a page is open.'), sel('refresh', [2, 3, 5, 10, 30].map((n) => [n, tr('{n} seconds', { n })]), settings.refresh))}
      ${row(tr('Crash notifications'), tr('Show a desktop notification when a container exits with an error or runs out of memory.'), sw('notify', settings.notify))}
      ${row(tr('CPU alert'), tr('Notify when a container stays above this CPU usage for about 15 seconds (100% is one full core). Needs live CPU and memory.'), sel('alertCpu', [[0, tr('Off')], [80, '80%'], [100, '100%'], [150, '150%'], [200, '200%'], [400, '400%']], settings.alertCpu))}
      ${row(tr('Memory alert'), tr('Notify when a container stays above this share of its memory limit for about 15 seconds. Only containers with a limit are checked.'), sel('alertMem', [[0, tr('Off')], [70, '70%'], [80, '80%'], [90, '90%'], [95, '95%']], settings.alertMem))}
      ${row(tr('Live CPU and memory'), tr('Samples running containers every 5 seconds. Turn it off to use fewer resources.'), sw('stats', settings.stats))}
      ${row(tr('Keyboard shortcuts'), tr('Press ? anywhere to see them.'), tbtn('terminal', tr('Show'), call('shortcuts')))}
      ${row(tr('System tray icon'), tray.available ? tr('Keeps DockDesk in the tray when you close the window, with a quick menu to open it and to start or stop Docker.') : `${esc(tr('Not available here: it needs a desktop session, python3-gi and an AppIndicator library.'))}${tray.hint ? ` <span class="mono">${esc(tray.hint)}</span> ${ibtn('copy', tr('Copy command'), call('copy', tray.hint))}` : ''}<br>${esc(tr('On GNOME you also need the AppIndicator extension.'))}`, sw('tray', tray.enabled, tray.available ? '' : 'disabled'))}
    </div>
    <div class="section">${tr('Updates')}</div><div class="panel">
      ${row(`DockDesk <span class="mono">v${esc(u.app.version)}</span>`, `${esc(tr('Installed with'))}: ${esc({ npm: 'npm', deb: '.deb', script: 'install.sh', source: tr('source folder') }[u.app.install] || u.app.install)}. ${esc(tr('Checking asks registry.npmjs.org for the newest version and sends nothing else.'))}${u.info}`, `${tbtn('restart', tr('Check for updates'), call('checkupdate'))}${updateAvail ? tbtn('ext', tr('Releases page'), call('openrelease')) : ''}`)}
      ${row(tr('Check automatically once a day'), tr('Off by default. When on, DockDesk asks the update server about once a day while it runs.'), sw('autoUpdate', settings.autoUpdate))}
    </div>
    <div class="section">${tr('Backup')}</div><div class="panel">
      ${row(tr('Export or import settings'), tr('Saves your settings, theme, language and saved Run presets to a file, or restores them from one (for example on another computer). Registry passwords are never included.'), `${tbtn('download', tr('Export settings'), call('exportsettings'))}${tbtn('upload', tr('Import settings…'), call('importsettings'))}<input type="file" id="importfile" accept=".json,application/json" hidden>`)}
    </div>
    <div class="section">${tr('Engine')}</div><div class="panel">
      ${row('Docker Engine', esc(info.OperatingSystem), val('v' + info.ServerVersion))}
      ${row('Storage driver', 'Docker root: ' + esc(info.DockerRootDir), val(info.Driver))}
      ${row('Socket', 'The Unix socket DockDesk talks to.', val(d.socket))}
      ${row('Docker Compose', d.compose ? 'Needed for the Compose page and editor.' : d.composeHint ? `Not found. The Compose page and editor need it. On ${esc(d.composeHint.distro)}, install it with <span class="mono">${esc(d.composeHint.cmd)}</span>${esc(d.composeHint.note)}. ${ibtn('copy', 'Copy command', call('copy', d.composeHint.cmd))}` : 'Not found. The Compose page and editor need it: install “docker-compose-v2” (Ubuntu), “docker-compose” (Debian 13, Kali) or “docker-compose-plugin” (Docker’s repository).', d.compose ? val('v' + d.compose) : '<span class="pill warn">Not installed</span>')}
      ${row('Docker Buildx', 'Optional. Used by image builds when present.', d.buildx ? val(d.buildx.split(' ').find((x) => /^v?\d/.test(x)) || 'installed') : '<span class="pill">Not installed</span>')}
      ${row('Access', 'Your user is ' + esc(d.user) + '.', d.access ? '<span class="pill running">OK</span>' : '<span class="pill warn">No permission</span>')}
      ${row('Start / stop without a password', 'Starting or stopping the engine asks for your password by default. Install this one-time rule to let docker-group members skip it (scoped to docker.service). Undo: sudo rm /etc/polkit-1/rules.d/50-dockdesk.rules', tbtn('copy', 'Copy setup command', call('copyrule')))}
      ${row('Docker group', 'Members can use Docker without sudo.', d.inDockerGroup ? '<span class="pill running">Member</span>' : '<span class="pill warn">Not a member</span>')}
    </div>
    <div class="section">${tr('Registries')}</div><div class="panel">
      ${reg.registries.length ? reg.registries.map((r) => row(esc(r), 'Signed in', tbtn('x', 'Sign out', call('reglogout', r)))).join('') : row('Not signed in to any registry', 'Sign in to push images to Docker Hub, GHCR or a private registry.', '')}
      ${row('Sign in', reg.store ? `Credentials are kept by Docker's credential helper (${esc(reg.store)}).` : 'Docker stores credentials in ~/.docker/config.json (readable only by you, but not encrypted). Install a Docker credential helper for stronger protection.', tbtn('plus', 'Sign in…', call('reglogin')))}
    </div>
    <div class="section">${tr('Docker access')}</div>
    <div class="note">${ic('info', 16)}<div><b>Docker group members have root-equivalent access to this machine.</b> They can start containers that mount the whole filesystem. Only add people you would give a root shell. Each change asks for an administrator password, and it takes effect the next time that user logs in.</div></div>
    <div class="panel">${grp.exists ? grp.users.map((u) => row(`${esc(u.name)}${u.you ? ' <span class="pill">you</span>' : ''}`, `uid ${u.uid}${u.primary ? ' · docker is this user\'s primary group' : ''}${u.you && u.member !== u.sessionHas ? `<br><span class="pending">${u.member ? 'Added, but your current login session does not have it yet. Log out and back in, or run newgrp docker in a terminal.' : 'Removed, but your current session still has it until you log out and back in.'}</span>` : ''}`,
      `<label class="switch"><input type="checkbox" data-groupuser="${esc(u.name)}" data-you="${u.you ? 1 : 0}" ${u.member ? 'checked' : ''} ${u.primary ? 'disabled' : ''}></label>`)).join('') || row('No regular users found', '', '')
      : row('The docker group does not exist', 'Install Docker first (sudo apt install docker.io).', '')}</div>
    <div class="tools" style="margin-top:16px">${tbtn('restart', tr('Reset settings'), call('resetsettings'))}</div>`
}
document.addEventListener('change', async (e) => {
  const gu = e.target.dataset?.groupuser
  if (gu) {
    const on = e.target.checked, you = e.target.dataset.you === '1'
    const ask = on
      ? `Add “${gu}” to the docker group?\n\nMembers can start containers as root and take full control of this machine. You will be asked for an administrator password.`
      : `Remove “${gu}” from the docker group?${you ? '\n\nThis is YOUR account: you will lose access to Docker the next time you log in.' : ''}\n\nYou will be asked for an administrator password.`
    if (!confirm(ask)) { e.target.checked = !on; return }
    e.target.disabled = true
    try { await api('group.set', gu, on); toast(`${gu} ${on ? 'added to' : 'removed from'} the docker group. It applies at their next login.`) } catch (err) { toast(err.message, true) }
    window.refresh?.()
    return
  }
  const k = e.target.dataset?.setting; if (!k) return
  if (k === 'theme') applyTheme(e.target.value)
  else if (k === 'refresh') { settings.refresh = Number(e.target.value); saveSettings(); go(current); toast('Saved') }
  else if (k === 'notify') {
    if (e.target.checked) {
      const ok = 'Notification' in window && (Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted')
      if (!ok) { e.target.checked = false; return toast('Notifications are blocked. Allow them for this app in your browser settings.', true) }
    }
    settings.notify = e.target.checked; saveSettings(); toast('Saved')
  }
  else if (k === 'alertCpu' || k === 'alertMem') {
    settings[k] = Number(e.target.value); saveSettings(); breach.clear(); toast('Saved')
    if (settings[k] && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission()
  }
  else if (k === 'lang') { settings.lang = e.target.value; saveSettings(); document.documentElement.lang = langCode(); retranslate(); nav(); renderStatus(); go(current); toast(tr('Saved')) }
  else if (k === 'autoUpdate') { settings.autoUpdate = e.target.checked; saveSettings(); toast(tr('Saved')); if (settings.autoUpdate) checkForUpdate({ silent: true }) }
  else if (k === 'tray') {
    try { await api('tray.set', e.target.checked); toast(tr(e.target.checked ? 'The tray icon is on. Closing the window now keeps DockDesk running in the tray.' : 'The tray icon is off.')) }
    catch (err) { e.target.checked = !e.target.checked; toast(err.message, true) }
  }
  else if (k === 'stats') { settings.stats = e.target.checked; saveSettings(); if (!settings.stats) { setStats({}); applyStats() } else refreshStats(); toast('Saved') }
})
