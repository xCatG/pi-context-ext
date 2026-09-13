# Experiment and stopping decision

Status: shelved on September 12, 2026. Use stock Pi for ordinary coding. This repository preserves an experimental extension, not an established improvement.

## Design

A used stock Pi. B used the same model, starting task snapshot and ordinary coding tools, with the organized-context extension. C was intended to use adaptive timing. Qualification exposed the pinned Pi overlapping-compaction race, so adaptive mode was deferred before becoming a supported arm and was never measured. Pi version was 0.85.1. Coding ran in isolated Docker tasks on a Windows host.

W1/W2 were two SWE-bench Verified issues (Astropy and Django). W3-W6 were four custom staged tasks on public repositories: revisit, preservation of an external change, diagnosis follow-up, and idle compaction plus same-session restart. This is a small purposively selected diagnostic suite, not a SWE-bench leaderboard result. One observation per model/task/arm cannot establish a general model ranking.

The primary cohort had 42 attempted assignments and six unavailable assignments. Separate Nemotron and Gemini cohorts added 12 and four attempts, respectively: 58 total attempts. Failures, controller interruptions and resource stops were retained. Trials were not rerun to improve frozen scores. Later repair diagnostics are a separate category.

## Primary results

| Model | Accepted A / B | A total tokens | B total tokens |
| --- | ---: | ---: | ---: |
| Local Qwen 3.8 27B | 2 / 1 | 3,343,126 | 7,818,335 |
| GPT-5.6 Sol | 4 / 1 | 1,011,611 | 1,248,984 |
| GPT-6 Astra | 5 / 3 | 675,766 | 831,992 |

Tokens include inclusive input and output across recorded coding/summary calls, including cached input. They are not dollar charges. Selection and retrieval work embedded in coding calls is included. Missing usage is not counted as zero. Aliases and local serving labels are the configured model identities, not immutable proofs of provider weights.

The predeclared promotion gate required no A-only regression, plus either at least two distinct continuity B-only wins within 125% of all-attempt tokens and time, or at least four both-success pairs with at least 15% token savings and no more than 110% time in the required all-assigned/both-success views. No primary model passed.

No primary model showed an unconfounded B-only completed-task benefit. Important qualifications:

- Sol B aborted at the extension admission gate in W2-W6. Sol W1 A was interrupted by the controller despite a correct retained patch. Its apparent B-only win is therefore not evidence of benefit.
- Astra W3 B and both W6 arms were rejected under an undisclosed auxiliary-filename restriction. Unchanged-patch diagnostics passed substantive checks, but frozen scores were not replaced. Astra W2 remains a clean regression: A passed 64/64 official checks, B 62/64.
- Qwen B had admission aborts in W2/W5. Both arms also made semantic and scope errors unrelated to proving memory retention.
- The DeepSeek route failed without useful model output and cannot inform efficacy. Nemotron accepted zero of six tasks per arm; B used about 5.7% fewer known logical tokens overall. Gemini accepted one of two A tasks and zero B tasks; several runs stopped before exposing the intended continuity condition.
- Qwen/Nemotron thinking was off with a 4,096-token output cap; GPT thinking was medium. Comparisons within a model were matched, but cross-model causal claims about reasoning or memory are not supported.
- W6 exercised a scheduled idle compaction/restart. W5's tentative diagnosis was already rejected before the follow-up in the primary runs, so it did not demonstrate reversal of an adopted mistaken diagnosis.

The admission defect treated serialized message bytes, including opaque provider metadata, as a conservative token bound. This could abort far below the real context limit. The root preview fixes diagnosed operational problems, but its subsequent passes on reused tasks do not establish a new A/B benefit.

Successful paid-provider usage reports totaled $0.571657215; conservative accounting including unknown failed-call holds was $2.729914 against a $5 ceiling. GPT subscription usage and local compute were unpriced, not economically free. These accounting totals are separate from logical-token totals.

## Offline pruning screen

A later isolated prototype tested deterministic duplicate-full-read removal on archived stock sessions. Only successful complete text reads with identical later content and exact path arguments were eligible; partial, failed and truncated reads were excluded. A 20K growth chunk and 20K protected recency policy produced zero replacements across 29 sessions and 1,668 prefixes. Of 196 native read results, 114 were eligible full reads and only 18 repeated exact complete content before recency filtering. Twenty-four sessions accumulated under 40K proxy tokens.

The counts used o200k_base over a visible-message JSON proxy, not provider request serialization or Qwen's tokenizer. Three assignments had no archived session directory. The live gate required two cells with at least 5% proxy savings and no invariant failures; it failed, so no live pruning calls followed. The prototype had documented witness/branch-fixture limitations and was not promoted into this extension.

## What is public and what is not

The root source is the repaired 0.2.0-preview.2 snapshot. `experiments/scored-prototype/` preserves the earlier source used in the original comparison. `results/aggregate.json` contains an allowlisted export of per-cell labels and resource totals, plus offline screening summaries. `scripts/verify-results.mjs` recomputes the primary table.

Raw sessions, provider payloads, credentials, local machine paths and task checkouts are not distributed. The private artifacts preserve those traces, but readers cannot independently reproduce all trace-level judgments from this public export. The full historical Docker benchmark runner is not included; the `eval/` folder contains the prototype's manifest/report helpers, not an executable reproduction of all 58 attempts. Source tests validate mechanics with scripted providers, not coding efficacy.

No further evaluation or research loop is planned. Reopen only for a concrete workload demonstrating a relevant failure and a new, bounded experiment.
