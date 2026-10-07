# DockDesk tests

No dependencies: Node's built-in test runner, `node:assert`, and a tiny browser driver (`cdp.mjs`).

```sh
npm test                  # everything that can run on this machine
npm run test:security     # access control, token handling, input validation (no Docker needed for most)
npm run test:api          # the server against a real Docker engine
npm run test:ui           # the real UI in headless Chromium
npm run test:registry     # opt-in: sign in / tag / push against a local password-protected registry
node tests/run.mjs api    # same as test:api; any file-name prefix works
```

Tests that can't run here are **skipped with a reason**, never failed: no Docker, no Chromium/Chrome, Node older than 22 (the browser driver uses the global `WebSocket`), no `docker compose`.

## What each file covers

| File | Covers |
|---|---|
| `security.test.mjs` | Token required everywhere, foreign `Host`/`Origin` refused, no path traversal, the launch token never appears on a command line (a stand-in browser records exactly what it receives), launch file is `0600` and deleted on first use, every validated input is refused before anything privileged runs, docker-group changes only ever go through `pkexec` with a fixed argument list (a stand-in `pkexec` records it) |
| `api.test.mjs` | Engine info/events/history, container run options verified with `docker inspect`, lifecycle, live updates, volumes and networks, image history/tag/build/export/import round trip, container file listing/preview/download/upload (byte-for-byte checks), log download/stream, compose validate/save/read/write rules and a real up/edit/down cycle |
| `ui.test.mjs` | Every page renders, sidebar order, Overview, search, all container drawer tabs, log viewer (colours, search, filter, download), file browser (including upload), command palette, compose editor validation, run dialog, layers view, Activity, Labs, Settings; fails on any uncaught JavaScript error |
| `registry.test.mjs` | Opt-in. Real sign-in, push, catalog check and sign-out; proves the password is never returned or written in clear |

## Safety

- Everything the tests create is named `ddtest-<random>…` and removed afterwards, including anonymous volumes created during the run. Your own containers, images, volumes and networks are never touched.
- Nothing stops or restarts the Docker engine, and no test changes your group membership or `~/.docker/config.json` (the registry test uses a scratch `DOCKER_CONFIG`).
- Tests use an image you already have (busybox/alpine, or any `*-alpine`). If none exists, `alpine:3` is pulled and removed again. Override with `DD_TEST_IMAGE=some/image`.
- Tests that need the internet (Docker Hub search) are skipped unless `DD_TEST_NETWORK=1`.

## Adding a test

Use `startServer()` from `helpers.mjs` (random port, real server), `janitor()` for temp dirs and cleanup, and name anything you create with `PREFIX`. For UI tests, `openPage()` gives `eval`, `click`, `set`, `waitFor`… and records uncaught page errors in `page.exceptions`. Prefer `waitFor(...)` over fixed sleeps.
