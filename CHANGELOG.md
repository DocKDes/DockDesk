# Changelog

## 0.1.2 (2026-10-09)

**Images**
- Scan an image for vulnerabilities with Trivy or Grype (whichever is installed), from the image menu or the new Vulnerabilities tab.
- "Check for updates" compares each tag with its registry and marks images that have a newer version. "Compare" shows two images side by side (size, config, environment, layers).

**Containers and the Run dialog**
- Published-port links have a copy button, and the Run dialog warns when a host port is already in use (by another container or program).
- Run dialog: save and load named presets, "Copy as Compose", and "Paste docker run…" to fill the form from a command.
- Every dialog (Run, volume, network, tag, pull, build, push, export, import, sign-in, container settings, compose editor) has "Copy as command", showing the equivalent `docker` command.
- Text files in a container can be edited and saved in place from the Files tab, keeping their permissions and owner.
- The Files tab also works on stopped containers and on images with no `ls` (scratch, distroless).
- Memory and CPU limits can be removed from a container's Settings tab (the container is recreated with the same settings, volumes and networks; the original is restored on failure).

**Compose**
- "View combined logs" streams every service of a project in one colour-coded view, with a filter and per-service toggles.
- Start with profiles, pull or build images, restart or scale a single service, edit the project's `.env`, and see a dependency graph.
- Compose actions now only accept compose files that belong to a project DockDesk may use.
- The Compose error and Settings → Engine show the install command for your distro.

**Overview and cleanup**
- Clean up has a build cache row and a "Clean everything" button (stopped containers, unused images, volumes, networks and build cache; shows the space reclaimed).
- Each Clean up row opens its page already filtered to what would be removed, and Containers gained an "Only show stopped" switch.

**App**
- Keyboard shortcuts: press `?` for a cheat sheet; `g` then `o`/`m`/`c`/`i`/`v`/`n`/`l`/`a`/`s` jumps to a page, `t` toggles the terminal, `r` refreshes.
- Update checker (Settings → Updates): asks registry.npmjs.org for the newest version, only when you press the button or, if you turn it on, once a day. It shows how to update for your kind of install and adds a pill to the status bar. It never downloads or installs anything.
- Languages: Spanish, French, German and Hindi for the menus, page titles, status bar and Settings; the rest stays English. More can be added in `public/i18n.js`.
- Optional system tray icon (Settings → General): keeps DockDesk running in the tray when you close the window, with a menu to open it and to start or stop Docker or all containers. Needs python3-gi and an AppIndicator library (the `.deb` suggests them).
- Settings backup: export your settings, theme, language and saved Run presets to a file and import them elsewhere.
- CPU and memory alerts notify when a container stays above a threshold for about 15 seconds.
- After being added to the `docker` group, the app offers to restart itself with the group applied instead of asking for a logout.

## 0.1.1 (2026-10-07)

- Published on npm: `npx dockdesk` to try it, `npm install -g dockdesk` to install (Linux, Node 18.17+). The package has no dependencies and no install scripts.
- Package metadata now links to the repository, homepage and issue tracker.
- The release workflow publishes to npm with provenance when an `NPM_TOKEN` secret is set, and is safe to re-run.

## 0.1.0 (2026-10-07)

First release.

- Containers: live CPU, start/stop toggle, bulk actions, search, logs (search, filter, colours, download), live stats, file browser (preview, upload, download), settings (rename, restart policy, limits), JSON inspector with section chips.
- Images: pull with Hub search, build from a Dockerfile, tag, push, export/import `.tar`, layer view, run dialog with advanced options.
- Volumes and networks: create, search, filter, bulk delete.
- Compose: project list with services and resource use, editor with templates and validation, start/stop/edit.
- Labs: one-click practice targets (DVWA, Juice Shop, WebGoat, bWAPP, Mutillidae) and a Kali toolbox, published on 127.0.0.1 only.
- Overview dashboard, Activity feed (history plus live events), crash notifications, command palette (Ctrl+K), docked terminals, light and dark themes.
- Registry sign-in, optional passwordless engine start/stop rule, docker-group management with warnings.
- Debian/Ubuntu/Kali package with the right dependency names per distro, a clear message when the Compose plugin is missing, and Compose/Buildx status in Settings.
- Test suite (`npm test`): security, API against real Docker, and browser UI tests.
