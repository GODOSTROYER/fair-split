import { type Db, schema as s } from "@fairsplit/db";
import { eq } from "drizzle-orm";
import { type EnqueueOptions, enqueue } from "../src/enqueue.js";
import type { TaskName } from "../src/index.js";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until(
  cond: () => boolean | Promise<boolean>,
  timeoutMs = 8000,
  stepMs = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await sleep(stepMs);
  }
}

let n = 0;
export const key = (prefix = "k") => `${prefix}:${process.pid}:${Date.now()}:${n++}`;

/** Enqueue in its own committed transaction (the common "state change + task" shape, minus the state). */
export async function enqueued(
  db: Db,
  name: TaskName = "computeRun",
  args: Record<string, unknown> = { runId: "r" },
  opts: EnqueueOptions = {},
  dedupeKey = key(name),
): Promise<string> {
  return db.transaction(async (tx) => (await enqueue(tx, name, args, dedupeKey, opts)).id);
}

export async function rowOf(db: Db, id: string) {
  const [row] = await db.select().from(s.taskOutbox).where(eq(s.taskOutbox.id, id));
  if (!row) throw new Error(`no task ${id}`);
  return row;
}
