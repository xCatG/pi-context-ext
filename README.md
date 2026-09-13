# Pi context extension — a shelved experiment

An experimental organized-context extension for **Pi 0.85.1**. It retains attributed user constraints, source observations, interpretations and open work, with exact-history recall and restart recovery.

**The experiment did not establish a coding benefit over stock Pi.** It added cost, exposed implementation defects, and was shelved. Use stock Pi for ordinary work. This repository is a research artifact, not a performance recommendation.

- [Experiment, results and limitations](docs/experiment.md)
- [Blog draft](docs/blog-draft.md)
- [Extension usage and limitations](USAGE.md)
- [Public aggregate data](results/aggregate.json)

## Source versions

The root contains the repaired `0.2.0-preview.2` source. Later diagnostic passes on reused tasks validate repairs, not a new A/B coding advantage. The original scored source is preserved in [experiments/scored-prototype](experiments/scored-prototype). Do not attribute the original scores to the repaired preview.

The implementation uses a transient projection, `context_checkpoint` and `context_recall`. It is not the later pruning idea. The offline pruning screen failed its gate and was never promoted into the extension.

## Try locally

Requires Node >=22.19.0 and Pi 0.85.1.

```sh
npm ci --ignore-scripts
npx pi -e ./src/index.ts
```

Choose and authenticate your own model in Pi. This project contains no credentials or bundled model service. `/context` inspects state; `/context mode off` disables new extension effects while retaining existing history. Adaptive compaction is unavailable. See [USAGE.md](USAGE.md) before experimenting.

```sh
npm run check
node scripts/verify-results.mjs
```

Tests exercise mechanics with scripted providers. Public aggregates are arithmetically checkable. Raw model sessions and the complete historical benchmark environment are not distributed; this is not a fully reproducible public benchmark release.

## Project status and license

Shelved September 12, 2026. No ongoing research loop or support commitment. Published under the [MIT license](LICENSE). Dependencies retain their respective licenses. npm publication is disabled (`private: true`); public source availability does not require an npm release.

This project is independent of RAH and uses none of its repositories or services at runtime.
