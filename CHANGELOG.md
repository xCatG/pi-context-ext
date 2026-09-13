# Changelog

## 0.2.0-preview.2

- Document literal, case-sensitive recall queries and expose bounded snapshot
  match counts separately from unavailable content.
- Return matching evidence before bulk unavailable IDs, preserving exact text,
  all unavailable identifiers, bounded pages and cursor snapshot identity.
- Deduplicate requested native IDs and clarify fresh checkpoint IDs for changed
  content versus identical retries.

## 0.2.0-preview.1

- Estimate native message content using supported Pi APIs instead of treating
  opaque provider metadata as text tokens; retain strict extension-content bounds
  and make heuristic uncertainty explicit.
- Use the same escaped projection cost for selection and final admission, allowing
  optional context to be omitted before rejecting a request.
- Accept authentic user-source record IDs and native user-entry IDs consistently
  in checkpoints, without changing receipt authenticity or trust boundaries.
- Explain valid checkpoint statuses and return bounded corrective ID hints.
- Add a read-only native `/context` inspector and retain `/context json`.
- Limit local package contents to runtime source and user documentation.

This is an opt-in experimental preview. It does not establish better coding quality or
lower cost than stock Pi. Native adaptive compaction remains unavailable.

