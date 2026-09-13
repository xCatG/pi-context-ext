# Native overlapping-compaction qualification failure

Historical qualification note for Pi 0.85.1. The project subsequently shipped only organized mode as an experimental preview and is now shelved. Proposed work below records the original investigation, not an active plan.

Package: `@earendil-works/pi-coding-agent@0.85.1`, pinned by this repository's lockfile.
Reproducer: `tests/timing-compatibility.test.ts`, case
`overlap correlates correctly but native manual compaction fails on its shared controller`.

## Trigger and observed behavior

After two ordinary completed turns, an extension arms one candidate and calls
public `ctx.compact({ customInstructions: uniqueMarker, ...callbacks })`.
A second caller invokes public `session.compact('Independent manual request.')`
before the first call settles. The extension's session_before_compact hook
matches and cancels only its candidate. The other request rejects with:

```
TypeError: Cannot read properties of undefined (reading 'signal')
```

The candidate callback reports `Compaction cancelled`. Its unique marker correctly
distinguishes requests; the failure is in native shared compaction state, not
misidentification by the extension. This is a deterministic fake-provider SDK
reproduction, not a measurement of real-world race frequency.

## Source correspondence

Installed `dist/core/agent-session.js` uses one `_compactionAbortController`
for manual compactions. Each compact call assigns it; completion, catch and
finally clear it. An overlapping call can therefore lose its controller when
the other call exits.

The installed RPC `compact` handler directly calls session.compact, and its
JSONL handler dispatches commands without awaiting preceding commands. The TUI
/compact handler also calls session.compact directly and is reached before its
ordinary prompt compaction-queue check. These source paths establish an exposed
overlap path; a full terminal-input race reproduction is not yet claimed.

## Consequence and bounded alternatives

The approved two-stage check works for isolated requests, but its extension latch
does not serialize native manual requests from other callers. The public hook
runs after native preparation/controller setup. Cancelling a competitor there
does not protect controller ownership and would also change manual behavior.

Do not silently implement adaptive mode on this basis. A host-level fix needs
atomic serialized compaction admission, preferably request-local controller
ownership and consistent event/state cleanup, with regression tests for concurrent manual,
adaptive and automatic activity. No installed dependency has been patched here.

The smallest product scope alternative is to deliver organized mode with stock
compaction timing first, explicitly defer adaptive mode and its C comparison,
and retain the reproducer for a future exact-version qualification. That is a
milestone change requiring a decision under the approved plan's stop clause.
An SDK-owned launcher could control callers, but would expand this package-only
milestone. This report does not establish that all SDK designs are impossible,
and does not justify silently introducing a fork.

## Independent review and proposed next milestone

GPT-5.6-Sol independently confirmed the native controller ownership defect and
the TUI/RPC overlap paths. It found no supported extension-only serialization
hook. Its minimum upstream/core change recommendation is atomic compaction
admission (explicit busy rejection) and per-invocation controller ownership,
with actual TUI/RPC and automatic/manual overlap regression tests. A queue or
priority policy would be a separate, larger design choice. No patch is claimed
to be implemented or verified here.

Request-local controller ownership alone is insufficient: overlapping calls can
still summarize the same old state and append incompatible compaction boundaries.

Proposed scope decision, not yet approved:

- Continue remaining Task 1 checks needed by organized mode; keep the adaptive
  concurrency requirement explicitly failed rather than deleting its evidence.
- Implement Tasks 2–5 (records, capture, recall, projection, mode controls).
- Implement Task 6 accounting, but no proactive compaction or adaptive mode.
- Run Task 7 recovery/disableability qualification against organized mode.
- Prepare Task 8's finite protocol and incomplete manifest with C marked
  unavailable. Do not score an A/B/C pilot or change its original decision rules.
- Resume adaptive qualification only against an explicitly selected fixed Pi
  identity or separately approved minimal core patch. Do not start an upstream
  issue/PR, fork or automated monitoring without authorization.

This delivers the smallest useful extension while retaining the original adaptive
proposal as deferred work. Stock Pi's own overlapping manual-compaction behavior
remains an upstream limitation; organized mode does not fix it.

