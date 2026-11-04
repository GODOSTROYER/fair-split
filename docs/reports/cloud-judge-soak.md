# Cloud T5: judge-load soak in replay (`cloud/judge-soak`)

Status: **in progress** (skeleton pushed early; numbers land as each run finishes).

## What runs

- `tools/soak/stack.ts`: the e2e stack (`e2e/stack/stack.ts`, unchanged): fs-api on the in-process PayPal simulator,
  keyless, `NODE_ENV=test`, `FS_TEST_JUDGE_HOURLY_MAX=24`, serving the console, `/app` and `/media` from one origin.
  It also writes a state file (origin, fs-api pid, database URL; owner-only, never printed).
- `tools/soak/run.ts`: N concurrent judges through the 60-second loop over plain HTTP (`node:http`): first press,
  two event streams, INVOICED, Mark paid, IN_REVIEW, slip 0462 by hand, H1–H3, both demo keys, both keys, the payout
  POST, Rhea to cash, SETTLED, Proof, Reset. Each judge has its own cookie jar and its own loopback source address
  (127.x.y.z), so fs-api's per-IP throttles see separate networks.
- Postgres: an external PostgreSQL 17.10 server (`FS_TEST_DATABASE_URL`), not the embedded cluster, because
  `initdb` refuses to run as root on this machine.

## Results

Pending.
