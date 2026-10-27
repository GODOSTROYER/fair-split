import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ClaudeGateway,
  MemoryReplayStore,
  MemorySpendMeter,
  Semaphore,
  staticFlags,
} from "../gateway/index.js";
import { SSE_HEADERS, sseBody } from "../gateway/test-helpers.js";
import { plainPage } from "../read/test-fixtures.js";
import { checkRateCard, normaliseQuote, termKey } from "./check.js";
import {
  parseCap,
  parseConfidence,
  parseKgPerTree,
  parsePercent,
  parsePeso,
  parseUsd,
  parseValue,
} from "./parse.js";
import { readRateCard } from "./read.js";
import type { RateCardRead, Term, TextLayer } from "./schema.js";

// Schedule A wording (S4.3), as the human-verified text layer of BR 2026-04.
const R = {
  R0: "The premium paid by the buyer shall be shared among members in proportion to verified kilos delivered. No deduction of any kind shall be made from the premium. The quality bonus shall be shared in proportion to verified Grade 1 kilos.",
  R1: "Capital build-up (CBU): 5% of the member's quality bonus, until the member's paid-up CBU reaches ₱5,000.",
  R2: "Hauling: ₱1.50 per kilo of net weight for deliveries collected at a purok pickup point.",
  R3: "Loan repayment: only with a signed Authority to Deduct on file, and not more than 50% of the member's quality bonus.",
  R4: "Cash advance: only against a numbered voucher, and not more than 30% of the member's quality bonus.",
  R5: "The Chairperson shall co-sign any payout batch over US$300, any member line over US$150, and any override of a hold.",
  R6: "Verified kilos must agree with kilos shipped within ±2.0%. A member's season kilos may not exceed 1.6 kg per registered tree. Any reading below 0.85 confidence shall be confirmed by a person.",
  CLOSED:
    "No deduction other than those in this Schedule shall be applied to any member payout. This Schedule shall not be amended during Season 2026-A.",
};
const textLayer: TextLayer = {
  document: "BR-2026-04",
  pages: [
    {
      page: 1,
      text:
        "BOARD RESOLUTION NO. BR 2026-04\nRatified 14 March 2026\n\nSchedule A\n\nR0  " +
        R.R0 +
        "\nR1  " +
        R.R1 +
        "\nR2  " +
        R.R2,
    },
    { page: 2, text: `R3  ${R.R3}\nR4  ${R.R4}\nR5  ${R.R5}\nR6  ${R.R6}\n${R.CLOSED}` },
  ],
};

const box = { x1: 10, y1: 10, x2: 900, y2: 60 };
function term(
  t: Partial<Term> & Pick<Term, "rule_id" | "kind" | "basis">,
  page: number,
  quote: string,
): Term {
  return {
    pool: "NONE",
    value_as_written: "",
    cap_as_written: "",
    condition_as_written: "",
    requires_document: "NONE",
    source: { page, box, quote },
    ...t,
  };
}
const goodRead: RateCardRead = {
  resolution_no: "BR 2026-04",
  ratified_on_as_written: "14 March 2026",
  terms: [
    term({ rule_id: "R0", kind: "SHARE", pool: "PREMIUM", basis: "VERIFIED_KG" }, 1, R.R0),
    term({ rule_id: "R0", kind: "SHARE", pool: "BONUS", basis: "VERIFIED_G1_KG" }, 1, R.R0),
    term(
      {
        rule_id: "R1",
        kind: "DEDUCTION",
        basis: "PCT_OF_BONUS",
        value_as_written: "5%",
        cap_as_written: "₱5,000",
      },
      1,
      R.R1,
    ),
    term(
      {
        rule_id: "R2",
        kind: "DEDUCTION",
        basis: "PER_NET_KG",
        value_as_written: "₱1.50 per kilo",
        condition_as_written: "for deliveries collected at a purok pickup point",
      },
      1,
      R.R2,
    ),
    term(
      {
        rule_id: "R3",
        kind: "DEDUCTION",
        basis: "PCT_OF_BONUS",
        cap_as_written: "50%",
        requires_document: "AUTHORITY_TO_DEDUCT",
      },
      2,
      R.R3,
    ),
    term(
      {
        rule_id: "R4",
        kind: "DEDUCTION",
        basis: "PCT_OF_BONUS",
        cap_as_written: "30%",
        requires_document: "VOUCHER",
      },
      2,
      R.R4,
    ),
    term({ rule_id: "R5", kind: "COSIGN", basis: "BATCH_TOTAL", value_as_written: "US$300" }, 2, R.R5),
    term({ rule_id: "R5", kind: "COSIGN", basis: "LINE_TOTAL", value_as_written: "US$150" }, 2, R.R5),
    term({ rule_id: "R5", kind: "COSIGN", basis: "OVERRIDE" }, 2, R.R5),
    term({ rule_id: "R6", kind: "TOLERANCE", basis: "MASS_BALANCE", value_as_written: "±2.0%" }, 2, R.R6),
    term(
      {
        rule_id: "R6",
        kind: "TOLERANCE",
        basis: "KG_PER_TREE",
        value_as_written: "1.6 kg per registered tree",
      },
      2,
      R.R6,
    ),
    term({ rule_id: "R6", kind: "TOLERANCE", basis: "READ_CONFIDENCE", value_as_written: "0.85" }, 2, R.R6),
    term({ rule_id: "CLOSED", kind: "CLOSED_LIST", basis: "NONE" }, 2, R.CLOSED),
  ],
  signatories: [
    { role: "SECRETARY", name_as_written: "Ma. Theresa L. Gumapac", signed: "YES" },
    { role: "CHAIR", name_as_written: "Ernesto P. Cabahug", signed: "YES" },
  ],
  anomalies: [],
};

