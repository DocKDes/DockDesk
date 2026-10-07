# DockDesk

A small, fast Docker Desktop UI alternative for Linux (built and tested on Kali). It is a GUI over the Docker
Engine you already run, so there is no VM and no extra daemon: **about 700 KB of source, a ~145 KB `.deb`,
zero npm dependencies** (xterm.js is bundled for the terminal).

## What it does

| Area | Features |
|---|---|
| **Containers** | List with live CPU, start/stop toggle, ⋮ menu, bulk select/delete, search and filter. Detail drawer: overview, a log viewer (search with highlighting, only-matching filter, tail and timestamp options, follow, colours, download as .log), live stats (CPU, memory, network and disk rates), **files** (browse, preview, upload, download), settings (rename, restart policy, limits) and a JSON inspector with section chips and search |
| **Terminals** | Docked panel with tabs: a host shell and container shells (up to 3) |
| **Images** | One row per tag, pull with progress and Docker Hub search, **build from a Dockerfile**, tag, push, **export to / import from a .tar**, per-layer size and instruction view, **Run dialog** (ports, volumes, env, network, capabilities, devices, limits, restart policy) |
| **Volumes / Networks** | Create, search, filter, bulk delete, usage, details |
| **Compose** | Projects with expandable services, search and filters, start/stop/restart/down, and an **editor**: write or paste a compose file (templates included), validate it, save and start with live output, or edit a running project's file |
| **Labs** | One-click DVWA, Juice Shop, WebGoat, bWAPP, Mutillidae and a Kali toolbox, published on `127.0.0.1` only |
| **Command palette** | Ctrl+K (or `/`): jump to any page, container, image, volume, network or compose project, and run actions like stop, restart, logs, terminal, pull, build |
| **Activity** | The last 6 hours of Docker events plus a live feed, with search, type filter, a problems-only view and links to the container or image; the UI refreshes on change instead of polling hard |
| **Settings** | Theme, refresh rate, crash notifications, registry sign-in, Docker group management, engine info |

## Requirements

- Docker Engine running locally, and your user in the `docker` group (the app tells you how if not)
- Node.js 18.17 or newer
- Chromium or Chrome (used as a chromeless app window; falls back to `xdg-open`)
- Optional: `python3` (host shell), the `docker compose` and `docker buildx` plugins, `pkexec`/polkit (start/stop the engine)

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
- **Registry sign-in** hands the password to `docker login --password-stdin`; Docker stores it, DockDesk never reads, returns or logs it. Without a credential helper Docker keeps it base64-encoded in `~/.docker/config.json` (mode 600).
- **Labs** are intentionally vulnerable apps. Ports are bound to `127.0.0.1`; don't change that on a network you don't control.
- The **host shell** is a real shell as your user. Treat the token like a password.

## How it works

`server.js` talks to `/var/run/docker.sock` over HTTP, serves `public/`, and streams logs, stats, events,
pulls, builds and terminals to the page as server-sent events (input goes back as small POSTs).
`pty-shell.py` gives the host shell a real pty. The UI in `public/app.js` is plain JavaScript with inline SVG
icons: no framework and no build step.

Heavier jobs use the Docker CLI on purpose, so they behave exactly as on the command line: `docker build`
(BuildKit, `.dockerignore`), `docker push`/`login`, and `docker compose`.

## Compose editor notes

New projects are saved in `~/.local/share/dockdesk/projects/<name>/compose.yaml` (file mode 600, since compose files can hold secrets). DockDesk can edit only those files and the compose file of a project that has containers; saving over an existing file keeps a `.dockdesk.bak` copy next to it. Validation runs `docker compose config`, so errors are Docker's own.

## Tests

```sh
npm test          # security + API + browser UI tests (Node's built-in runner, no dependencies)
```

About 80 tests: access control and the launch-token handling, input validation, every API against a real Docker engine, and the real UI in headless Chromium. Anything that can't run on your machine is skipped with a reason, and everything the tests create is named `ddtest-…` and removed afterwards. See `tests/README.md`.

## Troubleshooting

- **"No permission to use Docker"**: add yourself with `sudo usermod -aG docker $USER`, then log out and back in. Settings shows whether your *current session* has the group yet.
- **Changed groups but `id` doesn't show it**: group membership is fixed at login. Use `newgrp docker` or log in again. `getent group docker` shows the saved state.
- **Stop Docker asks for a password**: expected; install the optional rule from Settings to skip it.
- **Docker Hub search or pulls are slow**: the first registry round trip can take several seconds; it is the network, not the app.
- **Memory/CPU limits can't be removed**: Docker's update API can change them but not clear them. Recreate the container to go back to unlimited.

- **Compose features say "Docker Compose v2 is not installed"**: the plugin is a separate package whose name differs by distro: `docker-compose-v2` (Ubuntu), `docker-compose` (Debian 13, Kali), `docker-compose-plugin` (Docker's own repository). Debian 12's `docker-compose` is the old v1 and does not work. Settings → Engine shows whether it was found.
- **Ubuntu's Chromium is a snap**: `chromium-browser` there is a stub for the snap, whose confinement can stop the app window from reading its private launch file. Install Google Chrome or Chromium from another source if the window doesn't open (not yet tested on Ubuntu).

## Known limits

Container file browsing lists folders by running `ls` inside the container, so it needs a running container that has `ls`; downloads and uploads work on any container, including stopped ones and minimal images. Uploads are limited to 512 MB per file.

Not implemented: Kubernetes, Swarm, Docker extensions, dev environments, vulnerability scanning, remote engines,
a tray icon (needs a native shell such as Tauri). At most 3 terminal tabs, because browsers allow only 6
simultaneous connections per host and the page needs a few for itself.

## License

MIT, copyright (c) 2026 Panem Yaswanth Reddy. See `LICENSE`. The bundled terminal library (xterm.js) is MIT licensed too; see `THIRD_PARTY_NOTICES.md`. Security issues: see `SECURITY.md`.
