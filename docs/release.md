# Release checklist

Run one command before publishing:

```bash
npm run release:check
```

This runs `npm run check` (build + dry-run pack) and validates tarball contents against `scripts/release-check.mjs`.

## Pre-release verification

1. `npm run check` passes (TypeScript compiles, tests pass, pack dry-run succeeds)
2. `npm run release:check` passes (expected file list matches tarball)
3. No unintended files (source maps beyond expected set, test fixtures) leak into the tarball
4. `package.json` version is bumped
5. `CHANGELOG.md` has an entry for the new version

## Expected tarball files

`scripts/release-check.mjs` validates:

- `CHANGELOG.md`
- `LICENSE`
- `README.md`
- `dist/extensions/index.d.ts`
- `dist/extensions/index.js`
- `dist/extensions/index.js.map`
- `extensions/index.ts`
- `package.json`

`OPERATIONS.md` may also ship via `package.json` `files` but is not part of the strict expected list check.

## When to update docs

Update **CHANGELOG.md** for user-visible changes: new/changed commands, behavior fixes, breaking changes, or dependency bumps that affect runtime.

Update **README.md** when install/setup, command surface, or environment variables change. Route long-form detail to `docs/usage.md`, `docs/examples.md`, or this file instead of expanding README indefinitely.

## GitHub Actions flow

1. Merge a version bump to `main`.
2. **Auto Release** creates tag `vX.Y.Z` and a GitHub release, then triggers **Publish to npm**.
3. **Publish to npm** runs `npm run check` and publishes with npm Trusted Publishing (OIDC `id-token: write`).

Routine refactors, test-only changes, or internal tooling updates generally do not need a README or CHANGELOG update unless they change user-facing behavior.
