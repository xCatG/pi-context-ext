# Pi context extension

An opt-in organized-context package for **Pi 0.85.1**. It keeps Pi's native
coding tools and compaction timing. This is an experimental successor to a
measured prototype. The original comparison did not justify replacing stock Pi;
this preview repairs diagnosed failures. Two GPT diagnostic coding tasks passed;
local Qwen exhausted its diagnosis-stage request budget. These reused tasks do
not establish a coding advantage over stock Pi.

## Load locally

Requires Node >=22.19.0 and Pi 0.85.1. From the source checkout:

```powershell
npm ci --ignore-scripts
pi -e ./src/index.ts
```

Alternatively, install this directory with `pi install <absolute-package-directory>`.
For the local preview archive, extract it first and install the extracted
`package` directory; passing a `.tgz` directly as a local Pi extension is not
supported. Pi supplies the core peer dependencies. Loading is opt-in; this experimental
preview is not published to npm. Source is available under the MIT license.

```text
/context
/context json
/context pin <native-user-entry-id>
/context mode off
/context mode organized
```

`/context` opens a read-only, scrollable native TUI inspector. Use arrow keys or
Page Up/Down to scroll, and q/Escape to close. It shows constraints/pins, source
evidence, model interpretations and revisions, open work/conflicts, selection
diagnostics and recent history. Sections have bounded previews; source text is
sanitized for terminal display without changing stored evidence. RPC/print use
structured notifications instead of an interactive component. `/context json`
retains the compact structured state notification. A pin preserves exact source
text; it does not approve
instructions quoted inside that text. Status/command notifications use Pi's UI
API (TUI/RPC); use native session records for inspection in print/JSON mode.
The saved branch mode is resumed; a new session defaults to organized. Mode
changes use `/context mode`; this package does not register a free-form mode flag.

Off removes the two context tools and all new prompt changes. Existing history
remains intact. Re-enabling rebuilds source indexes from active native history.
Adaptive mode is unavailable: qualification exposed a native overlapping-compaction
race. The [defect report](docs/reviews/2026-09-11-native-compaction-race.md) preserves
the reproducer; this package never proactively calls `ctx.compact()`.

## What is retained

- Original user sources and tool observations, indexed by native entry ID and
  observed-text digest. Truncated output remains partial evidence.
- Attributed interpretations and explicit corrections, with independent claims
  preserved. Invalid revision chains become mandatory conflicts.
- Open work, tool starts/outcomes and unknown operations. Unknown does not mean
  permission to replay an operation.
- Native history, including compacted and abandoned branches. Recall does not
  adopt a historical branch's claims into active state.

`context_checkpoint` records model-attributed claims/work/intent interpretations
and considered user sources (native user-entry IDs or active user-source record
IDs shown in the projection). Its stable `requestId` makes identical retries
idempotent; conflicting retries fail. Claims require `text`, `status`
(`hypothesis`, `conclusion`, `uncertain`), `evidenceIds`, and `counterEvidenceIds`.
Work requires `text` and `status` (`open`, `done`, `withdrawn`). A revision also
specifies `supersedes` and `reason`. Intent proposals use `text`, `sourceId`,
`author: "model"`, `pinned: false`. Model tools cannot create user pins or accepted
decisions. Empty evidence lists are allowed for hypotheses; a conclusion's label
is still an assertion, not semantic verification.

`context_recall` accepts native `entryIds`, a literal case-sensitive substring
`query`, and optional
`scope: "historical"`. It returns literal text blocks with provenance, byte offsets
and explicit unavailable content. Its full JSON page defaults to 16 KiB and is
capped at 64 KiB (minimum requested budget 1 KiB). Continue with the returned
cursor and the same query, IDs and scope. Query spaces and punctuation must match
exactly; omit it to retrieve all selected text. `matchSummary` distinguishes zero
text matches from unsupported content and reports frozen snapshot entry counts.
Matching text takes page priority over unavailable-ID lists; both remain
retrievable. Duplicate requested IDs are returned once. Appends retain the frozen snapshot;
branch changes or restarts invalidate cursors. It does not search other sessions.
Images and unsupported nontext content are explicitly unavailable through this
text-only recall tool; native history/tools remain their source.

