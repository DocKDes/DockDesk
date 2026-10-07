# Changelog

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
