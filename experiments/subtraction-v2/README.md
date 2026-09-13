# Subtraction-only experiment

This is the final, separately measured treatment. It does not load the root organized-context extension. It replaces only older successful full reads whose identical complete text remains in a later visible read. It protects 4K proxy tokens and advances in 8K chunks. Native tools, compaction timing, and raw session history remain unchanged.

Requires Node >=22.19.0 and Pi 0.85.1. From the repository root:

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix experiments/subtraction-v2
npm test --prefix experiments/subtraction-v2
npx pi --no-extensions -e ./experiments/subtraction-v2/extension.ts
```

Omit the extension argument to disable it. Do not load it alongside the root extension when comparing with this experiment. The nine Node tests cover deterministic pruning and integration mechanics; they do not reproduce the private live benchmark.

The tokenizer is pinned to `gpt-tokenizer` 4.0.0, using `o200k_base`. This is a visible-message JSON proxy, not a provider-token or billing guarantee. `SOURCE-PROVENANCE.json` records the original measured hashes and the public export's only source change: replacing the private tokenizer import with its package export. Test contents are unchanged; their filename keeps them separate from the root Vitest suite.

See [results and limitations](../../docs/subtraction-v2.md), the [frozen protocol](PROTOCOL.md), and [aggregate data](../../results/subtraction-v2.json). The private runner, model credentials, and raw traces are not included. This remains a research artifact, with no recommendation for everyday adoption.
