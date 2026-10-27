# ADR-NNNN: <short title>

- **Status:** Accepted (user, on merge)
- **Date:** DD Mon 2026 (IST)
- **Author:** WS-<ID>
- **Touches:** register §n, IC-nn, spec section, package or pin

Copy this file to `docs/adr/NNNN-kebab-title.md` with the next free four-digit number (`0001` is reserved for the
plan errata ADR). ADRs are append-only: CI rejects edits to an existing ADR, so a change of mind is a new ADR that
supersedes the old one.

Only the user accepts an ADR (register, "Changes"), and **merging the ADR's PR is the acceptance**. Write the
status as `Accepted (user, on merge)` before the PR opens; the merge commit's date and author record when and by
whom. An ADR the user rejects is never merged, so `main` holds no "Proposed" ADRs. A later ADR that replaces this
one says `Supersedes ADR-NNNN` in its own status line; the old file is not edited.

## Context

What is true now, with sources (register section, spec section, spike result, `debug_id`, link).

## Decision

The change, stated so a subagent can apply it without asking.

## Consequences

- Affected consumers (workstreams and packages) and what each must change.
- Migration and the order it lands on `main`.
- Tests that prove it (`inv.iN.*` when an invariant is involved).
- What gets worse, and what we accept.

## Alternatives considered

| Option | Why not |
| ------ | ------- |
|        |         |