describe("value parsers (values are re-parsed by code)", () => {
  it("parses each basis into typed integers", () => {
    expect(parsePercent("5%")).toBe(500);
    expect(parsePercent("±2.0%")).toBe(200);
    expect(parsePeso("₱1.50 per kilo")).toBe(150);
    expect(parsePeso("P5,000")).toBe(500000);
    expect(parseUsd("US$300")).toBe(30000);
    expect(parseKgPerTree("1.6 kg per registered tree")).toBe(16);
    expect(parseConfidence("0.85")).toBe(8500);
    expect(parseCap("₱5,000")).toEqual({ ok: true, value: { unit: "centavos", value: 500000 } });
    expect(parseCap("50%")).toEqual({ ok: true, value: { unit: "bp", value: 5000 } });
    expect(parseValue("PER_NET_KG", "₱1.50 per kilo")).toEqual({
      ok: true,
      value: { unit: "centavos_per_kg", value: 150 },
    });
  });
  it("refuses ambiguous or missing values", () => {
    expect(parsePercent("5% or 6%")).toBeNull();
    expect(parseValue("BATCH_TOTAL", "three hundred dollars").ok).toBe(false);
    expect(parseCap("₱5,000 or 50%").ok).toBe(false);
  });
});

describe("checkRateCard (S4.3 checks)", () => {
  it("a faithful read of Schedule A passes every check with typed values", () => {
    const d = checkRateCard(goodRead, textLayer);
    expect(d.ok).toBe(true);
    expect(d.terms.map((t) => [t.rule_id, t.basis, t.value, t.cap])).toEqual([
      ["R0", "VERIFIED_KG", { unit: "none" }, { unit: "none" }],
      ["R0", "VERIFIED_G1_KG", { unit: "none" }, { unit: "none" }],
      ["R1", "PCT_OF_BONUS", { unit: "bp", value: 500 }, { unit: "centavos", value: 500000 }],
      ["R2", "PER_NET_KG", { unit: "centavos_per_kg", value: 150 }, { unit: "none" }],
      ["R3", "PCT_OF_BONUS", { unit: "none" }, { unit: "bp", value: 5000 }],
      ["R4", "PCT_OF_BONUS", { unit: "none" }, { unit: "bp", value: 3000 }],
      ["R5", "BATCH_TOTAL", { unit: "cents", value: 30000 }, { unit: "none" }],
      ["R5", "LINE_TOTAL", { unit: "cents", value: 15000 }, { unit: "none" }],
      ["R5", "OVERRIDE", { unit: "none" }, { unit: "none" }],
      ["R6", "MASS_BALANCE", { unit: "bp", value: 200 }, { unit: "none" }],
      ["R6", "KG_PER_TREE", { unit: "tenths_kg_per_tree", value: 16 }, { unit: "none" }],
      ["R6", "READ_CONFIDENCE", { unit: "bp", value: 8500 }, { unit: "none" }],
      ["CLOSED", "NONE", { unit: "none" }, { unit: "none" }],
    ]);
  });

  it("ADR 0003: terms are keyed by (rule_id, pool, basis), so R5's three thresholds are three terms", () => {
    const r5 = goodRead.terms.filter((t) => t.rule_id === "R5");
    expect(new Set(r5.map((t) => `${t.rule_id}|${t.pool}`)).size).toBe(1);
    expect(new Set(r5.map(termKey)).size).toBe(3);
    const d = checkRateCard(goodRead, textLayer);
    expect(d.terms.filter((t) => t.rule_id === "R5" || t.rule_id === "R6").every((t) => t.ok)).toBe(true);
  });

  it("only whitespace and quote marks are normalised when matching quotes", () => {
    expect(normaliseQuote("member’s   paid-up\nCBU")).toBe("member's paid-up CBU");
    const curly = structuredClone(goodRead);
    (curly.terms[2] as Term).source.quote = R.R1.replace("member's", "member’s").replace(" ", "\n  ");
    expect(checkRateCard(curly, textLayer).terms[2]?.ok).toBe(true);
  });

  it("flags a quote not in the text layer, a value not in its quote, and a changed number", () => {
    const bad = structuredClone(goodRead);
    (bad.terms[3] as Term).value_as_written = "₱2.00 per kilo";
    (bad.terms[2] as Term).source.quote = R.R1.replace("5%", "8%");
    (bad.terms[6] as Term).source.page = 1;
    const d = checkRateCard(bad, textLayer);
    expect(d.ok).toBe(false);
    expect(d.terms[3]?.checks.map((c) => c.code)).toEqual(["VALUE_NOT_IN_QUOTE"]);
    expect(d.terms[2]?.checks.map((c) => c.code)).toContain("QUOTE_NOT_IN_TEXT_LAYER");
    expect(d.terms[6]?.checks.map((c) => c.code)).toEqual(["QUOTE_NOT_IN_TEXT_LAYER"]);
  });

  it("a handwritten amendment never becomes a term, and duplicates are flagged", () => {
    const amended = structuredClone(goodRead);
    const handwriting = {
      kind: "HANDWRITTEN_AMENDMENT" as const,
      page: 2,
      box: { x1: 100, y1: 800, x2: 400, y2: 840 },
      verbatim: "Iba pa ₱150",
    };
    amended.anomalies.push(handwriting);
    amended.terms.push(
      term(
        { rule_id: "R7", kind: "DEDUCTION", basis: "PCT_OF_BONUS", value_as_written: "₱150" },
        2,
        "Iba pa ₱150",
      ),
    );
    amended.terms.push(structuredClone(goodRead.terms[3] as Term));
    const d = checkRateCard(amended, textLayer);
    expect(d.amendments).toEqual([handwriting]);
    const r7 = d.terms.find((t) => t.rule_id === "R7");
    expect(r7?.checks.map((c) => c.code)).toEqual(
      expect.arrayContaining(["FROM_AMENDMENT", "QUOTE_NOT_IN_TEXT_LAYER"]),
    );
    expect(d.terms.filter((t) => t.checks.some((c) => c.code === "DUPLICATE_TERM"))).toHaveLength(2);
  });
});

