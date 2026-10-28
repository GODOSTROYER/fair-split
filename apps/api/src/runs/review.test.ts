// The review on embedded Postgres, on the seeded season: the engine's own holds (H1–H3, slip 0462 by hand),
// slip 0462 typed by hand (MM-2: the dial opens at 2.05%), H1 counted once (MM-3: 2.05% → 1.62%), H2 and H3
// resolved, and every line then equal to the seed's resolved checkpoint, computed by code (I1, I3).

import type { HoldDTO } from "@fairsplit/contracts";
import { ApiError, RunEvent } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { getComputation, getSnapshot } from "@fairsplit/seed";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunsHarness, startRuns } from "./test/app.js";

let h: RunsHarness;
const auth = (token: string) => ({ as: h.t.credentials.bearer(token) });

async function holds(): Promise<HoldDTO[]> {
  const r = await h.t.json<{ holds: HoldDTO[] }>(
    `/v1/runs/${h.world.runSlug}/holds`,
    auth(h.tokens.treasurer),
  );
  expect(r.status).toBe(200);
  return r.body.holds;
}
const byLabel = (list: HoldDTO[], label: string) => list.find((x) => x.label === label) as HoldDTO;

beforeAll(async () => {
  h = await startRuns();
});
afterAll(async () => h?.close());

