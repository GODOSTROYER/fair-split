import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "../src/testing/index.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb();
});
afterAll(async () => {
  await t?.close();
});

describe("smoke", () => {
  it("connects as owner and as fs_app", async () => {
    const [o] = await t.owner.sql`select current_user as u, version() as v`;
    const [a] = await t.app.sql`select current_user as u`;
    expect(o?.u).toBe("postgres");
    expect(a?.u).toBe("fs_app");
  });
});
