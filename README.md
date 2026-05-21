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

## Install

```bash
npm install pi-soccer-widget
```

For local development:

```bash
pi -e ./extensions/index.ts
```

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

## Roadmap

- FIFA World Cup 2026 mode
- Better fuzzy matching for misspelled team names
- More data providers
