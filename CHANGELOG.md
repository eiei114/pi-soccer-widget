# Changelog

## 1.1.0 - 2026-06-28

### Added

- Added optional `pi-widget-core` provider integration so `pi-widget-host` can discover Soccer rendered lines through the shared provider registry.
- Added Host-aware display switching: Soccer suppresses its standalone top-level widget while Host is active and restores it when Host presence disappears.
- Published sports metadata (`sports` + `matchday`/`idle`, priority, TTL, updated time, mode) alongside club and World Cup rendered state.

### Changed

- Added `npm run ci` for the project acceptance check path.

## 1.0.1 - 2026-06-03

### Changed

- Restructured README to Pi OSS minimal-docs entrypoints (badges, quick start, usage summary, release/security links).
- Added `docs/usage.md`, `docs/examples.md`, and `docs/release.md` for detailed user and maintainer docs.
- Updated `SECURITY.md` command examples to canonical `/soccer:*` names.

## 1.0.0 - 2026-06-02

### Breaking changes

- Command surface is now 11 canonical `/soccer:*` commands only.
- Removed legacy `/soccer` space-separated subcommands, aliases (`soccer:wc`, `soccer:fav`, `soccer:rm`, `soccer:get-key`, `soccer:pick`), team shorthand (`/soccer Arsenal`), and numeric/cache-index team selection.
- `/soccer:add`, `/soccer:favorite`, and `/soccer:remove` without arguments open a Pi UI picker; pass a team name for fuzzy match instead of a number.
- Removed search-result cache file (`pi-soccer-widget-search.json`) and tab completion for cached numeric picks.

## Unreleased

### Changed

- Bumped `@earendil-works/pi-ai` from 0.78.0 to 0.80.3.
- Bumped `@types/node` from 25.9.1 to 26.1.0.
- Bumped GitHub Actions `actions/checkout` from v4/v6 to v7 and `actions/setup-node` from v4 to v6.

- Removed `/soccer:champions`, `/soccer:ucl`, and `/ucl:prediction-ai` commands after the Champions League final event window to simplify widget refresh behavior.

## 0.4.0 - 2026-05-30

- Added `/soccer:champions` and `/soccer:ucl` for a Champions League final matchday widget with football-data.org `CL` data when configured and a screenshotable scheduled fallback.
- Added forced Champions final display and adaptive refresh cadence for scheduled, live, paused, finished, and rate-limited match states.
- Added `/ucl:prediction-ai` for a post-ready user-vs-AI prediction flow: enter your score, provide a method prompt, let the active Pi model analyze matchup factors and choose a score, then open X compose with the comparison, basis, provider, and model metadata.

## 0.3.1 - 2026-05-30

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
