# DockDesk

A small, fast Docker Desktop UI alternative for Linux (built and tested on Kali). It is a GUI over the Docker
Engine you already run, so there is no VM and no extra daemon: **under 1 MB of source (about 540 KB of it ours, the rest is the bundled terminal), a ~250 KB `.deb`,
zero npm dependencies** (xterm.js is bundled for the terminal).

## What it does

| Area | Features |
|---|---|
| **Containers** | List with live CPU, start/stop toggle, ⋮ menu, bulk select/delete, search and filter. Detail drawer: overview, a log viewer (search with highlighting, only-matching filter, tail and timestamp options, follow, colours, download as .log), live stats (CPU, memory, network and disk rates), **files** (browse, preview, **edit and save in place**, upload, download; also on stopped containers and scratch/distroless images), settings (rename, restart policy, set or **remove** memory/CPU limits) and a JSON inspector with section chips and search |
| **Terminals** | Docked panel with tabs: a host shell and container shells (up to 3) |
| **Images** | One row per tag, pull with progress and Docker Hub search, **build from a Dockerfile**, tag, push, **export to / import from a .tar**, per-layer size and instruction view, **Run dialog** (ports, volumes, env, network, capabilities, devices, limits, restart policy; **saved presets**, copy as Compose, paste a `docker run` command), **vulnerability scan** (Trivy or Grype, whichever is installed; cancellable, with the last result kept per image), **check for updates** per tag and **compare** two images |
| **Volumes / Networks** | Create, search, filter, bulk delete, usage, details |
| **Compose** | Projects with expandable services, search and filters, start/stop/restart/down, start with profiles, pull/build, restart or scale one service, **combined colour-coded logs**, `.env` editing, a **dependency graph**, and an **editor**: write or paste a compose file (templates included), validate it, save and start with live output, or edit a running project's file |
| **Overview and clean up** | Dashboard with disk usage; Clean up rows (stopped containers, unused images, volumes, networks, build cache) open their page pre-filtered, plus a **Clean everything** button that reports the space reclaimed |
| **Copy as command** | Every dialog (Run, volume, network, tag, pull, build, push, export, import, sign-in, settings, compose editor) can show the equivalent `docker` command |
| **Labs** | One-click DVWA, Juice Shop, WebGoat, bWAPP, Mutillidae and a Kali toolbox, published on `127.0.0.1` only |
| **Command palette** | Ctrl+K (or `/`): jump to any page, container, image, volume, network or compose project, and run actions like stop, restart, logs, terminal, pull, build |
| **Activity** | The last 6 hours of Docker events plus a live feed, with search, type filter, a problems-only view and links to the container or image; the UI refreshes on change instead of polling hard |
| **Accessibility** | Fully keyboard-operable (rows, tabs, menus, dialogs with focus handling, skip link, visible focus ring), screen-reader names and landmarks, 4.5:1 text contrast in both themes, honours reduced motion |
| **Settings** | Theme, language (English, Spanish, French, German, Hindi; the whole app, not only the menus), refresh rate, crash and CPU/memory alerts, keyboard shortcuts (`?`, and `g` then a letter to jump to a page), update check with **Download and verify** for `.deb`/`install.sh` installs, optional system tray icon, export/import of settings and Run presets, registry sign-in, Docker group management with a one-click relaunch to apply the group, engine info |

## Requirements

- Docker Engine running locally, and your user in the `docker` group (the app tells you how if not)
- Node.js 18.17 or newer
- Chromium or Chrome (used as a chromeless app window; falls back to `xdg-open`)
- Optional: `python3` (host shell), the `docker compose` and `docker buildx` plugins, `pkexec`/polkit (start/stop the engine), Trivy or Grype (image scans), the GitHub CLI `gh` (checks the build attestation of downloaded updates)

## Install

Get the latest files from the project's **Releases** page (each release has a `.deb`, a source `.tar.gz` and `SHA256SUMS`; check the download with `sha256sum -c SHA256SUMS`).

**Debian, Ubuntu, Kali (recommended)**

```sh
sudo apt install ./dockdesk_<version>_all.deb
```

**npm** (any Linux with Node 18.17+ and Chromium or Chrome)

```sh
npx dockdesk                     # try it without installing
npm install -g dockdesk          # install the `dockdesk` command
```

