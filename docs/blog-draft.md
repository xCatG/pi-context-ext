---
title: "I Built a Memory System for a Coding Agent. It Used More Tokens and Didn't Earn Its Keep."
slug: "2026-09-pi-context-experiment"
date: 2026-09-12T00:00:00-07:00
draft: true
tags: [programming, genai, experiments, coding-agents]
categories: [programming, genai]
---

## The idea sounded reasonable

Coding agents lose track of things. A constraint from the first message gets
buried under test output. A diagnosis gets repeated until it sounds like a fact.
After compaction, the agent remembers that it read a file but no longer has the
exact text it needs to edit.

I wanted to see whether explicitly organizing that context would help. This was
a standalone experiment using [Pi](https://pi.dev/), with Codex doing the
implementation and measurement and Claude helping challenge the design and
interpret the results. It wasn't meant to become another agent framework.

The extension separated user instructions, source observations, model
interpretations, and unfinished work. It could retrieve exact historical text,
record corrections, and reconstruct its state after a session restart. Pi kept
its normal coding tools.

Then we measured it.

For local Qwen, the organized version used **2.34 times as many tokens** and
completed fewer accepted patches. My reaction in the conversation was:

> So it's using more tokens but not achieving anything? Rofl

That turned out to be the question the project needed.

## What we actually compared

The comparison was stock Pi against Pi with the extension. Same model within
each pair, same starting repository snapshot, and matched ordinary coding tools
and resource caps. B additionally had the context tools, projection and guidance;
those additions were the treatment being tested.

The six workloads included two SWE-bench Verified issues and four staged coding
tasks: revisit earlier work, preserve an external change, handle a diagnosis
follow-up, and continue after compaction and restart. This was a small diagnostic
suite, not a SWE-bench leaderboard run. Each model/task/arm combination got one
observation, so these numbers do not deserve population-level conclusions.

I also wanted to test adaptive compaction timing. Qualification exposed an overlapping-compaction problem in the pinned Pi
version, so adaptive mode was deferred before becoming a supported arm. It was
never measured in the efficacy comparison.

The core results looked like this:

| Model | Stock accepted | Organized accepted | Stock tokens | Organized tokens |
| --- | ---: | ---: | ---: | ---: |
| Qwen 3.8 27B, local | 2/6 | 1/6 | 3.34M | 7.82M |
| GPT-5.6 Sol | 4/6 | 1/6 | 1.01M | 1.25M |
| GPT-6 Astra | 5/6 | 3/6 | 0.68M | 0.83M |

Those are inclusive input-plus-output tokens, including cached input, not dollar
charges. Model names are the configured aliases used in the runs.

There are substantial qualifications attached to that table. Sol's experimental
runs mostly hit a bug in our extension's admission gate. Its one apparent win
was against a stock run interrupted by the controller despite a correct patch.
Several Astra rejections involved an undisclosed auxiliary-filename restriction;
the unchanged patches passed separate substantive checks. Those failures stayed
in the frozen results, with the confounds explained.

Even after acknowledging those problems, there was no clean additional
completed-task win for the extension in the primary suite. Astra also had a
straightforward regression: stock passed all 64 official checks on one issue;
the experimental run passed 62, missing two ordering cases.

Separate Nemotron runs failed all six tasks in both arms. They also complicate
the easy story: organized context used slightly *fewer* tokens overall there.
There wasn't one universal failure mechanism.

## Some of the failure was my machinery

The admission gate was supposed to prevent oversized requests. It used a very
conservative serialized-byte estimate, including provider metadata, as a bound
on tokens. That could stop a run while its actual requests were still well
below the model's context limit.

There was also friction in the memory tools: identifiers the model could see
but couldn't successfully submit, checkpoint schemas to get wrong, and extra
instructions competing with the actual coding task.

We repaired those problems. Two later GPT diagnostic tasks passed without
reproducing the earlier admission failures. That did not turn the earlier
comparison into a win.
Reusing a known failing task to debug a fix is engineering, but it is not a fresh
test of general benefit.

One of the harder lessons here was keeping operational success separate from
task success. The extension could preserve records, retrieve exact text, and
survive a restart. None of those facts establishes that it helps produce a
correct patch.

## More tokens did not mean more reasoning

In the original comparison, Qwen and Nemotron had thinking disabled and a 4,096-token output cap. GPT used
medium thinking. That setting difference makes cross-model stories about
"frontier memory" versus "small-model memory" especially shaky.

For Qwen, more than 99% of the incremental token usage was input. The agent was
processing more context more often, not spending those millions of tokens on
explicit reasoning.

Across the six Qwen tasks, forwarded requests increased from 244 to 322. Mean
inclusive input per request increased from about 13,533 tokens to 24,055. Both
the call count and the request size mattered.

There were concrete execution problems too: repeated investigation, malformed
tool arguments, missing test commands, and plans that violated constraints.
Keeping a mistaken interpretation around can make it more persistent. Accurate
quotation does not make the interpretation correct.

It was tempting to conclude that stronger models simply didn't need help, while
smaller models couldn't handle the extra machinery. That is a plausible
hypothesis. This experiment did not isolate it.

## What if we removed context instead?

Claude proposed a much smaller direction: stop adding a memory bank and prune
redundant tool results instead. Keep the raw session untouched. Preserve recent
context. Replace an old duplicate read with a short stub only at fixed growth
boundaries, so we aren't rewriting history on every call.

We narrowed the first test further. No bash-output truncation; that's where
the useful traceback might be. No task card. No custom summary. Only successful
full-file reads with identical later content at the same path. Partial reads,
failed reads, truncated output, and changed historical versions stayed intact.

This time there was an offline gate before any pruning-specific model calls. Run the transform
over archived stock sessions and check whether there was enough to remove.

**Twenty-nine sessions. 1,668 transcript prefixes. Zero replacements.**

The policy protected the most recent 20K tokens and advanced in 20K growth
chunks. Twenty-four sessions accumulated less than 40K tokens in the offline
representation. Across all 196 native read results, only 18 were repeated,
identical full reads before applying recency or compaction-visibility filtering.

These were tokenizer counts over a documented text representation, not exact
provider requests. The real transcripts exercised the transform's invariants
mostly by doing nothing; synthetic tests covered the actual replacements.

The live-call gate failed. That result stayed frozen.

## I asked for one last try

I wasn't quite ready to leave it there. We made one final, separately specified
attempt: stock Pi against subtraction alone, with no memory tools, task card,
custom summary, or extra model-facing guidance. This time the policy used 8K
growth chunks and protected the most recent 4K proxy tokens. We also changed the
offline gate to require actual replacement exposure rather than the first
screen's savings threshold. Those were new experiment choices, fixed before
replay and live outcomes, not evidence that the original gate had passed.

Nine mechanics tests passed, and replay finally found some duplicates to remove.
Then we ran one known, two-stage coding task per model and arm: Sol, Luna,
Nemotron, local Qwen, and Gemini Flash. That was ten runs, not another open-ended
search. Both arms got the same explicit file-scope constraints and test setup.
Pi's declared window was reduced to 64K, and the task retained its scheduled
compaction/restart handoff. Thinking was enabled this time; Qwen got up to
30 minutes per request and four hours per arm.

| Model | Stock / subtraction outcome | Subtraction total-token change |
| --- | --- | ---: |
| GPT-5.6 Sol | Both accepted | -3.4% |
| GPT-5.6 Luna | Both accepted | -11.6% |
| Nemotron free | Both failed | Not an efficiency result |
| Local Qwen | Both failed | Not an efficiency result |
| Gemini Flash | Both budget-limited and incomplete | Not an efficiency result |

For a moment, Luna looked like the answer. It crossed our predeclared 10%
numerical signal threshold, and both patches passed. But looking at the actual
calls made the conclusion less exciting.

Direct replay of B's own history estimated only **1.8% less decision input for
Sol and 4.0% for Luna**. Those are tokenizer-proxy estimates, not exact provider
charges. Both B runs actually used slightly more **uncached** input; their lower
inclusive totals came from fewer cached tokens. Sol B also made more calls and
took longer. A different sequence of edits, reads, and cache hits can change the
total without proving that the subtraction caused the difference.

Only Sol and Luna exercised pruning at all. Nemotron, Qwen, and Gemini had zero
transformed requests in their experimental arms. Their outcomes cannot tell us
whether subtraction helps weaker models.

Qwen gave us another concrete reminder that remembering and reasoning are
different problems. Its experimental run took about 71 minutes, used 22,649
reported reasoning tokens, and successfully compacted and restarted. The summary
retained the file-scope constraint. The model reconsidered that constraint and
then incorrectly decided it could add two new declaration files anyway. The
patch failed the explicitly disclosed scope check. It hadn't forgotten the
rule; it had interpreted it incorrectly.

Stock Qwen spent about 67 minutes before exhausting its initial-stage call cap,
including prolonged test debugging and a bad whitespace assertion. Gemini's
initial patches passed their tests, but the agents kept making calls instead of
ending the stage. Their next full-context cost reservations exceeded the
conservative paid ceiling before they reached integration. Those are incomplete
runs, not token-saving wins.

No arm naturally reached the context limit, even with the smaller declared
window. Three had the scheduled manual compaction; the rest either had too
little history to compact or stopped before handoff.

The final attempt used 3.51 million total tokens over about 2 hours 48 minutes.
New paid usage reported by the provider was about $0.296; subscription and local
compute were unpriced. [The complete report and aggregate data](https://github.com/xCatG/pi-context-ext/blob/main/docs/subtraction-v2.md)
preserve all ten outcomes. Luna's numerical signal could justify a future
proposal, but it didn't establish a reason to ship this extension for everyday
work. I stopped there.

## A large bill is not a full context window

This was the reframing I should have reached earlier. Sending a 20K-token
history fifty times costs roughly a million input tokens. It still isn't a
million-token history.

Our workloads exposed coding mistakes, harness problems, and repeated work.
They offered much weaker evidence that natural context-limit pressure was the
thing holding the agent back. W6 deliberately exercised compaction and restart;
that is different from a long production session naturally running out of room.

[Leviath's own discussion](https://leviath.dev/) was useful here. It explicitly
says the simpler loop can be cheaper and perform as well or better when work
fits in the window. Its [context-pressure methodology](https://github.com/GEMISIS/leviath-benchmarks/blob/bc903a6daedc0d7c44b2cb9645b1b07791a6c3f2/bench/quality/HALLUCINATION-METHODOLOGY.md)
also explains that shell access was disabled for log tasks because scripts
otherwise avoided the intended context pressure. That's a legitimate stress condition, but it is not ordinary
coding with unrestricted native tools.

This does not prove context organization is useless. It means our experiment
didn't establish the problem strongly enough to justify this solution.

## Shelving it, and publishing it anyway

The research is shelved. I'm using stock Pi rather than expanding the memory
system or manufacturing a longer task just to give it somewhere to win.

The [experimental extension is open source under MIT](https://github.com/xCatG/pi-context-ext).
The repository separates the original scored source, the repaired preview, and
the final subtraction-only prototype, and includes aggregate results and the
limitations behind them. Raw sessions
and the complete historical benchmark environment are not public, so this is
not a claim of full independent reproducibility. The mechanics tests are
reproducible; the public aggregates can be checked arithmetically.

For readers who want to compare the implementations, I also published two
snapshot branches: [the original scored memory extension](https://github.com/xCatG/pi-context-ext/tree/codex/organized-scored)
and [the final subtraction-only extension](https://github.com/xCatG/pi-context-ext/tree/codex/subtraction-v2).
Both put the active implementation at `src/index.ts`, so you can
[browse the code differences directly](https://github.com/xCatG/pi-context-ext/compare/codex%2Forganized-scored..codex%2Fsubtraction-v2)
or follow each branch's run instructions. `main` keeps the reports and repaired
preview. The memory branch deliberately preserves the scored version's known
defects; these are historical snapshots, not two recommended product versions.
The experiments also used different cohorts and policies, so comparing their
code does not make the measurements a head-to-head comparison.

It might still be a useful reference for Pi extension APIs, exact-history
retrieval, correction handling, or simply what a context experiment looks like
when it doesn't earn its overhead. It should not be installed on the promise
that it improves coding performance. We did not show that.

If a real long-running coding task later exposes a specific context failure,
there will be a reason to revisit the idea. For now, the useful result was
learning when to stop.