describe("readRateCard (AI-5) through the gateway", () => {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it("sends both pages in one streamed Opus request at medium effort and checks the result", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post("https://api.anthropic.com/v1/messages", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return new HttpResponse(sseBody(JSON.stringify(goodRead)), { headers: SSE_HEADERS });
      }),
    );
    const gateway = new ClaudeGateway({
      store: new MemoryReplayStore(),
      apiKey: "test-key",
      maxRetries: 0,
      flags: staticFlags({}),
      spend: new MemorySpendMeter(),
      semaphore: new Semaphore(6),
    });
    const out = await readRateCard(
      { documentId: "BR-2026-04", pages: [await plainPage(1), await plainPage(2)], textLayer },
      { gateway, mode: "auto", lane: "dev" },
    );
    expect(out.draft.ok).toBe(true);
    expect(body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium" },
      stream: true,
    });
    const content =
      (body.messages as Array<{ content: Array<{ type: string; text?: string }> }>)[0]?.content ?? [];
    expect(content.filter((c) => c.type === "image")).toHaveLength(2);
    expect(content.map((c) => c.text).filter(Boolean)).toEqual([
      "Page 1:",
      "Page 2:",
      "Read every rule of the rate card on these pages.",
    ]);
    expect(JSON.stringify(body)).not.toContain("Schedule A\\n\\nR0");
  });
});
