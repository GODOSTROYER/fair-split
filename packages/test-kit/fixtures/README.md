# Recorded fixtures

One JSON file per recorded HTTP exchange (`RecordedFixture` in `src/fixtures.ts`). Files are written only
through `writeFixture`, which scrubs them: tokens become `REDACTED`, emails become
`sb-<hash>@sandbox.fairsplit.invalid` aliases. `test/fixtures.test.ts` re-checks every file here on every CI run.

`paypal/oauth-token.json` is a hand-written example (`provenance: seeded`), not a recording.
