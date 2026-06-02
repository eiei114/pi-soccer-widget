# Usage

Detailed behavior for `pi-soccer-widget` beyond the README quick start.

## API key setup

Get a token from [football-data.org](https://www.football-data.org/client/register), then inside Pi:

```text
/soccer:setup
```

API-key-only path:

```text
/soccer:login
/soccer:status
/soccer:logout
```

`/soccer:status` reports whether a key is configured and its source (`env`, `file`, or none) without printing the key value.

Environment variable fallback:

```bash
FOOTBALL_DATA_API_TOKEN=your_api_token
```

When set, the environment variable takes priority over the saved auth file.

## Optional environment

```bash
PI_SOCCER_TEAM="Real Madrid"
PI_SOCCER_COUNTRY="Japan"
PI_SOCCER_REFRESH_MIN=15
PI_SOCCER_LEAGUES=PL,PD,SA,BL1,FL1,DED,PPL
```

Default league search scope:

| Code | League |
|------|--------|
| PL | Premier League |
| PD | La Liga |
| SA | Serie A |
| BL1 | Bundesliga |
| FL1 | Ligue 1 |
| DED | Eredivisie |
| PPL | Primeira Liga |

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

## World Cup mode

Run `/soccer:worldcup` to open the menu:

- Follow my country
- Today's matches — WC matches for the current local date
- Group table — followed-country group table
- Match detail — followed-country match facts/events outside the widget
- Top scorers — when football-data.org supports them, otherwise `not available`
- Settings — switch default widget between club mode and World Cup mode

First-run country selection order:

1. Existing saved World Cup config
2. `PI_SOCCER_COUNTRY`
3. Locale/timezone guess
4. Manual country search/select

Guessed countries require confirmation before saving. IP geolocation is not used.

World Cup uses football-data.org `WC` endpoints. `WC` is not part of the normal club league search/discovery list.

## Widget behavior

Club mode shows the favorite when both a recent result and upcoming match exist. When favorite data is thin, the widget can fall back to another watchlist team or a cached discovery team. Sync runs at most every 6 hours unless `/soccer:sync` is used.

World Cup widget mode is opt-in when a club watchlist already exists, and automatic when no club favorite exists. It stays compact: followed-country score/next kickoff, goal scorers when available, group rank, notable red-card/penalty/shootout context, today's top matches when the followed country is inactive, and a cache/sync hint. Matchday refresh uses a shorter ~10 minute cadence and does not claim second-by-second live precision.

## Local files

The extension stores lightweight local state under `~/.pi/agent/`:

- `pi-soccer-widget-auth.json` — stored API key from `/soccer:login`
- `pi-soccer-widget-config.json`
- `pi-soccer-widget-teams-cache.json`
- `pi-soccer-widget-snapshots.json` — 6-hour cached match/standing snapshots

`pi-soccer-widget-auth.json` contains secret material and is local-only. Do not commit it, paste it into issues, or include it in logs. Use `/soccer:logout` to remove the stored key.

World Cup followed country state lives in optional `worldCup` fields inside `pi-soccer-widget-config.json` and remains backward-compatible with existing club/watchlist config.

Legacy `soccer-team.json` is migrated automatically when present.

## Package management

```bash
pi list
pi update npm:pi-soccer-widget
pi remove npm:pi-soccer-widget
```

After installing or updating, run `/reload` in Pi or start a new session so `/soccer:*` commands register.
