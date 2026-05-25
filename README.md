# pi-soccer-widget

Pi Coding Agent extension that shows a soccer widget above the prompt editor.

The widget prioritizes your favorite club, but can rotate to watchlist teams when the favorite has thin off-season data.

## Features

- Favorite team first
- Watchlist fallback for off-season periods
- Candidate search before adding teams, reducing typo mistakes
- Tab completion for subcommands and cached result numbers
- `/soccer setup` and `/soccer pick` guided flows
- 6-hour sync cache to reduce API requests
- Discovery fallback from one random league top-3 pool per sync
- One compact widget at a time
- Last result + next opponent focused display
- Optional standing summary on the first line
- Configurable league search scope

## Requirements

- [Pi Coding Agent](https://pi.dev/) installed
- Node.js >= 20
- A free API token from [football-data.org](https://www.football-data.org/client/register)

If you don't have Pi yet, install the CLI first:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
# or
curl -fsSL https://pi.dev/install.sh | sh
```

## Install

This is a Pi package, so install it with `pi install` (not plain `npm install`):

```bash
# from npm
pi install npm:pi-soccer-widget

# or from GitHub
pi install git:github.com/eiei114/pi-soccer-widget
```

By default `pi install` writes to your user settings (`~/.pi/agent/settings.json`).
Add `-l` to install into the current project (`.pi/settings.json`) instead.

In a running Pi session, run `/reload` to pick up the newly installed extension
(or start a new session). The `/soccer` command is then available.

Manage the package later with:

```bash
pi list                          # show installed packages
pi update npm:pi-soccer-widget   # update to the latest version
pi remove npm:pi-soccer-widget   # uninstall
```

### Local development

To hack on the extension from a checkout, load it directly for the current run:

```bash
pi -e ./extensions/index.ts
```

Or drop it into an auto-discovery path and hot-reload with `/reload`:

- `~/.pi/agent/extensions/` — global (all projects)
- `.pi/extensions/` — project-local

## API key setup

Get a token from football-data.org. Then run this inside Pi:

```text
/soccer setup
```

For API-key-only setup:

```text
/soccer login
```

The key is entered through Pi extension UI, not through the chat/model context.

Environment variable fallback is also supported:

```bash
FOOTBALL_DATA_API_TOKEN=your_api_token
```

## Optional environment

```bash
PI_SOCCER_TEAM="Real Madrid"
PI_SOCCER_REFRESH_MIN=15
PI_SOCCER_LEAGUES=PL,PD,SA,BL1,FL1,DED,PPL
```

Default league search scope:

- `PL` Premier League
- `PD` La Liga
- `SA` Serie A
- `BL1` Bundesliga
- `FL1` Ligue 1
- `DED` Eredivisie
- `PPL` Primeira Liga

## Commands

```text
/soccer                       refresh widget from cache
/soccer setup                 guided API key + favorite team setup
/soccer get-key               show signup link and API key instructions
/soccer login                 enter and store API key via Pi UI
/soccer status                show API key status without exposing it
/soccer logout                remove stored API key
/soccer sync                  force refresh cached data
/soccer pick                  search/select favorite with Pi UI
/soccer search arsenal        show candidate teams
/soccer add 1                 add candidate #1 to watchlist
/soccer favorite 1            set candidate #1 as favorite
/soccer list                  show watchlist
/soccer remove 2              remove watchlist item #2
/soccer Arsenal               shorthand: set favorite if unambiguous
```

## Widget behavior

When the favorite has both a recent result and an upcoming match, it is shown first.
When favorite data is thin, the widget can fall back to another watchlist team or a cached discovery team. Sync runs at most every 6 hours unless `/soccer sync` is used.

Example:

```text
Soccer: Arsenal | PL #2 | 71pts | favorite
Last: Arsenal 2-1 Chelsea  W
Next: vs Liverpool | 5/24 20:00
```

## Local files

The extension stores lightweight local state under `~/.pi/agent/`:

- `pi-soccer-widget-auth.json` - stored API key from `/soccer login`
- `pi-soccer-widget-config.json`
- `pi-soccer-widget-teams-cache.json`
- `pi-soccer-widget-search.json`
- `pi-soccer-widget-snapshots.json` - 6-hour cached match/standing snapshots

Legacy `soccer-team.json` is migrated automatically when present.

## Release checklist

Run a single command to verify everything before publishing:

```bash
npm run release:check
```

This runs `npm run check` (build + dry-run pack) then validates the tarball against the expected file list.

### What to verify before release

1. `npm run check` passes (TypeScript compiles, no errors)
2. `npm run release:check` passes (build + pack + file list validation)
3. Pack contents match the expected list in `scripts/release-check.mjs`
4. No unintended files (source maps, test fixtures) leak into the tarball
5. Version in `package.json` is bumped
6. `CHANGELOG.md` has an entry for the new version

### When to update README or CHANGELOG

Update **CHANGELOG.md** when the change is user-visible:
- New or changed commands or features
- Bug fixes that affect behavior
- Breaking changes or removed features
- Dependency bumps that change runtime behavior

Update **README.md** when:
- New commands or options are added
- Install or setup instructions change
- Environment variables or config format changes

Routine refactors, test additions, or internal tooling changes generally do not require either update.

## Maintenance

This package is maintained with a small, safety-first process. See [OPERATIONS.md](./OPERATIONS.md) for issue triage, release checks, security handling, and external API fallback policy.

## Roadmap

- FIFA World Cup 2026 mode
- Better fuzzy matching for misspelled team names
- More data providers
