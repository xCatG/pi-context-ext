# Final subtraction diagnostic, v2

User explicitly reopened the shelved project for one final bounded subtraction experiment. This is a new diagnostic version, not a revision of prior results or a reversal of their no-go decisions. This is the pre-run protocol, preserved after completion; see the final report for outcomes.

## Treatment and model scope

A: stock Pi 0.85.1. B: only the subtraction context hook, with no old extension, memory tools, guidance, task card, admission gate, persistent records or custom summary. Successful native full text reads with a later identical complete read may be stubbed; partial/truncated/error reads, changed historical content, bash output, user messages and assistant messages stay untouched. Preserve role/call pairing. Chunk 8K and protected recency 4K, fixed before replay and live outcomes. This intentionally differs from the failed 20K/20K v1; it is not tuning v1's claimed result.

One W6 coding/continuity task, each arm, on Sol, Luna, free Nemotron, local Qwen, and optionally Gemini Flash: ten cells maximum. Fresh independent snapshots; original behavior tests; exact allowed edit paths disclosed identically to both arms to remove the earlier hidden filename restriction. Qualified offline test tooling and a short cwd/test-command environment card are identical in A/B. This is a repeated known diagnostic, not held-out efficacy evidence.

All profiles use a 64,000-token declared window and native 16,384 reserve tokens. W6 retains its controlled idle compaction/restart and 4,096 recent-token setting in both arms. This combines a smaller-window condition with the existing explicit handoff; natural and manual compactions must be counted separately. Do not pad history or demand equal compaction counts. A model's server-native window is not reduced: the declared window controls Pi policy. Transport reserves the full native input ceiling (GPT272000, Qwen262144, Nemotron1000000, Gemini1048576), because the smaller declaration is not provider-enforced. Observe actual request/summary sizes and preserve overflow failures.

Thinking is medium in all models. Qwen's template flag is binary, not proof of a server-side medium reasoning budget. Qwen/Nemotron/Gemini output allowance is 16,384. Codex ignores client output caps, so Sol/Luna retain full native 128,000-token output reservations; do not claim a matched 16K GPT ceiling. Comparisons are within-model. Cross-model rankings are not an inference target.

Verified identifiers on 2026-09-12: gpt-5.6-sol, gpt-5.6-luna, qwen3.8-27b-sglang, nvidia/nemotron-3.5-lightning:free, google/gemini-3.8-flash. The requested gemini-flash-lite-latest was absent from the OpenRouter catalog and is omitted without substitution. Nemotron pinned to nvidia/nvfp4, zero prices and no fallback. Gemini pinned to google-ai-studio, at most $0.75/M input and $3.75/M output, no fallback.

## Qualification and limits

First pass synthetic transform tests, branch/restart/compaction fixtures, and offline stock transcript replay. Report opportunities and savings; do not tune thresholds after replay. Require at least one actual replacement in a real archived session to establish exposure potential, plus no synthetic invariant failure, before live execution. This new diagnostic gate intentionally does not claim v1's two-cell 5% promotion threshold passed. Native Docker extension load and unchanged baseline-test availability must qualify without inference.

Ten cells max, 80 requests and 3M inclusive tokens per cell; aggregate 800 requests / 30M tokens / 12 hours. Keep original stage allocation 45 initial + 10 compaction + 25 continuation requests. Qwen: 30-minute requests and four-hour task allowance. Others: five-minute requests and one-hour tasks. No automatic retries or replacement runs. Route outage skips remaining assignments for that route. Unknown failed-call holds remain charged conservatively.

Gemini: $1 per cell and $2 aggregate new paid exposure. Prior conservative OpenRouter accounting was $2.729914; this run must keep the lifetime total below $5. No other paid model or provider fallback. A single Gemini full-native reservation is $0.847872 at these price caps, so its $1-per-cell limit can stop further requests after roughly $0.152128 of settled usage. Optional Gemini cells may be unstarted or incomplete when the monetary gate binds; those are not efficiency wins. GPT subscription and local compute remain unpriced, not free in an economic comparison.

## Outcomes and stop decision

Record executable acceptance, manual scope review, completed stages, actual compaction/restart exposure, inclusive/cached/uncached input, output/reasoning where available, failed calls, truncations, wall time, tool errors, and pruning exposure reconstructed from raw session histories. Raw sessions remain untouched by the subtraction extension; harness telemetry lives outside session JSONL.

No-claim result if B never prunes in live requests. Any B-only correctness failure blocks adoption on this diagnostic. A promising result requires at least one exposed both-success pair with >=10% total inclusive token savings and no observed B-only correctness regression in operationally complete pairs. Aborted pairs cannot establish savings. This tiny selected run can motivate a future proposal but cannot promote the extension as generally beneficial. Stop after the frozen cells; no task/model/parameter expansion in this attempt.


The v2 offline proxy includes native compaction/branch-summary text and bash-execution fields; v1 omitted those special-role fields. Therefore v1/v2 proxy totals are not directly interchangeable. Boundaries are derived from current visible context; compaction starts a new epoch.
