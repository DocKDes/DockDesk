# Security

DockDesk controls Docker, and members of the `docker` group effectively have root on the machine, so please treat its security seriously.

## Supported versions

DockDesk is pre-1.0 and maintained by one person. Only the **latest release** gets security fixes; please update before reporting.

| Version | Supported |
|---|---|
| latest `0.2.x` release (see the [releases page](https://github.com/DocKDes/DockDesk/releases/latest)) | yes |
| anything older | no (update to the latest) |

When 1.0 is released this table will say how long each line is supported.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Email panemyaswanthreddy@gmail.com with what you found, how to reproduce it, and the version (`dockdesk` package version or git commit).

What you can expect (targets for a one-person project, not guarantees):

| Step | Target |
|---|---|
| You get a reply confirming the report | within 5 days |
| First assessment (is it a vulnerability, how severe) | within 14 days |
| Fix or mitigation released for a confirmed high or critical issue | within 30 days |
| Fix for lower-severity issues | in the next regular release |
| Public disclosure | after a fix is released, and no later than 90 days after your report unless we agree otherwise |

You will be credited in the release notes if you want to be. If you hear nothing within the first reply window, please send the report again: mail does get lost.

**In scope:** the server and page code in this repository, the `.deb`, `install.sh`/`uninstall.sh`, the update download, and the release process. **Out of scope:** vulnerabilities in Docker, Chromium, Node.js or the Labs targets themselves (they are intentionally vulnerable), and attacks that already need the launch token or a shell as your user.

## Design in brief

- The server listens on `127.0.0.1` only, refuses foreign `Host`/`Origin` headers, and requires a random per-launch token on every API, stream, download and upload request.
- The token never appears on a command line. The browser opens a private (`0600`) launch file that is deleted on first use.
- Every value that reaches Docker is validated, and commands run with argument lists, never through a shell.
- Changing engine state or the `docker` group goes through `pkexec`, so an administrator password is required.
- The host terminal is a real shell as the current user: anyone holding the token has your user's powers. Keep DockDesk off networked or shared machines.

The full model is in the README, and `npm run test:security` checks it.

## Updates and verifying a release

- **Update check** asks `registry.npmjs.org` for the newest version number and nothing else. It never installs anything.
- **Download and verify** (Settings → Updates, `.deb` and `install.sh` installs, only when you press it) downloads the release file from GitHub over HTTPS, only from GitHub release addresses, with a size limit. It refuses the file unless its SHA-256 matches the release's `SHA256SUMS`; if the GitHub CLI (`gh`) is installed it also verifies the signed build attestation and deletes the file if that fails. The file is saved with mode 600 and the install command is shown, never run.

What each check proves, so you know what you are relying on:

| Check | Protects against | Does not protect against |
|---|---|---|
| HTTPS to GitHub | tampering on the network | a compromised GitHub account |
| `SHA256SUMS` match | a corrupted or swapped download | someone who can replace both the file and `SHA256SUMS` in the release |
| Build attestation (Sigstore, via `gh attestation verify`) | a file that was not built by this repository's release workflow, even if the release was edited by hand | a compromise of the workflow or the repository itself |
| npm provenance (`npm audit signatures`) | an npm package that was not built by this repository's workflow | the same |

To check a download yourself:

```sh
sha256sum -c SHA256SUMS --ignore-missing                  # the file matches the checksum list
gh attestation verify dockdesk_<version>_all.deb --repo DocKDes/DockDesk   # it was built by the release workflow
```

Attestations are attached to releases from 0.2.0 on; older releases only have `SHA256SUMS`. There is no apt repository or GPG signature yet, so an `apt upgrade` path does not exist: updating is always a deliberate download.
