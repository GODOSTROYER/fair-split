## What and why

<!-- One or two sentences. Link the register section, spec section or ADR this implements. -->

## Workstream

- [ ] Branch is `ws/<id>` (or `deps/<name>` for a dependency-only PR) and every path is owned (`docs/ownership.md`)
- [ ] Shared contracts unchanged, or an approved ADR is linked

## Checks

- [ ] Tests added or updated; invariant tests are named `inv.iN.*`
- [ ] `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm deps:check` and `corepack pnpm lint` pass
- [ ] New pins are exact, at least 14 days old, and recorded in `docs/versions.md` (deps lane only)
- [ ] No secret, `.env` file or unscrubbed fixture; nothing simulated is unlabelled (I8)
- [ ] Money and kilo figures come from the seed snapshot (IC-03), not literals

## Review tier

<!-- A (money and trust), B (logic and AI) or C (UI, media, docs): see S5.2.4. -->
