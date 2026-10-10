// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { cexp, composeEditor, composeEnv, composeGraph, composeProfiles, composeRows, editProject, projectLogs, scaleService, showComposeMenu, visibleProjects } from './compose.js'
import { openDetail } from './container-detail.js'
import { afterContainers, bulk, containerRows, sel, setOnlyRunning, setOnlyStopped, showMenu } from './containers.js'
import { $, SETTINGS_DEFAULTS, act, api, confirm, copyText, fmt, saveSettings, settings, toast, tr } from './core.js'
import { buildImage, exportImage, importImage, pullImage, pushImage, registryLogin, tagImage } from './dialogs.js'
import { activity } from './events.js'
import { openImageDetail, openInspect } from './image-detail.js'
import { bulkDeleteImages, checkImageUpdates, compareImages, imageRows, isel, setIfilter, showImageMenu, updateIBulk } from './images.js'
import { startLab } from './labs.js'
import { GPAGES, bulkDeleteG, gf, gsel, newNetwork, newVolume, showGMenu, updateGBulk } from './lists.js'
import { openPalette, openShortcuts } from './palette.js'
import { runImage } from './run-dialog.js'
import { checkForUpdate, downloadUpdate, exportSettings } from './settings.js'
import { applyTheme, checkDaemon, current, go, hideMenu, nav, renderStatus, toggleTheme } from './shell.js'
import { applyStats, engine, refreshStats } from './state.js'
import { openTerm, toggleDock } from './terminal.js'

document.addEventListener('click', async (e) => {
  if (!e.target.closest('#menu') && !e.target.closest('[data-call*=\'"menu"\']')) hideMenu()
  const b = e.target.closest('[data-call]')
  if (b) {
    e.stopPropagation()
    hideMenu()
    const [fn, ...args] = JSON.parse(b.dataset.call)
    switch (fn) {
      case 'open': return openDetail(args[0], args[1])
      case 'pull': return pullImage(args[0], !!args[0])
      case 'copyrule': {
        const rule = await api('engine.rule')
        const text = `sudo tee /etc/polkit-1/rules.d/50-dockdesk.rules >/dev/null <<'EOF'\n${rule}EOF`
        try { await navigator.clipboard.writeText(text) } catch { return toast('Could not copy. Run: sudo cp dockdesk-polkit.rules /etc/polkit-1/rules.d/50-dockdesk.rules', true) }
        return toast('Copied. Paste it into a terminal to install the rule.')
      }
      case 'resetsettings': Object.assign(settings, SETTINGS_DEFAULTS); saveSettings(); applyTheme('auto'); nav(); renderStatus(); go(current); return toast(tr('Settings reset'))
      case 'tagimg': return tagImage(args[0])
      case 'pushimg': return pushImage(args[0])
      case 'reglogin': return registryLogin()
      case 'reglogout': return act('Signed out', () => api('registry.logout', args[0]), window.refresh)
      case 'build': return buildImage()
      case 'startlab': return startLab(args[0])
      case 'labrm': if (!confirm('Remove this lab container? Its data is lost.')) return; return act('Removed', () => api('container.remove', args[0], true), window.refresh)
      case 'run': return runImage(args[0])
      case 'newvol': return newVolume()
      case 'newnet': return newNetwork()
      case 'gmenu': return showGMenu(b, args[0], args[1])
      case 'inspectg': return openInspect(args[0], args[1], args[2])
      case 'gbulkdel': return bulkDeleteG()
      case 'gbulkclear': gsel[current].clear(); GPAGES[current].redraw(); return updateGBulk()
      case 'goto': return go(args[0])
      case 'actclear': activity.length = 0; return window.refresh?.()
      case 'cmenu': return showComposeMenu(b, args[0])
      case 'newproject': return composeEditor({})
      case 'editproject': return editProject(args[0])
      case 'cleanall':
        if (!confirm('Remove all stopped containers, unused images, unused volumes (their data is lost), unused networks and the build cache?')) return
        return act('', async () => { const r = await api('system.prune'); toast(`Cleaned up. Reclaimed ${fmt(r.reclaimed)}.`) }, window.refresh)
      case 'shortcuts': return openShortcuts()
      case 'checkupdate': return checkForUpdate()
      case 'downloadupdate': return downloadUpdate()
      case 'openrelease': return act('', () => api('open.release'))
      case 'exportsettings': return exportSettings()
      case 'importsettings': return $('#importfile')?.click()
      case 'projectlogs': return projectLogs(args[0])
      case 'imgupdates': return checkImageUpdates()
      case 'cmpimg': return compareImages(args[0])
      case 'composeprofiles': return composeProfiles(args[0])
      case 'composeenv': return composeEnv(args[0])
      case 'composegraph': return composeGraph(args[0])
      case 'svcscale': return scaleService(args[0], args[1], args[2])
      case 'palette': return openPalette()
      case 'cexpall': visibleProjects().forEach((p) => (args[0] ? cexp.add(p.name) : cexp.delete(p.name))); $('#cprows').innerHTML = composeRows(); return applyStats()
      case 'cexp': cexp.has(args[0]) ? cexp.delete(args[0]) : cexp.add(args[0]); return window.refresh?.()
      case 'imenu': return showImageMenu(b, args[0])
      case 'inspectimg': return openImageDetail(args[0], args[1], args[2])
      case 'exportimg': return exportImage(args[0])
      case 'importimg': return importImage()
      case 'ibulkdel': return bulkDeleteImages()
      case 'ibulkclear': isel.clear(); $('#irows').innerHTML = imageRows(); return updateIBulk()
      case 'menu': return showMenu(b, args[0])
      case 'term': return openTerm('exec', args[0], args[1])
      case 'dock': return toggleDock()
      case 'theme': return toggleTheme()
      case 'copy': return (await copyText(args[0])) ? toast('Copied') : toast('Could not copy', true)
      case 'bulk': return bulk(args[0])
      case 'bulkclear': sel.clear(); $('#rows').innerHTML = containerRows(); return afterContainers()
      case 'showunused': { // [page, filter]: open that page with its filter preset
        const [page, f] = args
        if (page === 'images') setIfilter(f)
        else if (page === 'containers') { setOnlyRunning(false); setOnlyStopped(true) }
        else gf[page] = f
        return go(page)
      }
      case 'relaunch':
        toast('Restarting DockDesk with Docker access…')
        try { await api('app.relaunch') } catch (err) { toast(err.message, true) } // on success this page's server exits and a new window opens
        return
      case 'engine':
        if (engine.up) { if (!confirm('Stop the Docker daemon? All containers will stop. You may be asked for your password.')) return; return act('Stopping Docker…', () => api('daemon.stop'), checkDaemon) }
        return act('Starting Docker…', () => api('daemon.start'), checkDaemon)
      case 'confirm':
        if (!confirm(args[0])) return
        return act('Done', () => api(...args.slice(1)), window.refresh)
    }
    b.classList.add('busy')
    await act(fn === 'open.url' ? '' : 'Done', () => api(fn, ...args), () => { window.refresh?.(); refreshStats() })
    b.classList.remove('busy')
    return
  }
  const cp = e.target.closest('tr[data-cp]')
  if (cp && !e.target.closest('a,input,button,label')) { const n = cp.dataset.cp; cexp.has(n) ? cexp.delete(n) : cexp.add(n); return window.refresh?.() }
  const row = e.target.closest('tr[data-open]')
  if (row && !e.target.closest('a,input,button,label')) openDetail(row.dataset.open)
})
