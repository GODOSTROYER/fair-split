import type { Database } from "@fairsplit/db";
import type { OutboxOptions } from "@fairsplit/outbox";
import { pino } from "pino";
import { expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({ loaded: false, start: vi.fn(async () => ({ id: "test-task" })) }));
vi.mock("@renderinc/sdk", () => {
  spies.loaded = true;
  return {
    Render: class {
      workflows = { startTask: spies.start };
    },
  };
});
const wiring = vi.hoisted(() => ({ options: null as unknown }));
vi.mock("@fairsplit/outbox", () => ({
  createOutbox: (options: unknown) => {
    wiring.options = options;
    return {};
  },
}));

import { wireOutbox } from "./db.js";
import { parseEnv } from "./env.js";

it("HD6 F5: inline boot leaves the optional workflow SDK unloaded; workflow dispatch loads it once", async () => {
  const options = { data: { database: {} as Database }, handlers: {}, logger: pino({ level: "silent" }) };
  wireOutbox({ ...options, env: parseEnv({ NODE_ENV: "test", EXECUTOR: "inline" }) });
  expect(spies.loaded).toBe(false);
  wireOutbox({
    ...options,
    env: {
      ...parseEnv({ NODE_ENV: "test" }),
      executor: { kind: "workflow", tasksSlug: "fs-tasks", renderApiKey: undefined },
    },
  });
  expect(spies.loaded).toBe(false);
  const client = (wiring.options as OutboxOptions).workflowClient;
  if (!client) throw new Error("Workflow dispatch must remain available");
  await client.startTask("fs-tasks/extract", []);
  await client.startTask("fs-tasks/extract", []);
  expect(spies.loaded).toBe(true);
  expect(spies.start).toHaveBeenCalledTimes(2);
});
