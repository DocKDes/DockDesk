# Security

DockDesk controls Docker, and members of the `docker` group effectively have root on the machine, so please treat its security seriously.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Email panemyaswanthreddy@gmail.com with what you found, how to reproduce it, and the version (`dockdesk` package version or git commit). You will get a reply as soon as possible, and a fix and credit (if you want it) once it's released.

## Design in brief

- The server listens on `127.0.0.1` only, refuses foreign `Host`/`Origin` headers, and requires a random per-launch token on every API, stream, download and upload request.
- The token never appears on a command line. The browser opens a private (`0600`) launch file that is deleted on first use.
- Every value that reaches Docker is validated, and commands run with argument lists, never through a shell.
- Changing engine state or the `docker` group goes through `pkexec`, so an administrator password is required.
- The host terminal is a real shell as the current user: anyone holding the token has your user's powers. Keep DockDesk off networked or shared machines.

The full model is in the README, and `npm run test:security` checks it.
