import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVAL_DEV_GROUPS, findAsset, SLIP_0403 } from "../src/content/spike.js";
import { Fixture, type SlipImageFixture } from "../src/fixtures/schema.js";
import { fixtureFields } from "../src/imagegen/review.js";
import { syncLabels } from "../src/labels/sync.js";
import { ConfirmationError, confirmHumanReview, type TerminalIo } from "../src/review/confirm.js";
import {
  applySubmission,
  findConfirmableSession,
  replayReadiness,
  reviewProof,
  type SessionRecord,
  sessionMismatches,
  sessionPath,
} from "../src/review/session.js";
import { entry, SHA_B, slipPageFixture } from "./support.js";

/**
 * The terminal gate on `human-reviewed` guards against accidents (an agent's pipe, CI), not against
 * anything that can drive a real terminal or edit JSON. What makes a person's review checkable is the
 * record behind it: a human-reviewed fixture names the saved review session whose readings a person
 * confirmed, of the same image, by the same reviewer (verify:media minor, register §11, C-24).
 */

const AT = "2026-10-23T05:00:00.000Z";
const LATER = "2026-10-23T05:10:00.000Z";
const tty = (answer: string): TerminalIo => ({
  interactive: true,
  ask: async () => answer,
  say: () => undefined,
});

function answersOf(f: Fixture) {
  return {
    fields: [...fixtureFields(f)].map(([path, ff]) => ({
      path,
      visible: ff.visible,
      legibility: ff.visible === "" ? ("ABSENT" as const) : ("CLEAR" as const),
      expect: ff.expect,
    })),
  };
}

/** A fixture after a person's pass in the review page, with the session the server saved. */
function submitted(
  reviewer = "Analyn",
  at = AT,
): { f: SlipImageFixture; session: SessionRecord; path: string } {
  const f = slipPageFixture("spike-0403", SLIP_0403);
  const session = applySubmission(f, answersOf(f), { reviewer, startedAt: at, submittedAt: at });
  return { f, session, path: sessionPath(f.id, at) };
}

function mediaRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "fs-proof-"));
  mkdirSync(join(root, "review", "sessions"), { recursive: true });
  mkdirSync(join(root, "fixtures"), { recursive: true });
  return root;
}

const save = (root: string, path: string, json: unknown) =>
  writeFileSync(join(root, path), JSON.stringify(json));

/** The one slip of a one-slip page. */
function only(f: Fixture) {
  const s = (f as SlipImageFixture).slips[0];
  if (!s) throw new Error(`${f.id} has no slip`);
  return s;
}

describe("confirming a review binds it to the saved session", () => {
  it("records the session on the fixture and the confirmation time on the session", async () => {
    const { f, session, path } = submitted();
    const done = await confirmHumanReview(
      f,
      "Analyn",
      tty("spike-0403"),
      { path, record: session },
      () => new Date(LATER),
    );
    expect(done.fixture.review).toMatchObject({
      status: "human-reviewed",
      reviewer: "Analyn",
      reviewedAt: LATER,
      session: path,
    });
    expect(done.session).toMatchObject({ fixture: "spike-0403", confirmedAt: LATER });
    expect(Fixture.safeParse(done.fixture).success).toBe(true);
    expect(path).toBe("review/sessions/spike-0403.20261023T050000.json");
  });

  it("refuses a session of other pixels, by another reviewer, or with other readings, and changes nothing", async () => {
    const { f, session, path } = submitted();
    const other = { ...session, imageSha256: SHA_B };
    await expect(confirmHumanReview(f, "Analyn", tty("spike-0403"), { path, record: other })).rejects.toThrow(
      /other pixels/,
    );
    await expect(confirmHumanReview(f, "Rhea", tty("spike-0403"), { path, record: session })).rejects.toThrow(
      /saved by Analyn, not Rhea/,
    );
    const edited = structuredClone(f);
    only(edited).fields.net_kg.visible = "38.40";
    await expect(
      confirmHumanReview(edited, "Analyn", tty("spike-0403"), { path, record: session }),
    ).rejects.toBeInstanceOf(ConfirmationError);
    expect(sessionMismatches(edited, session, "Analyn").join(" ")).toMatch(/fields\.net_kg/);
    expect(f.review.status).toBe("draft");
  });

  it("the schema refuses a human-reviewed fixture that names no session", () => {
    const { f } = submitted();
    const stamped = structuredClone(f);
    stamped.review.status = "human-reviewed";
    expect(Fixture.safeParse(stamped).error?.message).toMatch(/names the review session/);
  });

  it("a new submission on a reviewed fixture waits for a new confirmation", async () => {
    const { f, session, path } = submitted();
    const { fixture } = await confirmHumanReview(f, "Analyn", tty("spike-0403"), { path, record: session });
    applySubmission(fixture, answersOf(fixture), { reviewer: "Rhea", startedAt: LATER, submittedAt: LATER });
    expect(fixture.review).toMatchObject({ status: "agent-checked", session: null });
    expect(Fixture.safeParse(fixture).success).toBe(true);
  });
});

