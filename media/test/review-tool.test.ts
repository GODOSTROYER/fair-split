import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { SLIP_0403, SLIP_0462 } from "../src/content/spike.js";
import { Fixture, type SlipImageFixture } from "../src/fixtures/schema.js";
import { applyObservations, fixtureFields } from "../src/imagegen/review.js";
import { ConfirmationError, confirmHumanReview, type TerminalIo } from "../src/review/confirm.js";
import { inlineJson, renderReviewPage } from "../src/review/page.js";
import { startReviewServer } from "../src/review/server.js";
import {
  applySubmission,
  humanReviewBlockers,
  replayBlockers,
  reviewItems,
  SubmissionError,
} from "../src/review/session.js";
import { recordReadVerdict } from "../src/review/verdict.js";
import { slipPageFixture } from "./support.js";

const AT = "2026-10-23T05:00:00.000Z";
const META = { reviewer: "Analyn", startedAt: AT, submittedAt: AT };

/** A complete submission that confirms what each field shows now, with optional overrides by path. */
function answers(
  f: Fixture,
  overrides: Record<
    string,
    Partial<{ visible: string; legibility: string; expect: string; cropWrong: boolean }>
  > = {},
) {
  return {
    fields: [...fixtureFields(f)].map(([path, ff]) => ({
      path,
      visible: ff.visible,
      legibility:
        ff.legibility === "UNVERIFIED"
          ? ff.visible === ""
            ? "ABSENT"
            : ff.visible.includes("?")
              ? "SMUDGED"
              : "CLEAR"
          : ff.legibility,
      expect: ff.expect,
      ...overrides[path],
    })),
  } as Parameters<typeof applySubmission>[1];
}

function tty(answer: string, interactive = true): TerminalIo & { said: string[] } {
  const said: string[] = [];
  return { interactive, ask: async () => answer, say: (l) => void said.push(l), said };
}

describe("review session (S4.10 review grid): a person's readings become the fixture's", () => {
  it("lists every field with its crop rectangle and request, and the behavioural traps", () => {
    const { fields, traps } = reviewItems(slipPageFixture("spike-0462", SLIP_0462));
    expect(fields).toHaveLength(17);
    expect(fields.find((x) => x.path === "fields.gross_kg")).toMatchObject({
      title: "slip 0462 · 6 Gross (kg)",
      requested: "6?.80",
      value: "64.80",
    });
    expect(traps).toEqual([
      expect.objectContaining({ slot: "ONLY", trap: "WATER_STAIN", status: "UNVERIFIED" }),
    ]);
  });

  it("records what the person typed as visible, checked by a human", () => {
    const f = slipPageFixture("spike-0462", SLIP_0462);
    const rec = applySubmission(
      f,
      answers(f, { "fields.gross_kg": { visible: "64.80", legibility: "SMUDGED", expect: "EITHER" } }),
      META,
    );
    expect(fixtureFields(f).get("fields.gross_kg")).toMatchObject({
      visible: "64.80",
      legibility: "SMUDGED",
      expect: "EITHER",
      checkedBy: "human",
    });
    expect([...fixtureFields(f).values()].every((x) => x.checkedBy === "human")).toBe(true);
    expect(rec).toMatchObject({ v: 1, fixture: "spike-0462", reviewer: "Analyn", confirmedAt: null });
    // Not human-reviewed yet: that needs the terminal confirmation.
    expect(f.review.status).toBe("draft");
    expect(humanReviewBlockers(f)).toEqual([]);
  });

  it("refuses an incomplete or unknown answer set and changes nothing", () => {
    const f = slipPageFixture("spike-0403", SLIP_0403);
    const partial = answers(f);
    partial.fields = partial.fields.slice(1);
    expect(() => applySubmission(f, partial, META)).toThrow(SubmissionError);
    const extra = answers(f);
    extra.fields.push({ path: "fields.nope", visible: "", legibility: "CLEAR", expect: "AUTO" });
    expect(() => applySubmission(f, extra, META)).toThrow(/unknown: fields.nope/);
    expect([...fixtureFields(f).values()].every((x) => x.checkedBy === null)).toBe(true);
  });

  it("sends a fixture with a wrong crop back to draft and blocks its review", () => {
    const f = slipPageFixture("spike-0403", SLIP_0403);
    applyObservations(f, { allFieldsChecked: true, observed: [], mismatches: [], traps: [] }, AT);
    f.review.status = "agent-checked";
    applySubmission(f, answers(f, { "fields.date": { cropWrong: true } }), META);
    expect(f.review).toMatchObject({ status: "draft", cropIssues: ["fields.date"] });
    expect(humanReviewBlockers(f).join(" ")).toMatch(/wrong crops to redraft first: fields.date/);
  });

  it("lets a person record a failed trap, never a holding one, and keeps a read's verdict", () => {
    const f = slipPageFixture("spike-0462", SLIP_0462);
    const sub = {
      ...answers(f),
      traps: [
        {
          slot: "ONLY" as const,
          trap: "WATER_STAIN" as const,
          status: "FAILED" as const,
          evidence: "I can read the 4",
        },
      ],
    };
    applySubmission(f, sub, META);
    expect(f.slips[0]?.trapChecks[0]).toMatchObject({
      status: "FAILED",
      by: "human",
      evidence: "I can read the 4",
    });
    const read = slipPageFixture("spike-0462", SLIP_0462);
    recordReadVerdict(read, {
      slot: "ONLY",
      trap: "WATER_STAIN",
      status: "HOLDS",
      evidenceFile: "packages/eval/report/latest.json",
      evidenceSha256: "f".repeat(64),
      at: AT,
    });
    applySubmission(read, { ...answers(read), traps: sub.traps }, META);
    expect(read.slips[0]?.trapChecks[0]).toMatchObject({ status: "HOLDS", by: "read" });
  });

  it("lets a person overrule an agent's failed trap, back to waiting for a read, and says so", () => {
    const f = slipPageFixture("spike-0462", SLIP_0462);
    applyObservations(
      f,
      {
        allFieldsChecked: false,
        observed: [],
        mismatches: [],
        traps: [{ slot: "ONLY", trap: "WATER_STAIN", status: "FAILED", evidence: "ghost 4" }],
      },
      AT,
    );
    // The page starts on the recorded status, so skimming past it changes nothing.
    const { fields: items, traps } = reviewItems(f);
    const page = renderReviewPage({ id: f.id, title: "t", reviewer: "Analyn", token: "tok", items, traps });
    expect(page).toMatch(/value="FAILED" checked/);
    const sub = {
      ...answers(f),
      traps: [
        {
          slot: "ONLY" as const,
          trap: "WATER_STAIN" as const,
          status: "UNVERIFIED" as const,
          evidence: "no 4 to see",
        },
      ],
    };
    applySubmission(f, sub, META);
    expect(f.slips[0]?.trapChecks[0]).toMatchObject({ status: "UNVERIFIED", by: null, at: null });
    expect(f.slips[0]?.trapChecks[0]?.evidence).toMatch(
      /^no 4 to see \(Analyn, .*overruling the earlier agent look: ghost 4\)$/,
    );
    expect(Fixture.safeParse(f).success).toBe(true);
  });
});

