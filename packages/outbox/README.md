# @fairsplit/outbox

The transactional outbox (architecture G2, IC-04): every slow or irreversible effect is a `task_outbox` row committed in
the same transaction as the state change that needs it (I7), then handed to an executor.

```ts
import { createOutbox, enqueue, executorKindFromEnv } from "@fairsplit/outbox";

// in a request or task, inside the transaction that changes state:
await db.transaction(async (tx) => {
  await r.runs.transition(tx, {
    id: runId,
    from: "APPROVED",
    to: "POSTING",
    cause: "post",
    provenance: "live",
  });
  await enqueue(tx, "postPayoutBatch", { runId }, `post:${runId}`, { workspaceId });
});

// fs-api boot
const outbox = createOutbox({
  db,
  listenUrl: DATABASE_URL,
  workerId: `fs-api:${instance}`,
  handlers, // Partial<Record<TaskName, handler>>
  executor: executorKindFromEnv(), // EXECUTOR=inline | workflow | worker
  workflowClient: { startTask: (slug, args) => render.workflows.startTask(slug, args) },
});
await outbox.dispatcher.start(); // stop({ drain: true }) on SIGTERM; lastTickAt feeds /readyz

// fs-tasks (Render Workflows): register each TaskName as `fs-tasks/<name>` whose body is
//   (outboxId: string) => outbox.runTask(outboxId, "workflow")
// The outbox owns retries: the workflow body should not throw on a "retry" outcome.
```

| Piece                                       | Behaviour                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enqueue(tx, name, args, dedupeKey, opts?)` | Needs the transaction (refuses the pool). `ON CONFLICT (dedupe_key) DO NOTHING` → `{id, inserted}`. Args are ids, JSON, ≤ 8 KB. `delayMs`/`runAfter`, `maxAttempts` (8). `NOTIFY fs_outbox` on commit.                                                                                                                   |
| `createDispatcher`                          | Claims due rows `FOR UPDATE SKIP LOCKED`, calls `executor.run(name, [outboxId])`. Falls back inline if the hand-off throws or the task is not `running` within 20 s. Sweeper (every minute): `dispatched` > 5 min → re-queued; `running` with a silent heartbeat > 5 min → re-queued, or `dead` when attempts are spent. |
| Executors                                   | `inlineExecutor(fn, {concurrency: 2})`, `workflowExecutor(client)` (`fs-tasks/<name>`, `[outboxId]`, records `workflow_run_id`), `workerExecutor(db)` + `createWorker()` for the S6 fallback.                                                                                                                            |
| `runTask(deps, outboxId, executor)`         | The idempotent execution contract: claim (queued or dispatched → running) or skip; heartbeat + `AbortSignal` if the claim is lost; per-run claim token; `done`, or `queued` with backoff (2^n s, ≤ 5 min), or `dead`. `ctx.complete(tx)` marks the task done inside the handler's own transaction.                       |

Handlers must be idempotent: load state by id and move it with optimistic transitions, so a rerun after a crash between
the handler's commit and `done` is a no-op (tested). Tests use the embedded Postgres harness from `@fairsplit/db/testing`.

`src/_shims/contracts.ts` mirrors the IC-01 TaskName registry until WS-CORE merges `@fairsplit/contracts`.
