# Changelog

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
