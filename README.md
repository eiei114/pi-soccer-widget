# pi-soccer-widget

Pi Coding Agent extension that shows a soccer widget above the prompt editor.

The widget prioritizes your favorite club, but can rotate to watchlist teams when the favorite has thin off-season data.

## Features

- Favorite team first
- Watchlist fallback for off-season periods
- Candidate search before adding teams, reducing typo mistakes
- `/soccer:setup` guided API key + favorite team setup
- `/soccer:worldcup` World Cup menu + followed country setup
- 6-hour sync cache to reduce API requests
- Discovery fallback from one random league top-3 pool per sync
- One compact widget at a time
- Last result + next opponent focused display
- Optional standing summary on the first line
- Configurable league search scope

## Requirements

- [Pi Coding Agent](https://pi.dev/) installed
- Node.js >= 20
- A free API token from [football-data.org](https://www.football-data.org/client/register) for live-ish score/status updates.

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
(or start a new session). The `/soccer:*` commands are then available.

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

- `~/.pi/agent/extensions/` - global (all projects)
- `.pi/extensions/` - project-local

## API key setup

Get a token from football-data.org. Then run this inside Pi:

```text
/soccer:setup
```

Check whether Pi sees your API key without exposing the key value:

```text
/soccer:status
```

For API-key-only setup:

```text
/soccer:login
```

The key is entered through Pi extension UI, not through the chat/model context.

Environment variable fallback is also supported:

```bash
FOOTBALL_DATA_API_TOKEN=your_api_token
```

## Optional environment

```bash
PI_SOCCER_TEAM="Real Madrid"
PI_SOCCER_COUNTRY="Japan"
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

Only colon-form commands are supported:

```text
/soccer:setup                 guided API key + favorite team setup
/soccer:login                 enter and store API key via Pi UI
/soccer:status                show API key status without exposing it
/soccer:logout                remove stored API key
/soccer:sync                  force refresh cached data
/soccer:search <name>         search teams by name (name required)
/soccer:add [name]            add a team to the watchlist (omit name to pick in UI)
/soccer:favorite [name]       set favorite team (omit name to pick in UI)
/soccer:list                  show watchlist
/soccer:remove [name]         remove a watchlist team (omit name to pick in UI)
/soccer:worldcup              open World Cup menu or first-run country setup
```

Run `/soccer:add`, `/soccer:favorite`, or `/soccer:remove` without arguments to pick from a Pi UI list. Team names can be passed directly (fuzzy match); numeric IDs and cached search result numbers are not supported.

## World Cup mode

Run `/soccer:worldcup` to open the World Cup menu:

- Follow my country
- Today's matches - WC matches for the current local date
- Group table - followed-country group table; does not assume the first table is the right group
- Match detail - followed-country match facts/events without cramming them into the widget
- Top scorers - WC scorers when football-data.org supports them, otherwise `not available`
- Settings - switch the default widget between club mode and World Cup mode

On first run, the extension picks a followed country in this order:

1. Existing saved World Cup config
2. `PI_SOCCER_COUNTRY`
3. Locale/timezone guess
4. Manual country search/select

Guessed countries always require confirmation before saving. IP geolocation is not used.

World Cup uses football-data.org `WC` endpoints for teams, matches, standings, and scorers where available. `WC` is not included in the normal club league search/discovery list.

## Widget behavior

When the favorite has both a recent result and an upcoming match, it is shown first.
When favorite data is thin, the widget can fall back to another watchlist team or a cached discovery team. Sync runs at most every 6 hours unless `/soccer:sync` is used.

World Cup widget mode is opt-in when you already have a club watchlist, and automatic when no club favorite exists. It stays compact: followed-country score/next kickoff, goal scorers when available, group rank, notable red-card/penalty/shootout context, today's top matches when the followed country is inactive, and a cache/sync hint. Matchday refresh uses a shorter ~10 minute cadence and does not claim second-by-second live precision.

Example:

```text
Soccer: Arsenal | PL #2 | 71pts | favorite
Last: Arsenal 2-1 Chelsea  W
Next: vs Liverpool | 5/24 20:00
```

## Local files

The extension stores lightweight local state under `~/.pi/agent/`:

- `pi-soccer-widget-auth.json` - stored API key from `/soccer:login`
- `pi-soccer-widget-config.json`
- `pi-soccer-widget-teams-cache.json`
- `pi-soccer-widget-snapshots.json` - 6-hour cached match/standing snapshots

`pi-soccer-widget-auth.json` contains secret material and is local-only. Do not commit it, paste it into issues, or include it in logs. Use `/soccer:logout` to remove the stored key. If `FOOTBALL_DATA_API_TOKEN` is set, it takes priority over this file, and `/soccer:status` reports only the source, never the key value.

World Cup followed country state is stored in optional `worldCup` fields inside `pi-soccer-widget-config.json` and remains backward-compatible with existing club/watchlist config.

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