describe("human-reviewed needs the person at a terminal (register §11, C-24)", () => {
  function reviewedByPerson() {
    const f = slipPageFixture("spike-0403", SLIP_0403);
    applySubmission(f, answers(f), META);
    return f;
  }

  it("refuses without an interactive terminal: an agent cannot set it", async () => {
    await expect(confirmHumanReview(reviewedByPerson(), "Analyn", tty("spike-0403", false))).rejects.toThrow(
      /interactive terminal/,
    );
  });

  it("refuses a blanket stamp: every field must carry the person's own reading", async () => {
    const f = slipPageFixture("spike-0403", SLIP_0403);
    applyObservations(f, { allFieldsChecked: true, observed: [], mismatches: [], traps: [] }, AT);
    await expect(confirmHumanReview(f, "Analyn", tty("spike-0403"))).rejects.toThrow(
      /not checked by a person/,
    );
  });

  it("refuses unless the person types the fixture id, and then records them", async () => {
    await expect(confirmHumanReview(reviewedByPerson(), "Analyn", tty("yes"))).rejects.toBeInstanceOf(
      ConfirmationError,
    );
    const io = tty("spike-0403");
    const done = await confirmHumanReview(reviewedByPerson(), "Analyn", io, () => new Date(AT));
    expect(done.review).toMatchObject({ status: "human-reviewed", reviewer: "Analyn", reviewedAt: AT });
    expect(Fixture.safeParse(done).success).toBe(true);
    expect(io.said.join(" ")).toMatch(/looked at every crop/);
  });
});

describe("replay acceptance (S4.10: heroes must behave as specified)", () => {
  it("needs a person's review and, for a trap, a recorded read that shows it holds", () => {
    const f = slipPageFixture("spike-0462", SLIP_0462);
    applySubmission(f, answers(f), META);
    f.review.status = "human-reviewed";
    expect(replayBlockers(f).join(" ")).toMatch(
      /WATER_STAIN must be shown to hold by a recorded Claude read/,
    );
    recordReadVerdict(f, {
      slot: "ONLY",
      trap: "WATER_STAIN",
      status: "HOLDS",
      evidenceFile: "packages/eval/report/latest.json",
      evidenceSha256: "a".repeat(64),
      at: AT,
    });
    expect(replayBlockers(f)).toEqual([]);
    expect(f.slips[0]?.trapChecks[0]?.evidence).toBe(
      "packages/eval/report/latest.json sha256:aaaaaaaaaaaaaaaa",
    );
  });

  it("a read can also fail the trap, which keeps the image out", () => {
    const f = slipPageFixture("spike-0462", SLIP_0462);
    recordReadVerdict(f, {
      slot: "ONLY",
      trap: "WATER_STAIN",
      status: "FAILED",
      evidenceFile: "r.json",
      evidenceSha256: "b".repeat(64),
      note: "read A 64.80 at 0.88",
      at: AT,
    });
    expect(replayBlockers(f).join(" ")).toMatch(/now FAILED by read/);
    expect(() =>
      recordReadVerdict(f, {
        slot: "TL",
        trap: "WATER_STAIN",
        status: "HOLDS",
        evidenceFile: "r",
        evidenceSha256: "b".repeat(64),
        at: AT,
      }),
    ).toThrow(/no slip in slot TL/);
  });
});

