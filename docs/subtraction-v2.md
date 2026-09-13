# Final subtraction diagnostic — complete

The user reopened the project for one bounded final attempt. This is a new 8K/4K subtraction-only treatment, not a revision of the failed 20K/20K offline screen. The protocol is preserved in [the experiment directory](../experiments/subtraction-v2/PROTOCOL.md). Raw sessions, provider payloads, and the historical runner remain private; public totals are in [the aggregate export](../results/subtraction-v2.json). Ten cells were authorized; no parameter search or replacement attempts are planned.

## Qualification

Nine transform tests passed. Replay over 29 archived sessions found 90 affected prefixes. Baseline tests, native extension import, and Pi RPC load passed with zero inference calls. Independent launch review found no remaining blocking issue after fixing Docker mount placement, qualification identity, lifetime paid accounting, and natural-compaction exposure classification.

The new paid ceiling is $2; canonical prior conservative accounting is $2.729914, including unknown-call holds. Gemini can stop early because each call reserves its full native input capacity. GPT and local compute are unpriced. Requested Flash Lite alias was absent and was not substituted.

## Completed pairs

All ten assignments terminated in about 2h48m. There were 258 dispatched calls with known usage, four pre-dispatch budget denials, and no unknown-call holds. Two of five tasks passed per arm. This is one repeated known coding task per model, not five independent workloads or a statistically powered efficacy result.

| Model | A known total tokens | B known total tokens | Coding acceptance | B pruning requests |
|---|---:|---:|---|---:|
| Sol | 184,468 | 178,166 | Both accepted by tests and manual review | 10 |
| Luna | 241,975 | 213,994 | Both accepted by tests and manual review | 6 |
| Nemotron free | 584,560 | 140,767 | Both failed | 0 |
| Local Qwen | 873,458 | 749,705 | Both failed | 0 |
| Gemini Flash | 179,657 | 159,664 | Both budget-limited and incomplete | 0 |

Known totals include inclusive input and output from task and compaction calls. Reasoning is a subset of output and is not added twice. Lower totals on failed/incomplete pairs are not efficiency wins. All B pruning occurred in Sol/Luna; other B arms never transformed an outgoing request.

| Model | A uncached input | B uncached input | A/B calls | A/B wall seconds |
|---|---:|---:|---|---|
| Sol | 142,462 | 145,387 | 18 / 21 | 193 / 259 |
| Luna | 172,731 | 173,600 | 22 / 21 | 176 / 171 |
| Nemotron free | 105,806 | 50,878 | 46 / 14 | 393 / 379 |
| Local Qwen | 515,758 | 294,620 | 45 / 31 | 4,011 / 4,259 |
| Gemini Flash | 170,874 | 115,074 | 20 / 20 | 57 / 152 |

Sol B compacted manually and restarted with earlier tool history excluded. Sol A and both Luna arms restarted but Pi declined compaction for insufficient history. No natural pressure/recovery claim follows from those unexposed arms.

Same-trajectory replay estimates direct subtraction at 3,560 `o200k_base` proxy tokens (1.80% of decision input) for Sol B and 10,446 (3.99%) for Luna B. Observed run-total changes of -3.42% and -11.56% are not causal estimates: trajectories differ, and the provider-reported input decrease consists of fewer cached tokens while uncached input increased (Sol +2,925; Luna +869). The proxy excludes provider/system/tool wrappers and is not a billable-token measurement.

Both Nemotron patches failed. A exhausted its continuation-call limit and independently left disallowed source, missing tests/build, and unpackaged export targets. B ended normally but omitted tests and package/build/docs integration; its initial stage emitted malformed literal tool-call text. Successful lifecycle events do not establish successful task continuity.

Qwen B finished normally after about 71 minutes with substantively complete runtime/build/docs work, but added two explicitly disallowed declaration files. Its compaction summary retained the allowed paths; the model then mistakenly reasoned that the restriction no longer applied. This is a concrete retained-constraint interpretation failure, not evidence of missing context. Qwen A spent about 67 minutes before its initial-stage request cap, never reached handoff, and left a failing test expecting one rather than two spaces from joining a whitespace string with `x`. Both used reported reasoning: A 14,772 and B 22,649 tokens, included within output. The local server reports these in top-level `reasoning_tokens`; the analysis script was corrected to read that field. No run configuration changed.

Gemini A had valid source/tests passing 36/36 and B had valid source/tests passing 37/37, but both continued calling tools until their monetary admission limits. Neither completed the initial stage or reached integration. Both Gemini cells were stopped by the conservative full-native-context reservation, not their actual cumulative usage reaching $1. Their failed/incomplete totals cannot be compared as savings.

There were three manual compactions (Sol B, Nemotron A, Qwen B), all with earlier tool history excluded and verified same-session restart. No natural context-limit compaction occurred. Sol A, both Luna arms, and Nemotron B restarted without compaction. Qwen A and both Gemini arms stopped before handoff. Lifecycle success is distinct from correct task completion.

New conservative paid usage/holds totaled $0.317547, with no pending or unknown calls. Combined with the frozen prior $2.729914, lifetime conservative accounting is $3.047461, below the authorized $5. New provider-reported cost was $0.29568675; provider reports are not invoices. Unused allowances were not spent or transferred. Raw ledgers and requests remain private.

## Decision

Keep this as an experimental subtraction prototype; do not recommend everyday adoption. The frozen diagnostic's numerical signal condition was met by Luna (both accepted, exposed B, 11.56% lower inclusive total, no B-only correctness regression across the run), so it permits a future proposal. It does not require further experiments or establish causality. Direct replay, increased uncached input, and trajectory/cache differences substantially weaken that signal. Sol missed the 10% threshold and was slower. The weaker-model failures provide no subtraction comparison because their B requests were unchanged.

This attempt establishes that a small subtraction-only hook can remove duplicate text and preserve correct GPT patches on this task. It does not establish better coding success, reduced uncached cost, natural-pressure benefit, or general continuity improvement. Stop after these ten cells, preserve the negative and incomplete results, and keep the research shelved unless a concrete pressure-heavy production case motivates a separate proposal.