The npm package has no dependencies and runs no install scripts; it is the same code as the release files.

**Any Linux, no root**

```sh
tar xzf dockdesk-<version>.tar.gz && cd dockdesk-<version> && ./install.sh   # menu entry + ~/.local/bin/dockdesk
./uninstall.sh                                                               # remove it again
```

**From source**

```sh
./bin/dockdesk                 # run straight from this folder
npm run release                # build dist/release/ (.deb, tarball, checksums)
```

### About Docker itself

DockDesk is an interface to the Docker Engine already on your machine; it does **not** bundle one (that is how it stays small, and it means your containers are the same ones the `docker` CLI shows). The `.deb` lists Docker, Compose and polkit as *recommended* packages, so `apt install` fetches them unless you pass `--no-install-recommends`; `dpkg -i` and `install.sh` install nothing. If Docker is missing, or your user isn't in the `docker` group, the app says so and shows the fix.

After updating a source or `install.sh` install, run `./install.sh` again and restart DockDesk: the installed copy is a snapshot.

## Security model

DockDesk can do anything the `docker` group can, which is root-equivalent. It is built so that only you can use it:

- The server listens on **127.0.0.1 only**, rejects foreign `Host`/`Origin` headers (DNS-rebinding/CSRF), and needs a random **per-launch token** for every API and stream call.
- The token never appears on a command line (those are world-readable via `/proc`). The browser opens a private `0600` file that redirects to the app, and the file is deleted on first use. The token is printed only when you run it from a terminal.
- Everything that reaches Docker is validated (names, ports, devices, capabilities, tags, paths) and commands run with argument lists, never through a shell.
- **Engine start/stop** asks for your password via polkit. An *optional* one-time rule (`dockdesk-polkit.rules`, copy it from Settings) removes that prompt for `docker.service` only.
- **Docker group management** (Settings) only touches the `docker` group, only regular local users, and always goes through `pkexec`, so it needs an administrator password every time.
- **Update check** is the only thing DockDesk sends over the internet by itself, and only when you press the button (or once a day if you switch that on): one HTTPS request to `registry.npmjs.org` for the latest version. Nothing about your machine is sent. It never installs anything. For `.deb` and `install.sh` installs, **Download and verify** (a button you press) fetches the new release from GitHub over HTTPS, checks it against the release's `SHA256SUMS` and, if the GitHub CLI (`gh`) is installed, against its signed build attestation, then saves it in `~/.cache/dockdesk/updates` and shows the install command. See `SECURITY.md` for what each check does and does not prove.
- **System tray** (optional) is a small helper process that talks to DockDesk over its stdin/stdout only; it has no network access and never sees the token. Its menu can start or stop the Docker engine and stop all containers, the same things the app can already do.
- **Registry sign-in** hands the password to `docker login --password-stdin`; Docker stores it, DockDesk never reads, returns or logs it. Without a credential helper Docker keeps it base64-encoded in `~/.docker/config.json` (mode 600).
- **Labs** are intentionally vulnerable apps. Ports are bound to `127.0.0.1`; don't change that on a network you don't control.
- The **host shell** is a real shell as your user. Treat the token like a password.

## How it works

`server.js` talks to `/var/run/docker.sock` over HTTP, serves `public/`, and streams logs, stats, events,
pulls, builds and terminals to the page as server-sent events (input goes back as small POSTs).
`pty-shell.py` gives the host shell a real pty. Each run of the app window uses its own temporary browser profile under `~/.cache/dockdesk/` (removed on exit), so two copies can run side by side. The UI is plain JavaScript modules with inline SVG
icons: no framework and no build step. `public/app.js` starts it and its header lists the files in `public/app/` (one per area: containers, images, compose, the Run dialog, logs, files…); `translate.js`, `a11y.js` and `i18n.js` handle languages and keyboard/screen-reader support.

Heavier jobs use the Docker CLI on purpose, so they behave exactly as on the command line: `docker build`
(BuildKit, `.dockerignore`), `docker push`/`login`, and `docker compose`.

## Compose editor notes

New projects are saved in `~/.local/share/dockdesk/projects/<name>/compose.yaml` (file mode 600, since compose files can hold secrets). DockDesk can edit only those files and the compose file of a project that has containers; saving over an existing file keeps a `.dockdesk.bak` copy next to it. Validation runs `docker compose config`, so errors are Docker's own.