describe("review: holds and by-hand fields (resolveHold, enterField)", () => {
  it("inv.i1.engine-holds: the engine raised the seed's read-checkpoint holds, each with a digit-free pencil line", async () => {
    const list = await holds();
    expect(list.map((x) => [x.label, x.kind, x.state]).sort()).toEqual(
      [
        ["H1", "DUPLICATE_SLIP", "OPEN"],
        ["H2", "IMPLAUSIBLE_YIELD", "OPEN"],
        ["H3", "NO_RULE", "OPEN"],
        ["Slip 0462 by hand", "LOW_CONFIDENCE", "OPEN"],
      ].sort(),
    );
    for (const x of list) {
      expect(x.claudeLine === null || !/[0-9]/.test(x.claudeLine)).toBe(true);
      expect(x.engineLine.length).toBeGreaterThan(10);
      expect(x.provenance).toBe("replay");
    }
    expect(byLabel(list, "H1").engineLine).toContain("Slip 0457 is in two photos");
  });

  it("refuses a resolution the hold's kind does not allow (RESOLUTION_NOT_ALLOWED), and a non-treasurer (FORBIDDEN)", async () => {
    const h2 = byLabel(await holds(), "H2");
    const api = h.t.client(h.tokens.treasurer);
    await expect(
      api.resolveHold({ params: { holdId: h2.id }, body: { resolution: "COUNT_ONCE" } }),
    ).rejects.toMatchObject({
      code: "RESOLUTION_NOT_ALLOWED",
      status: 422,
    });
    for (const token of [h.tokens.clerk, h.tokens.member, h.tokens.brand]) {
      await expect(
        h.t.client(token).resolveHold({
          params: { holdId: h2.id },
          body: { resolution: "REGISTER_PLOT", plot: { plotNo: "P-053-B", areaHa: "0.60", trees: 330 } },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("enterField: VALIDATION_FAILED for text that is not kilos, FORBIDDEN for a member, 404 for another workspace's field", async () => {
    const r = await h.t.json<ApiError>(`/v1/fields/${h.world.fields0462.gross}/enter`, {
      method: "POST",
      body: { value: "sixty four" },
      ...auth(h.tokens.treasurer),
    });
    expect(r.status).toBe(400);
    expect(ApiError.parse(r.body)).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { issues: [{ path: "body.value" }] },
    });
    await expect(
      h.t
        .client(h.tokens.member)
        .enterField({ params: { fieldId: h.world.fields0462.gross }, body: { value: "64.80" } }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const other = await h.t.credentials.frameToken({
      workspaceId: (await h.t.fixture()).workspaceId,
      role: "treasurer",
      persona: "analyn",
    });
    await expect(
      h.t
        .client(other)
        .enterField({ params: { fieldId: h.world.fields0462.gross }, body: { value: "64.80" } }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("MM-2: slip 0462 typed by hand derives the net, matches logbook line 7, clears the by-hand hold and opens the dial at 2.05%", async () => {
    const before = await h.t.json<{ run: { version: number } }>(
      `/v1/runs/${h.world.runSlug}`,
      auth(h.tokens.treasurer),
    );
    const r = await h.t
      .client(h.tokens.treasurer)
      .enterField({ params: { fieldId: h.world.fields0462.gross }, body: { value: "64.8" } });
    expect(r.field.finalValue).toBe("64.80");
    expect(r.field.decidedBy).toBe("person");
    expect(r.derived).toEqual({ net_kg: "64.50" });
    expect(r.logbookMatch).toBe(true);
    expect(r.matchesReadPattern).toBe(true);
    expect(r.runVersion).toBeGreaterThan(before.body.run.version);
    const list = await holds();
    expect(byLabel(list, "Slip 0462 by hand")).toMatchObject({
      state: "RESOLVED",
      resolution: { kind: "ENTERED_BY_HAND", by: "AS" },
    });
    const dial = byLabel(list, "Mass balance");
    expect(dial).toMatchObject({
      kind: "MASS_BALANCE",
      state: "OPEN",
      gate: "BLOCKS_APPROVAL",
      lineId: null,
    });
    expect(dial.engineParams.shrinkBp).toBe(getSnapshot().figures.shrinkTwiceBp);
    const [row] = await h.t.deps.db
      .select()
      .from(schema.slipRows)
      .where(eq(schema.slipRows.id, h.world.slipRow.get("0462:WHITE_ORIGINAL") as string));
    expect(row).toMatchObject({ state: "CONFIRMED", grossG: 64_800n, netG: 64_500n });
  });

  it("the dial is the engine's: no person can resolve MASS_BALANCE", async () => {
    const dial = byLabel(await holds(), "Mass balance");
    await expect(
      h.t
        .client(h.tokens.treasurer)
        .resolveHold({ params: { holdId: dial.id }, body: { resolution: "CONFIRM_AS_READ" } }),
    ).rejects.toMatchObject({
      code: "RESOLUTION_NOT_ALLOWED",
      details: { kind: "MASS_BALANCE", allowed: [] },
    });
  });

  it("MM-3: H1 counted once moves the needle from 2.05% to 1.62% and the engine clears the dial", async () => {
    const h1 = byLabel(await holds(), "H1");
    const r = await h.t
      .client(h.tokens.treasurer)
      .resolveHold({ params: { holdId: h1.id }, body: { resolution: "COUNT_ONCE" } });
    expect(r).toMatchObject({
      resolution: "COUNT_ONCE",
      recomputed: true,
      needsChair: false,
      hold: { state: "RESOLVED", resolution: { kind: "COUNT_ONCE", by: "AS" } },
    });
    const dial = byLabel(await holds(), "Mass balance");
    expect(dial).toMatchObject({ state: "RESOLVED", resolution: { kind: "ENGINE_CLEARED", by: "engine" } });
    expect(dial.engineParams.shrinkBp).toBe(getSnapshot().figures.shrinkOnceBp);
    expect(dial.engineLine).toBe("Shrink 1.62%, inside 2.0%.");
  });

  it("HOLD_NOT_OPEN: a resolved hold cannot be resolved again", async () => {
    const h1 = byLabel(await holds(), "H1");
    await expect(
      h.t.client(h.tokens.treasurer).resolveHold({
        params: { holdId: h1.id },
        body: { resolution: "TWO_DELIVERIES", reason: "two loads" },
      }),
    ).rejects.toMatchObject({ code: "HOLD_NOT_OPEN", status: 409 });
  });

  it("inv.i3.conservation: with H2 and H3 resolved, every line equals the seed's resolved checkpoint, computed by code", async () => {
    const list = await holds();
    const api = h.t.client(h.tokens.treasurer);
    await api.resolveHold({
      params: { holdId: byLabel(list, "H2").id },
      body: { resolution: "REGISTER_PLOT", plot: { plotNo: "P-053-B", areaHa: "0.60", trees: 330 } },
    });
    await api.resolveHold({
      params: { holdId: byLabel(list, "H3").id },
      body: { resolution: "RETURN_AS_CREDIT" },
    });
    const lines = await h.t.json<{
      lines: {
        memberNo: string;
        netCents: number;
        premiumCents: number;
        bonusCents: number;
        creditsCents: number;
        state: string;
        lineSha256: string;
      }[];
    }>(`/v1/runs/${h.world.runSlug}/lines`, auth(h.tokens.treasurer));
    const expected = getComputation("resolved").lines;
    expect(lines.body.lines).toHaveLength(expected.length);
    for (const e of expected) {
      const got = lines.body.lines.find((l) => l.memberNo === e.memberNo);
      expect(got, e.memberNo).toMatchObject({
        netCents: e.netCents,
        premiumCents: e.premiumCents,
        bonusCents: e.bonusCents,
        creditsCents: e.creditsCents,
        state: "READY",
      });
      // the line hash covers mark ids, which are this workspace's own; every other line hashes identically
      if (e.credits.length === 0) expect(got?.lineSha256, e.memberNo).toBe(e.lineSha256);
    }
    const total = lines.body.lines.reduce((s, l) => s + l.netCents, 0);
    expect(total).toBe(getSnapshot().figures.netCents);
    expect((await holds()).every((x) => x.state === "RESOLVED")).toBe(true);
  });

  it("every event the review wrote is an IC-01 RunEvent, labelled with its provenance (I8)", async () => {
    const rows = await h.t.deps.db
      .select()
      .from(schema.runEvents)
      .where(
        and(eq(schema.runEvents.workspaceId, h.world.workspaceId), eq(schema.runEvents.runId, h.world.runId)),
      );
    expect(rows.length).toBeGreaterThan(10);
    for (const e of rows) {
      const parsed = RunEvent.safeParse({
        id: String(e.id),
        ws: e.workspaceId,
        runId: e.runId,
        at: e.at.toISOString(),
        actor: { kind: e.actorKind, id: e.actorId, impersonatedBy: e.impersonatedBy },
        provenance: e.provenance,
        type: e.type,
        payload: e.payload,
      });
      expect(parsed.success, `${e.type} ${JSON.stringify(e.payload)}`).toBe(true);
    }
    const types = new Set(rows.map((e) => e.type));
    for (const t of ["hold.raised", "hold.resolved", "field.entered", "line.state"])
      expect(types.has(t), t).toBe(true);
  });
});
