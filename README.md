# Final subtraction v2

This is the `codex/subtraction-v2` comparison branch. The active implementation lives in [src/index.ts](src/index.ts), with a consistent entry point across both variants.

This is the **measured subtraction-only** implementation. The nine mechanics tests are retained with their import adjusted for the branch layout. They do not reproduce the private live benchmark.

## Run this snapshot

Requires Node >=22.19.0 and Pi 0.85.1. Authenticate your own model.

```sh
git switch codex/subtraction-v2
npm ci --ignore-scripts
npm run check
npx pi --no-extensions -e ./src/index.ts
```

Omit the extension argument to use stock Pi. Neither implementation is recommended for everyday adoption.

## Compare

- [Other implementation](https://github.com/xCatG/pi-context-ext/tree/codex/organized-scored)
- [Direct snapshot diff](https://github.com/xCatG/pi-context-ext/compare/codex%2Forganized-scored..codex%2Fsubtraction-v2)
- [Main comparison guide and repaired preview](https://github.com/xCatG/pi-context-ext)
- [Original results](docs/experiment.md) and [subtraction results](docs/subtraction-v2.md)

These branches make code inspection convenient. The measurements used different cohorts and policies, so this diff is not a head-to-head efficacy comparison. The full source archive and reports remain alongside the active root source. SOURCE-PROVENANCE.json identifies the active snapshot. The repaired preview's tests were removed from this branch to avoid applying them to a different historical implementation; they remain on main.

MIT licensed. No raw traces, credentials, or model service are included.
