# Contributing to DockDesk

Thanks for your interest in contributing to DockDesk. Contributions are welcome, whether they improve the UI, add Docker workflows, fix bugs, improve accessibility, or clarify the documentation.

## Before you start

- Check the existing [issues](https://github.com/DocKDes/DockDesk/issues) and pull requests to avoid duplicating work.
- For substantial changes, open an issue first to discuss the proposed direction.
- Do not include credentials, tokens, private Docker registry data, or personal filesystem paths in commits, screenshots, or issue reports.
- For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development setup

DockDesk is a dependency-free Node.js application at runtime.

Requirements:

- Linux
- Node.js 18.17 or newer
- Docker Engine for API and integration tests
- Chromium or Chrome for UI tests

Clone the repository and run DockDesk from the checkout:

```sh
git clone https://github.com/DocKDes/DockDesk.git
cd DockDesk
./bin/dockdesk
```

The application talks to the local Docker Engine and does not bundle or install Docker.

## Making changes

1. Create a focused branch from `main`.
2. Make the smallest complete change that addresses the issue.
3. Follow the existing JavaScript style and reuse established helpers and UI patterns.
4. Update related documentation, translations, accessibility labels, or tests when behavior changes.
5. Keep commits focused and avoid unrelated formatting or generated-file changes.

The frontend is plain JavaScript under [`public/`](public/), and the server is in [`server.js`](server.js). There is no frontend build step.

## Testing and linting

Run the full test suite before opening a pull request:

```sh
npm test
npm run lint
```

Useful focused commands are:

```sh
npm run test:api
npm run test:ui
npm run test:security
npm run test:package
```

The tests create temporary Docker resources with names beginning with `ddtest-` and clean them up afterward. Do not run tests against an engine or Docker context where creating temporary resources is not permitted.

If a test cannot run locally, explain the reason in the pull request. Do not silently remove or weaken a test to make the suite pass.

## Pull requests

Please make pull requests against `main` and include:

- A clear summary of the problem and solution
- The user-visible behavior that changed
- Tests and lint commands run, including any skipped checks and why
- Screenshots or recordings for UI changes
- Notes about compatibility, migrations, or release considerations when applicable

Keep pull requests reviewable. Separate unrelated refactors, dependency updates, or cleanup into separate changes.

## Documentation and screenshots

Use relative links for repository files and keep documentation examples copyable. Store README screenshots in [`public/docs/screenshots/`](public/docs/screenshots/). Screenshots should use representative, non-sensitive data and must not expose tokens, credentials, private paths, or personal container names.

## License

By contributing to DockDesk, you agree that your contribution is provided under the project’s [MIT License](LICENSE).
