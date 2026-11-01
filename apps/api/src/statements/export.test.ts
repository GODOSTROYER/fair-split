import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { StatementAudio } from "@fairsplit/contracts";
import { getMember } from "@fairsplit/seed";
import { afterAll, beforeAll, expect, it } from "vitest";
import { loadShowcase, must, type ShowcaseWorld } from "../proof/testing/world.js";
import { findRepoRoot } from "../static.js";
import { createTestApp, type TestApp } from "../test/index.js";
import { exportStatementPlans, serializeStatementPlans } from "./export.js";
import { spokenTextSha256 } from "./render.js";

const root = findRepoRoot();
const committed = path.join(root, "media", "statement-plans.json");
let apps: TestApp[] = [];
let worlds: ShowcaseWorld[] = [];
let plans: Awaited<ReturnType<typeof exportStatementPlans>>;

beforeAll(async () => {
  for (const kind of ["showcase", "judge"] as const) {
    const app = await createTestApp({ db: "postgres" });
    apps.push(app);
    worlds.push(await loadShowcase(app.deps.db, { kind }));
  }
  const { APPROVED_STATEMENT_REQUESTS } = await import(
    pathToFileURL(path.join(root, "media/src/tts/plan.ts")).href
  );
  plans = await exportStatementPlans(must(apps[0]).deps.db, must(worlds[0]), APPROVED_STATEMENT_REQUESTS);
  if (process.env.FS_WRITE_STATEMENT_PLANS === "1") writeFileSync(committed, serializeStatementPlans(plans));
});

afterAll(async () => {
  for (const app of apps) await app.close();
  apps = [];
  worlds = [];
});

it("re-exports all eleven approved requests byte-identically from showcase and judge seed", async () => {
  const { APPROVED_STATEMENT_REQUESTS } = await import(
    pathToFileURL(path.join(root, "media/src/tts/plan.ts")).href
  );
  expect(plans.requests.map((r) => [r.member_no, r.lang])).toEqual(
    APPROVED_STATEMENT_REQUESTS.map((r: { member_no: string; lang: string }) => [r.member_no, r.lang]),
  );
  expect(plans.requests).toHaveLength(11);
  const again = await exportStatementPlans(
    must(apps[1]).deps.db,
    must(worlds[1]),
    APPROVED_STATEMENT_REQUESTS,
  );
  expect(serializeStatementPlans(again)).toBe(serializeStatementPlans(plans));
  expect(serializeStatementPlans(plans)).toBe(readFileSync(committed, "utf8"));
});

it("exports exact placeholder and mention spans, seeded AI notes, and only known PAY variants", () => {
  for (const request of plans.requests) {
    expect(request.lineId).toBe(getMember(request.member_no)?.id);
    for (const sentence of request.sentences) {
      expect(sentence.textSha256).toBe(spokenTextSha256(sentence.text));
      for (const span of [...sentence.placeholders, ...sentence.mentionSpans])
        expect(sentence.text.slice(span.start, span.start + span.spoken.length)).toBe(span.spoken);
      expect(sentence.mentionSpans.map((m) => m.ref)).toEqual(sentence.mentions);
      expect(sentence.mentionSpans.map((m) => m.start)).toEqual(
        sentence.mentionSpans.map((m) => m.start).sort((a, b) => a - b),
      );
      if (sentence.slot === "AI_NOTE") expect(sentence.variant).toBe("seeded");
      if (sentence.slot === "PAY") expect(["paypal", "cash_nodate"]).toContain(sentence.variant);
    }
  }
  expect(
    plans.requests
      .find((r) => r.member_no === "M-031")
      ?.sentences.filter((s) => s.slot === "PAY")
      .map((s) => s.variant),
  ).toEqual(["paypal", "cash_nodate"]);
});

it("GET /v1/media/audio computes every current seed sentence's exported hash", async () => {
  const app = must(apps[0]);
  const world = must(worlds[0]);
  for (const request of plans.requests) {
    const lineId = must(world.lineIds.get(request.member_no));
    const token = app.credentials.memberLink({ workspaceId: world.workspaceId, lineId });
    const result = await app.json(`/v1/media/audio/${lineId}?lang=${request.lang}`, {
      as: app.credentials.bearer(token),
    });
    expect(result.status).toBe(200);
    const audio = StatementAudio.parse(result.body);
    const expected = request.sentences.filter(
      (s) => !(request.member_no === "M-031" && s.slot === "PAY" && s.variant === "paypal"),
    );
    expect(audio.sentences.map((s) => [s.slot, s.variant, s.textSha256])).toEqual(
      expected.map((s) => [s.slot, s.variant, s.textSha256]),
    );
  }
});
