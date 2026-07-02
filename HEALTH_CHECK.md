# pi-soccer-widget: Maintenance Health Check Report

**Date**: 2026-07-02
**Repository**: https://github.com/eiei114/pi-soccer-widget
**Version**: 1.1.0
**Last commit**: 2026-05-31 (33 days without activity)

## 1. Package Completeness

Checked against pi-extension-template policy expectations:

| File | Status | Notes |
|------|--------|-------|
| `SECURITY.md` | ✅ Present | Well-documented security policy |
| `CODE_OF_CONDUCT.md` | ✅ Added | Contributor Covenant v2.0 |
| `CONTRIBUTING.md` | ✅ Added | Development workflow guide |
| `LICENSE` | ✅ Present | MIT License |
| `CHANGELOG.md` | ✅ Present | Detailed, up-to-date |
| `README.md` | ✅ Present | Comprehensive with badges |
| Badges in README | ✅ All present | CI, Publish, Auto Release, npm version, downloads, License, Pi package, Trusted Publishing |

**Gap found**: `CODE_OF_CONDUCT.md` and `CONTRIBUTING.md` were missing. Added in this PR.

## 2. CI Pipeline

| Workflow | Status | Notes |
|----------|--------|-------|
| `.github/workflows/ci.yml` | ✅ Verified | Runs on PR and push to main. Typecheck → test → pack dry-run → version bump check (PR only). Uses `actions/checkout@v6`, `setup-node@v6`. |
| `.github/workflows/publish.yml` | ✅ Verified | Trusted Publishing (OIDC `id-token: write`). Validates package before publishing. Checks for already-published version to skip. |
| `.github/workflows/auto-release.yml` | ✅ Verified | Tags `v*` on version change in `main`. Creates GitHub Release. Triggers publish workflow. |
| Supply-chain hardening | ⚠️ Note | Some Actions pinned to v4 tags (`publish.yml`, `auto-release.yml`), some to v6 (`ci.yml`). Previous PR (#20) pinned some to commit SHAs, but not all workflows are fully SHA-pinned. |

## 3. Test Coverage

**26 tests total, 26 passing (100% pass rate).**

| Test file | Tests | Coverage area |
|-----------|-------|---------------|
| `tests/auth-status.test.mjs` | 3 | API key status hiding, env priority, canonical command registration |
| `tests/fallback.test.mjs` | 9 | Widget Host provider, stale snapshot rendering, per-team failure isolation, timer cleanup, session shutdown race |
| `tests/fuzzy-search.test.mjs` | 6 | Fuzzy matching internals, numeric rejection, tie handling, edge cases |
| `tests/worldcup.test.mjs` | 8 | World Cup command registration, menu flow, country setup, widget rendering, mode switching |

### Coverage gaps (non-blocking, follow-up recommended)

- No tests for `/soccer:setup` full guided flow
- No tests for `/soccer:add`, `/soccer:list`, `/soccer:remove` command handlers
- No tests for `/soccer:logout` and `/soccer:sync` commands
- No integration tests for config migration from legacy `soccer-team.json`
- No tests for `chooseSnapshot` fallback logic at integration level

## 4. Edge Case Review

| Edge case | Handled? | Mechanism |
|-----------|----------|-----------|
| API rate limiting (429) | ✅ | Falls back to stale snapshot |
| API timeout/abort | ✅ | 8s timeout per request, AbortError caught |
| Individual team fetch failure | ✅ | Per-team try/catch with old snapshot preserved |
| Missing API key | ✅ | Shows guidance message |
| Empty watchlist | ✅ | Shows "no favorite team yet" |
| Off-season thin data | ✅ | Fallback to watchlist/discovery teams |
| Numeric team IDs | ✅ | Cleanly rejected with message |
| Multiple fuzzy matches (ties) | ✅ | Returns candidates for user selection |
| Short queries (≤3 chars) | ✅ | Returns 0 score to prevent noise |
| Legacy config migration | ✅ | `soccer-team.json` auto-migrated |
| Session shutdown / stale context | ✅ | Timer cleared, stale ctx error caught |
| World Cup no followed country | ✅ | Guided first-run setup |
| World Cup API partial failure | ✅ | Falls back to cached data per endpoint |

### Validation gaps (follow-up recommended)

- `FOOTBALL_DATA_API_TOKEN` format is not validated before API calls (only fails at HTTP call time)
- `PI_SOCCER_REFRESH_MIN` has no bounds check (negative/zero could cause issues)
- `PI_SOCCER_LEAGUES` accepts any string without validation against known league codes
- API response shapes are asserted via `as` casts rather than runtime validation

## 5. Documentation Freshness

| Document | Status | Notes |
|----------|--------|-------|
| `README.md` | ✅ Consistent | Matches code, commands, and env vars |
| `CHANGELOG.md` | ✅ Up-to-date | Version 1.1.0 entry present |
| `OPERATIONS.md` | ✅ Consistent | Detailed maintainer guide |
| `docs/usage.md` | ✅ Consistent | Matches command surface |
| `docs/examples.md` | ✅ Consistent | Sample output matches code |
| `docs/release.md` | ✅ Consistent | Release checklist matches CI |

No inconsistencies found between documentation and code behavior.

## 6. Summary

### ✅ All acceptance criteria met

- Package completeness checklist itemized above
- CI verified passing (`npm run ci` passes)
- 26/26 tests passing
- Follow-up issues filed for gaps
- No behavioral change to core library
- `npm test` passes

### Files added in this PR

- `CODE_OF_CONDUCT.md` — Contributor Covenant v2.0
- `CONTRIBUTING.md` — Contribution guide