## Context and recovery limits

The projection is transient: it is not written into the native transcript or
native compaction summary input. Original task/pins, unconsidered user messages,
open work and correction conflicts are mandatory. Optional evidence/claims are
selected within a 2,000-token soft target, with an omission manifest.

Admission uses Pi's content-aware heuristic for current native history, with
explicit message framing allowances. Provider signatures and usage metadata stay
intact in outgoing history but are not counted as ordinary text tokens. Projection
and recalled text retain conservative UTF-8 byte bounds, including their content
envelopes; system/tool definitions, maximum model output and a safety margin also
remain reserved. Prior-request usage is not reused or added again. This is a
planning estimate, not a provider tokenizer or a hard capacity guarantee: images,
non-ASCII text and provider framing can differ. It can still block early or
underestimate a native request; provider errors remain observable through Pi.
If mandatory context cannot fit, the extension preserves the request, aborts
dispatch and emits `context-capacity-blocked`. Increase the context window,
explicitly revise task scope, or switch the extension off to recover.

Text mode exits with a failure and a JSON diagnostic inside Pi's stderr error
line. JSON mode emits the terminal failure on stdout and diagnostic on stderr;
consumers must read both channels. RPC emits `extension_error` and a terminal
failure: a successful prompt receipt ACK is not successful execution. TUI shows
the native diagnostic. Real adapters were tested with a fake provider; TUI
keyboard/PTY behavior and attachment recovery have not been qualified.

Persistent sessions retain records in native JSONL. Pi defers writing a new
user-only branch until its first assistant response; before that point, the
parent session remains the recovery source. Ephemeral sessions have no restart
guarantee. Missing sources are not reconstructed. Invalid parseable records are
reported as degraded; malformed JSONL lines skipped by Pi's own loader are outside
this extension's corruption-detection coverage.

Freshness is advisory. A subsequent complete native read can compare the old
observed digest with the new observed text. Currency at a later edit is still
unknown without current evidence; mutation calls are never blocked or rewritten
by the freshness audit. Quotes, hashes, provenance labels and summaries do not
establish semantic correctness or reliably prevent prompt injection.

## Accounting and evaluation

Native session lifecycle records retain projection/recall estimates, native
assistant/compaction usage, failed operations and tool wall times. Pi-normalized
usage is mapped to disjoint input/cache/output buckets; reasoning/cache-lifetime
subsets are not added twice. Unknown or inconsistent usage remains unknown.
Actual billing, raw-vendor completeness, hidden retries and complete end-to-end
wall accounting still require provider/run qualification. The pure ledger and
reporting helpers are not an execution framework.

The completed original comparison did not justify replacing stock Pi. It found
admission aborts and checkpoint-ID friction, which this successor addresses.
Known-failure diagnostic replays are repair evidence, not new coding-benefit
measurements. Public aggregate results and limitations are in docs/experiment.md. Full raw
sessions and historical run manifests are not distributed.
Installing the extension never starts an evaluation or research loop.

## Develop

```powershell
npm run check
npm pack --dry-run
```

Source tests use the real public Pi session lifecycle and mode adapters with a
scripted provider. See docs/experiment.md for the distinction between mechanics tests and live
diagnostic outcomes; test-only dependencies are not bundled.
Private, undistributed `.qualification/` artifacts retain native sessions, subprocess
stdout/stderr and failure evidence. The native concurrency defect test asserts
the observed failure; its passing result does not qualify adaptive mode.

This repository is independent of RAH. It does not modify RAH, use its services,
redirect experiments, or inherit its research loop.

