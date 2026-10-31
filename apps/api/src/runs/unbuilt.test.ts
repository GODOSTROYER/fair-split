// The tasks this build has no worker for (readRateCard, warmCaches, reconcile, pushNotify) have handlers that
// complete at once with a labelled "not built in this build" outcome, so no outbox row of theirs dies, and the
// route folders register them. (On Postgres, rows of each run to `done`: runs/extract.pg.test.ts.)
import type { TaskContext } from "@fairsplit/outbox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDeps } from "../lib/context.js";
import { createTestApp, type TestApp } from "../test/index.js";
import { NOT_BUILT, type UnbuiltTask, unbuiltTasks } from "./unbuilt.js";

const NAMES = Object.keys(NOT_BUILT) as UnbuiltTask[];

function ctx(name: UnbuiltTask): TaskContext {
  return {
    outboxId: `0190a000-0000-7000-8000-00000000000${NAMES.indexOf(name)}`,
    name,
    workspaceId: null,
    attempt: 1,
    executor: "inline",
    signal: new AbortController().signal,
    complete: async () => undefined,
  };
}

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t?.close());

describe("tasks not built in this build", () => {
  it("each completes at once, whatever its arguments, and logs its label", async () => {
    const lines: { obj: unknown; msg: string }[] = [];
    const logger = {
      info: (obj: unknown, msg: string) => lines.push({ obj, msg }),
    } as unknown as AppDeps["logger"];
    const handlers = unbuiltTasks({ logger }, NAMES);
    for (const name of NAMES) {
      await expect(handlers[name]?.({ anything: "goes" }, ctx(name))).resolves.toBeUndefined();
    }
    expect(lines.map((l) => l.msg)).toEqual(NAMES.map((n) => NOT_BUILT[n]));
    for (const l of lines) {
      expect(l.msg).toMatch(/not built in this build/);
      expect(l.obj).toMatchObject({ outcome: "not_built" });
    }
  });

  it("the route folders register all four, once each", () => {
    const handlers = t.app.registry.taskHandlers(t.deps);
    for (const name of NAMES) expect(handlers[name], name).toBeTypeOf("function");
  });
});
