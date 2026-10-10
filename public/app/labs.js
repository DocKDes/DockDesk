// Part of the DockDesk page (see app.js). Imports are generated from what this file uses; circular imports are fine because everything is used at call time.
import { cname, pubPorts, setCList } from './containers.js'
import { $, api, call, esc, fmt, ibtn, ic, stream, tbtn, toast, tr } from './core.js'
import { closeModal } from './dialogs.js'

// ---------- Labs: one-click practice targets and a Kali toolbox ----------
// Everything here is intentionally vulnerable, so ports are published on this computer only (127.0.0.1).
export const LABS = [
  { id: 'juice-shop', name: 'OWASP Juice Shop', image: 'bkimminich/juice-shop', ports: [[3000, 3000]], open: '/', desc: 'Modern vulnerable web app covering the OWASP Top 10. Has a built-in score board.' },
  { id: 'dvwa', name: 'DVWA', image: 'vulnerables/web-dvwa', ports: [[8081, 80]], open: '/', desc: 'Damn Vulnerable Web Application. Log in with admin / password, then press “Create / Reset Database”.' },
  { id: 'webgoat', name: 'WebGoat', image: 'webgoat/webgoat', ports: [[8082, 8080], [9090, 9090]], open: '/WebGoat', desc: 'Guided lessons for common web vulnerabilities. Register a new user on first visit.' },
  { id: 'bwapp', name: 'bWAPP', image: 'raesene/bwapp', ports: [[8083, 80]], open: '/install.php', desc: 'Buggy web app with 100+ bugs. Visit /install.php first, then log in as bee / bug.' },
  { id: 'mutillidae', name: 'Mutillidae II', image: 'citizenstig/nowasp', ports: [[8084, 80]], open: '/', desc: 'Deliberately vulnerable app with hints. Press “Reset DB” on first visit.' },
  { id: 'kali', name: 'Kali toolbox', image: 'kalilinux/kali-rolling', ports: [], caps: ['NET_ADMIN', 'NET_RAW'], interactive: true, desc: 'Official Kali image kept running with a terminal. Open its terminal from the ⋮ menu, then run apt update && apt install kali-tools-top10.' }
]
const labOf = (cs, id) => cs.find((c) => c.Labels?.['dockdesk.lab'] === id)

export async function labsPage() {
  const [cs, imgs] = await Promise.all([api('containers.list'), api('images.list')])
  const have = (img) => imgs.some((i) => (i.RepoTags || []).some((t) => t === img || t === img + ':latest'))
  setCList(cs)
  return `<div class="head"><h2>${ic('flask', 22)}${tr('Labs')}</h2></div>
    <div class="note">${ic('info', 16)}<div><b>These apps are intentionally vulnerable.</b> DockDesk publishes their ports on <span class="mono">127.0.0.1</span> only, so nothing is reachable from your network. Never run them on an exposed interface.</div></div>
    <div class="labgrid">${LABS.map((l) => {
      const c = labOf(cs, l.id), up = c?.State === 'running', port = c && pubPorts(c)[0]
      const acts = !c ? tbtn('play', have(l.image) ? 'Start lab' : 'Pull and start', call('startlab', l.id), 'pri')
        : up ? `${port && l.open ? tbtn('ext', 'Open', call('open.url', `http://localhost:${port.PublicPort}${l.open}`), 'pri') : tbtn('terminal', 'Terminal', call('term', c.Id, cname(c)), 'pri')}${ibtn('stop', 'Stop', call('container.action', c.Id, 'stop'), 'stop')}${ibtn('more', 'More actions', call('menu', c.Id))}${ibtn('trash', 'Remove', call('labrm', c.Id), 'dan')}`
          : `${ibtn('play', 'Start', call('container.action', c.Id, 'start'), 'ok')}${ibtn('trash', 'Remove', call('labrm', c.Id), 'dan')}`
      return `<div class="card lab"><div class="k">${c ? `<span class="dot ${c.State}"></span>` : ''}${esc(l.name)}${have(l.image) ? '<span class="pill">image ready</span>' : ''}</div>
        <div class="s lab-desc">${esc(l.desc)}</div><div class="mono meta">${esc(l.image)}${l.ports.length ? ' · ' + l.ports.map(([h, p]) => `127.0.0.1:${h}→${p}`).join(', ') : ''}</div>
        <div class="actions" style="justify-content:flex-start;margin-top:10px">${acts}</div></div>`
    }).join('')}</div>`
}

// Pull the image if needed, then create + start the lab container.
export async function startLab(id) {
  const lab = LABS.find((l) => l.id === id)
  closeModal()
  const m = document.createElement('div')
  m.className = 'modal'
  m.innerHTML = `<div class="box"><h3>${ic('flask', 18)}${esc(lab.name)}</h3><div id="lstat" class="meta">Checking image…</div><div class="bar"><i id="lbar" style="width:0%"></i></div><div id="lerr"></div>
    <div class="row"><button type="button" class="tb" id="lclose">Close</button></div></div>`
  document.body.append(m)
  const stat = $('#lstat', m), bar = $('#lbar', m)
  let stopPullLab = null
  $('#lclose', m).onclick = () => { stopPullLab?.(); closeModal() }
  try {
    const imgs = await api('images.list')
    const have = imgs.some((i) => (i.RepoTags || []).some((t) => t === lab.image || t === lab.image + ':latest'))
    if (!have) {
      const layers = new Map()
      await new Promise((resolve, reject) => {
        stat.textContent = 'Contacting Docker Hub… (the first response can take a few seconds)'
        stopPullLab = stream('pull', { image: lab.image }, (ev) => {
          if (ev.k === 'error') return reject(new Error(ev.d))
          if (ev.k === 'end') return resolve()
          const d = ev.d
          if (!/^[0-9a-f]{12}$/.test(d.id || '')) return
          if (d.progressDetail?.total) layers.set(d.id, [d.progressDetail.current, d.progressDetail.total])
          const cur = [...layers.values()].reduce((a, v) => a + v[0], 0), tot = [...layers.values()].reduce((a, v) => a + v[1], 0)
          if (tot) { bar.style.width = Math.min(100, (cur / tot) * 100) + '%'; stat.textContent = `Downloading ${fmt(cur)} of ${fmt(tot)}` }
        })
      })
      stopPullLab = null
    }
    bar.style.width = '100%'; stat.textContent = 'Starting container…'
    const spec = { image: lab.image, name: 'dd-lab-' + lab.id, lab: lab.id, bindIp: '127.0.0.1', caps: lab.caps || [], interactive: !!lab.interactive, ports: lab.ports.map(([host, container]) => ({ host: String(host), container: String(container) })) }
    let note = ''
    try { await api('container.run', spec) } catch (e) {
      if (!/already allocated|address already in use/i.test(e.message)) throw e
      spec.ports = spec.ports.map((p) => ({ ...p, host: '' })) // preferred port is taken: let Docker pick a free one
      await api('container.run', spec); note = ' (the usual port was busy, so a free one was chosen)'
    }
    toast(`${lab.name} is running${note}`); closeModal(); window.refresh?.()
  } catch (e) { $('#lerr', m).innerHTML = `<div class="err">${esc(e.message)}</div>` }
}
