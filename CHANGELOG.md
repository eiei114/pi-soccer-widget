# Changelog

## Unreleased

- Fixed automatic widget refresh timers to stop on Pi session shutdown/reload, preventing stale extension context crashes after session replacement.

## 0.3.0 - 2026-05-29

- Added `/soccer:worldcup` and `/soccer:wc` World Cup menu entry points.
- Added first-run followed country setup with environment/locale guesses, confirmation, manual search, and backward-compatible config persistence.
- Added World Cup data views for today's matches, followed-country group table, match detail, and top scorers with graceful fallbacks.
- Added optional World Cup default widget rendering with matchday-oriented refresh hints, goal/event strips, and group-rank context.
- Fixed World Cup widget mode changes to reset the automatic refresh cadence immediately.

## 0.2.0 - 2026-05-29

- Added top-level `/soccer:*` command aliases such as `/soccer:status`, `/soccer:setup`, and `/soccer:search` while keeping `/soccer status` compatibility.

## 0.1.2 - 2026-05-28

- Added `npm run release:check` script for one-command pre-release validation.
- Added pack file list validation against an expected manifest.
- Documented release checklist, pack verification steps, and README/CHANGELOG update criteria in README.
- Added an issue acceptance-criteria template and clarified priority (high/medium/low) judgment in OPERATIONS.
- Added regression coverage to keep `/soccer status` from exposing saved or environment API keys.
- Documented local API key storage and secret-safe issue/log handling in README and OPERATIONS.

## 0.1.1

### Changed
- Updated README with Pi extension install method.
- Restored operations guide documentation.
- Set public npm publish config.
- Added package publish CI workflow.

## 0.1.0

- Initial Pi soccer widget package scaffold.
- Added favorite team + watchlist config.
- Added candidate search flow for typo-resistant team selection.
- Added `/soccer search/add/favorite/list/remove` commands.
- Focused widget display on last result and next opponent.
- Added off-season fallback from favorite team to watchlist teams.
- Added `PI_SOCCER_LEAGUES` support.
- Added `/soccer login/status/logout` for Pi-UI API key setup without sending keys to the model.
- Added `/soccer setup`, `/soccer pick`, `/soccer get-key`, and `/soccer sync`.
- Added Tab completion for soccer subcommands and cached numeric selections.
- Added 6-hour snapshot cache plus watchlist/discovery sync to reduce API requests.
