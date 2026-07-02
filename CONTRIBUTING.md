# Contributing to pi-soccer-widget

Thank you for your interest in contributing! This document covers the workflow and guidelines for this project.

## Getting started

1. Fork the repository.
2. Clone your fork.
3. Install dependencies: `npm install`
4. Create a feature branch: `git checkout -b your-feature`

## Development workflow

```bash
npm install
npm test          # build + run node:test suite
npm run check     # test + pack dry-run
npm run ci        # typecheck + test + release check
npm run typecheck # TypeScript type checking only
```

Load a local checkout in Pi:

```bash
pi -e ./extensions/index.ts
```

Then in the Pi session:

```text
/reload
/soccer:status
```

## What to contribute

The project welcomes:

- Bug fixes with regression tests
- New feature ideas from issues
- Documentation improvements
- Additional test coverage

Before starting a larger feature, open an issue to discuss the design.

## Pull request guidelines

1. Keep changes focused — avoid mixing UI, data fetching, and docs changes in one PR.
2. Every PR must pass `npm run check`.
3. Add or update tests for new functionality.
4. Update `README.md` and `CHANGELOG.md` for user-facing changes.
5. Do not commit API keys, auth files, or local cache data.

## Release process

See [docs/release.md](./docs/release.md) for the maintainer checklist.

## Code of Conduct

Please note that this project is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you agree to uphold its terms.
