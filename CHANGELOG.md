# Changelog

## Unreleased

**Updates and security policy**
- Settings → Updates has **Download and verify** for `.deb` and `install.sh` installs: it downloads the new release from GitHub (HTTPS only, GitHub addresses only, size-limited), refuses it unless its SHA-256 matches the release's `SHA256SUMS`, checks the signed build attestation when `gh` is installed (and removes the file if that check fails), saves it with mode 600 and shows the exact install command. Nothing is installed; that stays your decision.
- Release files (`.deb`, `.tar.gz`, `SHA256SUMS`) now get a signed build attestation from the release workflow (verify with `gh attestation verify <file> --repo DocKDes/DockDesk`). npm releases already carry provenance.
- `SECURITY.md` now has a supported-versions table, response-time targets, what is in scope, and how to verify a release.
**Code structure**
- The 2,870-line `public/app.js` is split into 22 modules in `public/app/` (about 40 to 350 lines each: core helpers, shell and routing, one file per page, the Run dialog, dialogs, the container drawer's tabs, the terminal…). `app.js` is now a short entry point whose header explains the layout. Behaviour is unchanged; the whole test suite passes on the split code.
- ESLint (`npm run lint`, also in CI, nothing added to the app's dependencies) checks for names that are used but not imported, unused imports and common slips. It already caught one mistake made during the split, and removed three unused helpers.
- Other modules cannot assign to a variable another module owns, so the few shared values that are changed from elsewhere (for example the container list) now have setter functions.

**Tests and CI**
- CI now runs on Ubuntu 24.04 and 22.04 (Node 22) and on Node 20 and 18, with a fast `static` job first (syntax of every file, shell and Python helpers, translations, contrast, `shellcheck`). It also runs weekly, with the opt-in registry and Docker Hub tests, CodeQL security analysis, and Dependabot for the actions.
- The release is built in CI and its `.deb` is installed on Debian 12 and 13, Ubuntu 24.04 and Kali, started and removed (`packaging/smoke-test.sh`). The release workflow also refuses to publish without a changelog section for the tag.
- Found while setting this up: on Ubuntu 22.04 the `.deb` cannot be installed because that release only ships Node 12 and the package needs 18.17 or newer. The README now says to install Node first and use npm or `install.sh`.
**Languages**
- The whole app is now translated into Spanish, French, German and Hindi, not just the menus: every page, the container and image drawers, dialogs, tooltips, placeholders, messages, confirmations and empty states (about 720 phrases). Names you own (containers, images, volumes, networks), logs, files, the terminal and Docker's own messages are left exactly as they are.
- How it works: `public/translate.js` translates the page as it is drawn, so new screens don't have to be wrapped in `tr()` one phrase at a time. Phrases with a changing part (`Delete {n} container(s)?`) and Docker's own wording (`Up 3 hours (healthy)`) are handled too. `public/i18n.js` is now a table with one row per phrase and one column per language.
- Most of the new text was machine-translated and has not been reviewed by native speakers; corrections are welcome (edit the row in `public/i18n.js`).
- Not translated: error messages that come straight from Docker, desktop notifications, and dates.
**Accessibility**
- The whole app can be used from the keyboard: sidebar links, table rows (Enter or Space opens the details), the engine switch, tabs (arrow keys move between them), and every other clickable item can take focus. A visible focus ring shows where you are, and a "Skip to main content" link appears on the first Tab.
- Dialogs, the details drawer and the Ctrl+K search are announced as dialogs with a title; focus moves into them, Tab stays inside modal dialogs, and Esc returns focus to the button that opened them. The row "more" menu is a real menu (arrow keys, Home/End, Esc).
- Screen readers: landmarks (navigation, main), the current page is marked, messages ("Saved", errors) are announced, tables have column headers, and every checkbox, filter and icon button has a name (for example "Select web-1").
- Colours: text and filled buttons meet the 4.5:1 contrast guideline in both themes (a darker blue behind white button text in the dark theme, deeper green, amber and red text on light), and animations are turned off if your system asks for reduced motion.
- Vulnerability scans can now be cancelled. They run as a live stream: the scanner's progress (such as the database download) shows while it works, there is a Cancel button, and leaving the tab or closing the panel stops the scanner. A scan is stopped after 10 minutes instead of hanging.
- The last scan of each image is saved (by image id, in `~/.local/share/dockdesk/scans`, mode 600, newest 50 kept), so reopening the tab shows it with its age and a "rescan" hint when it is over a week old. New "fix available" filter.
- With no scanner installed, the message gives the install command for your distro (Kali, Arch, Alpine) or links to the Trivy and Grype install pages.
- Build, Push and Compose "Save and start" have a Stop button while they run.
- Every command DockDesk runs now has a time limit (2 minutes by default, 30 for Compose actions, 5 for password prompts), and a job that ignores a polite stop is force-killed after 5 seconds.
- Fixed: starting DockDesk while another copy's window was still open (for example `npx dockdesk` next to the installed app) opened a broken "ERR_FILE_NOT_FOUND" window and quit. The new browser command was handed to the running browser and returned at once, so the server thought the window had closed. Every run now uses its own temporary browser profile (removed on exit, with leftovers of killed runs swept at the next start), so two copies run side by side.
- DockDesk now exits cleanly on Ctrl+C and kill, removing its launch file and profile.

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
