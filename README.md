# pi-soccer-widget

[![CI](https://github.com/eiei114/pi-soccer-widget/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-soccer-widget/actions/workflows/ci.yml)
[![Publish to npm](https://github.com/eiei114/pi-soccer-widget/actions/workflows/publish.yml/badge.svg)](https://github.com/eiei114/pi-soccer-widget/actions/workflows/publish.yml)
[![Auto Release](https://github.com/eiei114/pi-soccer-widget/actions/workflows/auto-release.yml/badge.svg)](https://github.com/eiei114/pi-soccer-widget/actions/workflows/auto-release.yml)
[![npm version](https://img.shields.io/npm/v/pi-soccer-widget)](https://www.npmjs.com/package/pi-soccer-widget)
[![npm downloads](https://img.shields.io/npm/dm/pi-soccer-widget)](https://www.npmjs.com/package/pi-soccer-widget)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/Pi-package-blue)](https://pi.dev/)
[![Trusted Publishing](https://img.shields.io/badge/npm-Trusted%20Publishing-CB3837)](https://docs.npmjs.com/trusted-publishers)
<a href="https://buymeacoffee.com/ekawano114m"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="217" height="60"></a>

Pi extension that shows a compact soccer widget above the prompt editor for your favorite club and World Cup follow.

## What this is

`pi-soccer-widget` is a [Pi Coding Agent](https://pi.dev/) package. It registers `/soccer:*` commands, stores lightweight local config under `~/.pi/agent/`, and renders one widget line focused on recent results, the next opponent, and optional standings. Club mode prioritizes your favorite team and can fall back to watchlist or discovery teams during thin off-season data. World Cup mode adds followed-country menus and matchday-oriented refresh.

## Features

- Favorite club first, with watchlist and discovery fallback
- Candidate search before adding teams to reduce typos
- `/soccer:setup` guided API key and favorite-team setup
- `/soccer:worldcup` menu plus first-run followed-country setup
- 6-hour sync cache with optional `/soccer:sync`
- One compact widget at a time
- Configurable league search scope via `PI_SOCCER_LEAGUES`
- Optional `pi-widget-core` provider support for `pi-widget-host` display switching

## Install

This is a Pi package. Install with `pi install`, not plain `npm install`:

```bash
pi install npm:pi-soccer-widget
# or
pi install git:github.com/eiei114/pi-soccer-widget
```

By default `pi install` writes to `~/.pi/agent/settings.json`. Add `-l` to install into the current project (`.pi/settings.json`).

Requirements:

- Pi Coding Agent CLI
- Node.js >= 20
- A free token from [football-data.org](https://www.football-data.org/client/register)

If Pi is not installed yet:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
# or
curl -fsSL https://pi.dev/install.sh | sh
```

## Quick start

1. Install the package with `pi install npm:pi-soccer-widget`.
2. Start or reload Pi (`/reload` in an existing session).
3. Run `/soccer:setup` to store your football-data.org API key and pick a favorite team.
4. Confirm setup with `/soccer:status` (shows source only, never the key value).

Optional environment fallback:

```bash
FOOTBALL_DATA_API_TOKEN=your_api_token
```

## Usage summary

Canonical commands (11 total):

```text
/soccer:setup
/soccer:login
/soccer:status
/soccer:logout
/soccer:sync
/soccer:search <name>
/soccer:add [name]
/soccer:favorite [name]
/soccer:list
/soccer:remove [name]
/soccer:worldcup
```

Omit the team name on `/soccer:add`, `/soccer:favorite`, or `/soccer:remove` to open a Pi UI picker. Pass a team name for fuzzy match; numeric IDs and cached search indexes are not supported.

For World Cup menus, widget behavior, environment variables, and local file layout, see [docs/usage.md](./docs/usage.md). For sample widget output, see [docs/examples.md](./docs/examples.md).

## Optional Widget Host support

`pi-soccer-widget` is also a `pi-widget-core` provider. If `pi-widget-host` is installed and active in the same Pi process, Soccer publishes its rendered club/World Cup lines under provider id `pi-soccer-widget` with sports metadata and TTL. Host can select those lines for display, while Soccer suppresses its own standalone top-level widget to avoid duplicates.

This support is optional: `pi-soccer-widget` does not depend on `pi-widget-host`, and standalone widget rendering resumes automatically when Host presence is not active.

## Package contents

Published npm tarball includes:

- `extensions/index.ts` and compiled `dist/extensions/*`
- `README.md`, `CHANGELOG.md`, `LICENSE`
- `OPERATIONS.md` (maintainer operations guide)

Runtime state is written locally under `~/.pi/agent/` (config, auth, cache, snapshots). See [docs/usage.md](./docs/usage.md#local-files).

## Development

```bash
npm install
npm test          # build + node:test suite
npm run check     # test + pack dry-run
npm run release:check
```

Load a checkout directly:

```bash
pi -e ./extensions/index.ts
```

Or place the extension under `~/.pi/agent/extensions/` or `.pi/extensions/` and run `/reload`.

## Release

Releases use GitHub Actions:

- **Auto Release** (`auto-release.yml`) tags `v*` when `package.json` version changes on `main`.
- **Publish to npm** (`publish.yml`) runs `npm run check`, then publishes with npm Trusted Publishing (OIDC).

Before merging a release bump, run:

```bash
npm run release:check
```

Maintainer checklist and tarball expectations: [docs/release.md](./docs/release.md).

## Security

API keys are entered through Pi extension UI (`/soccer:login`), stored locally at `~/.pi/agent/pi-soccer-widget-auth.json`, and never sent to the model. `FOOTBALL_DATA_API_TOKEN` overrides the saved file when set. Report security issues privately; see [SECURITY.md](./SECURITY.md).

## Links

- npm: https://www.npmjs.com/package/pi-soccer-widget
- Issues: https://github.com/eiei114/pi-soccer-widget/issues
- Usage details: [docs/usage.md](./docs/usage.md)
- Examples: [docs/examples.md](./docs/examples.md)
- Release checklist: [docs/release.md](./docs/release.md)
- Maintainer operations: [OPERATIONS.md](./OPERATIONS.md)

## License

MIT. See [LICENSE](./LICENSE).
