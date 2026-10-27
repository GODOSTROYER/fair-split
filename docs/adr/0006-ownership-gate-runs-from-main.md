# ADR-0006: The ownership gate runs from main, and the orchestrator merges without a queue

- **Status:** Accepted (user, on merge)
- **Date:** 27 Oct 2026 (IST)
- **Author:** WS-QA
- **Touches:** register header ("Changes"), register §11 (ownership check; "The user merges daily"), S5.2.4
  (path ownership in CI, merge queue, `merge_group`, ruleset), `.github/workflows/ci.yml`,
  `.github/workflows/ownership.yml`, `tools/check-ownership.mjs`, `docs/ownership.md`, CONTRIBUTING.md

## Context

- Plan amendment 2 replaced S5.2.4's organization, merge queue, `fs-bot` and ruleset: the orchestrator merges
  each branch into `main` after its own review and fix stage, an adversarial review, a security pass, and green
  typecheck, tests, dependency-cruiser and ownership checks on the merged result. The repository is private and
  user-owned until submission (ADR-0002); `main` has no branch protection and no ruleset.
- The first ownership check was a step in `ci.yml`. On `pull_request`, GitHub runs the workflow file from the PR's
  merge commit, so a PR could edit the step that judged it, for example by appending `|| true`. WS-QA owns
  `.github/**`, so one merged WS-QA PR could also remove the step for every later PR. On a push to `ws/**`, the
  step ran the branch's own checker whenever the merge base predated the checker. (Findings `verify:qa-correct`
  and `verify:qa-bypass`, 27 Oct.)
- Even with the step out of reach, WS-QA owns the checker and the rules: a merged edit that turns
  `tools/check-ownership.mjs` into a no-op would switch the gate off for every later PR just as well.
- The register's "Changes" line says ADR PRs are `docs/adr/NNN-title.md` and that WS-QA commits the register as
  `docs/decision-register.md`. WS-QA cannot edit `docs/spec/`, and two copies of the register would drift.

## Decision

1. **The gate runs from main.** `.github/workflows/ownership.yml` runs on `pull_request_target`, so GitHub takes
   the workflow from the default branch. Its job checks out `main`, fetches the PR's commits as data, and runs
   main's `tools/check-ownership.mjs` with main's `docs/ownership.md`
   (`--branch <PR branch> --base <main> --head <PR head> --ownership-ref <main> --strict`). It never installs,
   checks out or runs the PR's code, refuses PRs from forks, and fails closed when `main` has no checker as a
   regular file. `ci.yml` runs no ownership check.
2. **The merger runs it too.** Until a ruleset requires the gate, the gate that counts is the merger's own run of
   main's checker before each merge (CONTRIBUTING.md, "Merging"). A green check from a PR's own workflow is
   never taken as the gate.
3. **The gate's files** are `docs/ownership.md`, `tools/check-ownership.mjs` and `.github/workflows/ownership.yml`
   (`GATE_FILES`). No branch may delete, rename or retype one. Any other change to one (only WS-QA owns them)
   fails the check until the merger reads exactly that version and reruns the check with
   `--approve-gate-change <token>`. The token is a hash of the changed gate files' paths, statuses and blob ids at
   the judged commit, so a later edit needs a new review. CI cannot approve, and workstream agents never pass
   the flag (AGENTS.md).
4. **No merge queue.** CI does not trigger on `merge_group`; there is no queue and no daily train. If a queue is
   ever turned on, add the trigger to `ci.yml` and judge queue runs by the PR's branch, never by the
   `gh-readonly-queue/*` ref (which `--strict` fails).
5. **The workstream is the branch name.** The gate keeps a workstream inside its paths and stops it from widening
   its own row. It does not authenticate who pushed; CODEOWNERS with code-owner review would, once more than one
   person can push.
6. **Letter case.** Paths match without regard to case, as Windows and macOS checkouts do, and a path that differs
   from another path in the tree only by case is refused, so `apps/api/src/Webhooks/` cannot slip past the
   `apps/api/src/webhooks/**` exception.
7. **Register text this ADR amends** (the register stays unedited; this ADR wins where they differ):
   - "Changes: only through an ADR PR (`docs/adr/NNN-title.md`)": ADR files are `docs/adr/NNNN-title.md`, four
     digits, with `0001` reserved for the plan errata ADR. Take the next number free on `main` and on every
     in-flight branch.
   - "WS-QA commits this text as `docs/decision-register.md` on day 1": no `docs/decision-register.md` copy; the
     register lives only at `docs/spec/00-decision-register.md`, and every document links it there.
   - Register §11 "The user merges daily" and S5.2.4's queue, `fs-bot`, ruleset and `merge_group` lines read as
     plan amendment 2 and decisions 1 to 4 above.

## Consequences

- Every merge: the merger runs main's checker as CONTRIBUTING.md shows. A PR that changes a gate file stays red on
  GitHub, by design, and lands only through the merger's approval.
- When `main` gets a ruleset, require the `ownership` job's check. A required check is matched by name, which a
  PR's own workflow can also post, so the merger's run stays part of every merge.
- This ADR's own branch (`ws/qa`) adds the checker and `ownership.yml`, so `main` had no checker to judge it:
  for that one merge the merger runs this branch's checker against main's rules and approves the gate change by
  token. Every later PR is judged by main's copy.
- Tests: `packages/test-kit/test/check-ownership.test.mjs` (suites "the gate on GitHub" and "--base mode") and
  `packages/test-kit/test/repo-docs.test.mjs`.
- What gets worse: a change to the rules (a new workstream row, say) needs one more explicit step from the
  merger. Such changes are rare, and silent ones are exactly what the gate must not allow.

## Alternatives considered

| Option                                                       | Why not                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Keep the step in `ci.yml` and add `ci.yml` to the gate files | On `pull_request` the PR's own copy still runs, so a PR still judges itself                    |
| `pull_request_target`, gate files freely editable by WS-QA   | One merged WS-QA PR could replace the workflow or the checker with a no-op                     |
| Gate files owned by no workstream                            | They still need reviewed changes (rows, workstreams); an approval bound to content allows that |
| CODEOWNERS with required code-owner review                   | One human and no bot account (plan amendment 2): nobody else to review                         |
| An organization-level required workflow                      | No organization (plan amendment 2)                                                             |