## Tests

```sh
npm test          # everything below (Node's built-in runner, no dependencies)
npm run lint      # ESLint: undefined names, unused imports (fetched on demand; the app has no dependencies)
```

About 170 tests in ten files: syntax and structure of every source file, translations and colour contrast, access control and the launch-token handling, input validation, vulnerability scans and update downloads (against stand-in tools and servers), every API against a real Docker engine, and the real UI in headless Chromium, including keyboard use and a full French run. Anything that can't run on your machine is skipped with a reason, and everything the tests create is named `ddtest-…` and removed afterwards. CI repeats this on several Ubuntu and Node versions and installs the `.deb` on Debian, Ubuntu and Kali. See `tests/README.md`.

## Troubleshooting

- **"No permission to use Docker"**: add yourself with `sudo usermod -aG docker $USER`, then log out and back in. Settings shows whether your *current session* has the group yet.
- **Changed groups but `id` doesn't show it**: group membership is fixed at login. DockDesk notices this and offers **Restart with Docker access**, which relaunches it through `sg docker` (no logout needed). Elsewhere, use `newgrp docker` or log in again. `getent group docker` shows the saved state.
- **Stop Docker asks for a password**: expected; install the optional rule from Settings to skip it.
- **Docker Hub search or pulls are slow**: the first registry round trip can take several seconds; it is the network, not the app.
- **Removing a memory/CPU limit**: Docker's update API can change a limit but not clear it, so Settings → *Remove memory/CPU limit* recreates the container with the same settings, volumes (including anonymous ones) and networks, and puts the original back if anything fails. Files changed inside the container's own filesystem are lost, and Compose-managed containers are refused (edit the compose file instead).

- **Compose features say "Docker Compose v2 is not installed"**: the message and Settings → Engine show the exact install command for your distro (read from `/etc/os-release`). The plugin is a separate package whose name differs by distro: `docker-compose-v2` (Ubuntu), `docker-compose` (Debian 13, Kali), `docker-compose-plugin` (Docker's own repository). Debian 12's `docker-compose` is the old v1 and does not work. Settings → Engine shows whether it was found.
- **`apt install` says `nodejs (>= 18.17)` is not going to be installed (Ubuntu 22.04)**: that release's own Node.js is version 12. Install Node 18 or newer first (for example from NodeSource, or `nvm`), then use `npm install -g dockdesk` or `./install.sh` instead of the `.deb`. Debian 12 and 13, Ubuntu 24.04 and Kali install it without extras (checked in CI).
- **Ubuntu's Chromium is a snap**: `chromium-browser` there is a stub for the snap, whose confinement can stop the app window from reading its private launch file. Install Google Chrome or Chromium from another source if the window doesn't open (not yet tested on Ubuntu).

## Known limits

Translations: names you own (containers, images, volumes), logs and messages from Docker itself stay as they are, as do desktop notifications and dates. Most of the Spanish, French, German and Hindi text beyond the menus was machine-translated and still needs review by native speakers.

Container file browsing runs `ls` inside a running container. For stopped containers and images with no `ls` (scratch, distroless) it lists from the filesystem archive instead; that works everywhere, but tar has no "children only" query, so a huge folder is scanned up to a limit and the list can be marked incomplete. Uploads are limited to 512 MB per file.

Image scanning needs Trivy or Grype installed; DockDesk does not bundle a scanner. A scan can be cancelled and is stopped after 10 minutes; the first one also downloads the scanner's database. The latest result per image is kept in `~/.local/share/dockdesk/scans`. The tray icon needs `python3-gi` and an AppIndicator library, and is off by default.

Not implemented: Kubernetes, Swarm, Docker extensions, dev environments, remote engines (only a local `unix://` socket via `DOCKER_HOST`; `ssh://`, `tcp://` and `docker context` are not supported). At most 3 terminal tabs, because browsers allow only 6
simultaneous connections per host and the page needs a few for itself. The embedded terminal (xterm.js) is not yet announced by screen readers, and page changes are not announced either (focus stays where it was).

## License

MIT, copyright (c) 2026 Panem Yaswanth Reddy. See `LICENSE`. The bundled terminal library (xterm.js) is MIT licensed too; see `THIRD_PARTY_NOTICES.md`. Security issues: see `SECURITY.md`.