describe("reviewProof: a human-reviewed fixture names a confirmed session of its image, by its reviewer, with its readings", () => {
  async function confirmed(root: string) {
    const { f, session, path } = submitted();
    const done = await confirmHumanReview(
      f,
      "Analyn",
      tty("spike-0403"),
      { path, record: session },
      () => new Date(LATER),
    );
    save(root, path, done.session);
    return { ...done, path };
  }

  it("holds for a review confirmed at the terminal", async () => {
    const root = mediaRoot();
    const { fixture } = await confirmed(root);
    expect(await reviewProof(root, fixture)).toEqual([]);
  });

  it("asks nothing of a fixture nobody claims a person reviewed", async () => {
    expect(await reviewProof(mediaRoot(), submitted().f)).toEqual([]);
  });

  it("flags a missing, unparseable or unconfirmed session file", async () => {
    const root = mediaRoot();
    const { fixture, session, path } = await confirmed(root);
    save(root, path, { ...session, confirmedAt: null });
    expect((await reviewProof(root, fixture)).join(" ")).toMatch(/never confirmed at the terminal/);
    save(root, path, { hello: "world" });
    expect((await reviewProof(root, fixture)).join(" ")).toMatch(/not a review session/);
    const gone = {
      ...fixture,
      review: { ...fixture.review, session: "review/sessions/spike-0403.20990101T000000.json" },
    };
    expect((await reviewProof(root, gone)).join(" ")).toMatch(/does not exist/);
  });

  it("flags a fixture whose readings, reviewer or pixels differ from its session (a hand edit)", async () => {
    const root = mediaRoot();
    const { fixture } = await confirmed(root);
    const edited = structuredClone(fixture) as SlipImageFixture;
    only(edited).fields.gross_kg.visible = "99.99";
    expect((await reviewProof(root, edited)).join(" ")).toMatch(/fields\.gross_kg/);
    const renamed = { ...fixture, review: { ...fixture.review, reviewer: "Somebody else" } };
    expect((await reviewProof(root, renamed)).join(" ")).toMatch(/saved by Analyn, not Somebody else/);
    const repainted = { ...fixture, image: { ...fixture.image, sha256: SHA_B } };
    expect((await reviewProof(root, repainted)).join(" ")).toMatch(/other pixels/);
  });

  it("joins the replay check: an unproven review keeps the image out of a replay set", async () => {
    const root = mediaRoot();
    const { fixture } = await confirmed(root);
    const ctx = { mediaRoot: root, repoRoot: root, entry: entry("spike-0403") };
    expect(await replayReadiness(fixture, ctx)).toEqual([]);
    const edited = structuredClone(fixture) as SlipImageFixture;
    only(edited).fields.sacks.visible = "9 PP";
    expect((await replayReadiness(edited, ctx)).join(" ")).toMatch(/review session .* does not match/);
  });

  it("finds the latest matching session a reviewer saved, and none for another reviewer", async () => {
    const root = mediaRoot();
    const first = submitted("Analyn", AT);
    save(root, first.path, first.session);
    const second = applySubmission(first.f, answersOf(first.f), {
      reviewer: "Analyn",
      startedAt: LATER,
      submittedAt: LATER,
    });
    const secondPath = sessionPath("spike-0403", LATER);
    save(root, secondPath, second);
    expect((await findConfirmableSession(root, first.f, "Analyn"))?.path).toBe(secondPath);
    expect(await findConfirmableSession(root, first.f, "Rhea")).toBeNull();
  });

  it("keeps the label of an unproven human-reviewed fixture provisional, and says why", async () => {
    const root = mediaRoot();
    const { fixture } = await confirmed(root);
    const edited = structuredClone(fixture) as SlipImageFixture;
    only(edited).fields.sacks.visible = "9 PP";
    const asset = findAsset("spike-0403");
    const proven = await syncLabels(root, [asset], EVAL_DEV_GROUPS, async () => fixture);
    expect(proven.written).toEqual(["spike-0403"]);
    const unproven = await syncLabels(root, [asset], EVAL_DEV_GROUPS, async () => edited);
    expect(unproven.written).toEqual([]);
    expect(unproven.provisional).toEqual(["spike-0403"]);
    expect(unproven.unproven["spike-0403"]?.join(" ")).toMatch(/fields\.sacks/);
  });
});