describe("review page", () => {
  it("escapes values so a slip's text can never close the script element", () => {
    expect(inlineJson({ v: "</script><script>alert(1)</script>" })).not.toContain("</script>");
    expect(inlineJson({ v: "a b" })).toContain("\\u2028");
    const page = renderReviewPage({
      id: "x",
      title: "<b>t</b>",
      reviewer: "A & B",
      token: "tok",
      items: reviewItems(slipPageFixture("spike-0403", SLIP_0403)).fields,
      traps: [],
    });
    expect(page).toContain("Synthetic sample");
    expect(page).toContain("&lt;b&gt;t&lt;/b&gt;");
    expect(page).not.toMatch(/<script src=/);
  });
});

/** A tiny HTTP client that can set the Host header (fetch cannot). */
function call(
  port: number,
  path: string,
  opts: { method?: string; host?: string; body?: string; headers?: Record<string, string> } = {},
) {
  return new Promise<{ status: number; body: string; type: string }>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: opts.method ?? "GET",
        headers: { host: opts.host ?? `127.0.0.1:${port}`, ...opts.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            type: String(res.headers["content-type"]),
          }),
        );
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

describe("review server (127.0.0.1 only, per-session token)", () => {
  async function mediaWithFixture() {
    const root = mkdtempSync(join(tmpdir(), "fs-review-srv-"));
    mkdirSync(join(root, "fixtures"), { recursive: true });
    mkdirSync(join(root, "masters"), { recursive: true });
    await sharp({ create: { width: 1000, height: 1200, channels: 3, background: "#eeeeee" } })
      .jpeg()
      .toFile(join(root, "masters", "spike-0403.jpg"));
    const f = slipPageFixture("spike-0403", SLIP_0403);
    writeFileSync(join(root, "fixtures", "spike-0403.json"), JSON.stringify(f));
    return { root, f };
  }

  it("refuses requests without the token or with another Host, serves crops, and saves one complete submission", async () => {
    const { root, f } = await mediaWithFixture();
    const written: string[] = [];
    const server = await startReviewServer({
      mediaRoot: root,
      fixtureId: "spike-0403",
      reviewer: "Analyn",
      now: () => new Date(AT),
      afterWrite: async (x) => void written.push(x.id),
    });
    const port = Number(new URL(server.url).port);
    try {
      expect((await call(port, "/")).status).toBe(403);
      expect((await call(port, `/?t=${server.token}`, { host: `evil.example:${port}` })).status).toBe(421);
      const page = await call(port, `/?t=${server.token}`);
      expect(page.status).toBe(200);
      expect(page.body).toContain("Review spike-0403");
      const crop = await call(port, `/crop/0?t=${server.token}`);
      expect(crop.status).toBe(200);
      expect(crop.type).toBe("image/png");
      const headers = { "content-type": "application/json", "x-review-token": server.token };
      const bad = await call(port, "/submit", {
        method: "POST",
        headers,
        body: JSON.stringify({ fields: [] }),
      });
      expect(bad.status).toBe(400);
      const ok = await call(port, "/submit", { method: "POST", headers, body: JSON.stringify(answers(f)) });
      expect(ok.status).toBe(200);
      const { fixture } = await server.submitted;
      expect([...fixtureFields(fixture).values()].every((x) => x.checkedBy === "human")).toBe(true);
      const saved = Fixture.parse(
        JSON.parse(readFileSync(join(root, "fixtures", "spike-0403.json"), "utf8")),
      ) as SlipImageFixture;
      expect(saved.slips[0]?.fields.net_kg.checkedBy).toBe("human");
      expect(saved.review.status).toBe("draft");
      expect(readdirSync(join(root, "review", "sessions"))).toHaveLength(1);
      expect(written).toEqual(["spike-0403"]);
      const again = await call(port, "/submit", {
        method: "POST",
        headers,
        body: JSON.stringify(answers(f)),
      });
      expect(again.status).toBe(409);
    } finally {
      await server.close();
    }
  });
});
