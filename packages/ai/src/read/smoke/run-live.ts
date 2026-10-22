// SMOKE ONLY (spike S3 prerequisite): reads A and B, live once, on the three synthetic smoke images.
// Responses are recorded (scrubbed) as replay fixtures under test/fixtures-smoke/recordings/; a second
// run replays them at no cost. Spend is capped and metered in packages/ai/.cache/ (never committed).
// Run: `corepack pnpm --filter @fairsplit/ai smoke:live`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ClaudeGateway,
  envFlagSource,
  FileSpendMeter,
  FsReplayStore,
  type GatewayResult,
  JsonlCallLedger,
  loadEnv,
  type Recording,
  usd,
} from "../../gateway/index.js";
import type { PhotoFixture } from "../_shims/contracts.js";
import {
  agreement,
  normaliseDeduction,
  normaliseField,
  type ScoredRead,
  validateField,
} from "../_shims/domain.js";
import { type ReadDeps, readVariant } from "../calls.js";
import { centre, centreInRect, contains, iou, isZeroBox, toPixels, width } from "../geometry.js";
import { prepareImage } from "../prep.js";
import { type Extraction, ROW_FIELDS, type Row, type RowField } from "../schema.js";
import { SMOKE_DIR, SMOKE_IMAGES } from "./make-images.js";

const CACHE = fileURLToPath(new URL("../../../.cache/", import.meta.url));
const CAP_USD = 1.5;

interface Truth {
  serial: string;
  values: Partial<Record<RowField, string>>;
  deductions: string[];
  overwritten: { field: RowField; from: string } | null;
  smudged: { field: RowField; charIndex: number } | null;
  marginNote: string | null;
}

export interface CallMetrics {
  image: string;
  variant: "A" | "B";
  provenance: string;
  model_served: string;
  stop_reason: string | null;
  latency_ms: number;
  first_delta_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number | null;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
}

function metricsOf(
  image: string,
  variant: "A" | "B",
  r: GatewayResult,
  rec: Recording | undefined,
): CallMetrics {
  return {
    image,
    variant,
    provenance: r.provenance,
    model_served: r.modelServed,
    stop_reason: r.stopReason,
    latency_ms: r.latencyMs,
    first_delta_ms: rec?.first_delta_ms ?? null,
    input_tokens: r.usage.input_tokens,
    output_tokens: r.usage.output_tokens,
    thinking_tokens: r.usage.thinking_tokens,
    cache_read_input_tokens: r.usage.cache_read_input_tokens,
    cache_creation_input_tokens: r.usage.cache_creation_input_tokens,
    cost_usd: usd(r.recordedCostMicros),
  };
}

/** Field-level scoring of one read against the drawn values and the fixture rectangles. */
export function scoreRead(ex: Extraction, fixture: PhotoFixture, truth: Truth[], w: number, h: number) {
  let boxes = 0;
  let boxesInside = 0;
  let iouSum = 0;
  let values = 0;
  let valuesRight = 0;
  const misses: string[] = [];
  const matched: Array<{ slip: number; row: Row | null }> = fixture.slips.map((s, i) => {
    const rect = toPixels(s.rect, w, h);
    const row = ex.rows.find((r) => !isZeroBox(r.slip_box) && contains(rect, centre(r.slip_box))) ?? null;
    return { slip: i, row };
  });
  for (const { slip, row } of matched) {
    const fx = fixture.slips[slip] as PhotoFixture["slips"][number];
    const t = truth[slip] as Truth;
    const slipW = width(toPixels(fx.rect, w, h));
    if (!row) {
      misses.push(`slip ${fx.serial}: no row`);
      continue;
    }
    for (const f of ROW_FIELDS) {
      const rect = fx.fields[f];
      const read = row[f];
      if (rect && read.legibility !== "ABSENT" && !isZeroBox(read.box)) {
        boxes++;
        const px = toPixels(rect, w, h);
        if (centreInRect(read.box, px, slipW)) boxesInside++;
        else misses.push(`slip ${fx.serial} ${f}: box centre outside its cell`);
        iouSum += iou(read.box, px);
      }
      const want = t.values[f];
      if (want === undefined || want === "") continue;
      values++;
      const got = normaliseField(f, read.value_text);
      const exp = normaliseField(f, want);
      if (got && exp && got.key === exp.key) valuesRight++;
      else
        misses.push(
          `slip ${fx.serial} ${f}: read ${JSON.stringify(read.value_text)} (${read.legibility}), drawn ${JSON.stringify(want)}`,
        );
    }
    const ded = row.deductions.map((d) => normaliseDeduction(d.value_text));
    const dedWant = t.deductions.map(normaliseDeduction);
    values += dedWant.length;
    valuesRight += dedWant.filter((d, i) => ded[i] === d).length;
    if (JSON.stringify(ded) !== JSON.stringify(dedWant))
      misses.push(
        `slip ${fx.serial} deductions: read ${JSON.stringify(ded)}, drawn ${JSON.stringify(dedWant)}`,
      );
  }
  return {
    boxes,
    boxesInside,
    meanIou: boxes ? iouSum / boxes : 0,
    values,
    valuesRight,
    misses,
    rows: ex.rows.length,
  };
}

async function main(): Promise<void> {
  const env = loadEnv(process.cwd(), ["ANTHROPIC_API_KEY"]);
  console.log(
    `env: ${env.file ? "loaded .env" : "no .env"}; ANTHROPIC_API_KEY ${env.present.ANTHROPIC_API_KEY ? "present" : "MISSING"}`,
  );
  const store = new FsReplayStore(`${SMOKE_DIR}recordings`);
  const gateway = new ClaudeGateway({
    store,
    ledger: new JsonlCallLedger(`${CACHE}smoke-ledger.jsonl`),
    spend: new FileSpendMeter(`${CACHE}spend.jsonl`),
    flags: envFlagSource(),
    caps: { daily: CAP_USD },
  });
  const deps: ReadDeps = { gateway, mode: "auto", budget: "daily", budgetScope: "ws-read-smoke" };
  const calls: CallMetrics[] = [];
  const perImage: Record<string, unknown> = {};

  for (const img of SMOKE_IMAGES) {
    const bytes = readFileSync(`${SMOKE_DIR}${img.file}`);
    const fixture = JSON.parse(readFileSync(`${SMOKE_DIR}${img.id}.fixture.json`, "utf8")) as PhotoFixture;
    const truth = JSON.parse(readFileSync(`${SMOKE_DIR}${img.id}.truth.json`, "utf8")) as Truth[];
    const prep = await prepareImage(bytes);
    const kind = fixture.slips.length > 1 ? "photo" : "page";
    const t0 = performance.now();
    const [a, b] = await Promise.all(
      (["A", "B"] as const).map((variant) =>
        readVariant(
          {
            variant,
            jpeg: prep[variant],
            identity: prep.identity[variant],
            sentSha: prep.sentSha[variant],
            kind,
            seasonLabel: "Season 2026-A",
          },
          deps,
        ),
      ),
    );
    if (!a || !b) throw new Error("reads missing");
    const wall = Math.round(performance.now() - t0);
    for (const [variant, r] of [
      ["A", a],
      ["B", b],
    ] as const) {
      calls.push(metricsOf(img.id, variant, r.result, await store.get(r.result.cacheKey)));
    }
    const sA = scoreRead(a.extraction, fixture, truth, prep.width, prep.height);
    const sB = scoreRead(b.extraction, fixture, truth, prep.width, prep.height);
    // Agreement without zoom (the zoom is not part of this smoke run).
    const registry = new Map(
      truth.map((t) => [
        t.values.member_no ?? "",
        { memberNo: t.values.member_no ?? "", name: t.values.member_name ?? "" },
      ]),
    );
    const rules: Record<string, number> = {};
    let unsafe = 0;
    fixture.slips.forEach((fx, i) => {
      const rect = toPixels(fx.rect, prep.width, prep.height);
      const ra = a.extraction.rows.find((r) => contains(rect, centre(r.slip_box)));
      const rb = b.extraction.rows.find((r) => contains(rect, centre(r.slip_box)));
      if (!ra || !rb) return;
      for (const f of ROW_FIELDS) {
        if (f === "line_no") continue;
        const sr = (r: Row): ScoredRead => {
          const n =
            r[f].legibility === "ABSENT" || r[f].legibility === "ILLEGIBLE"
              ? null
              : normaliseField(f, r[f].value_text);
          const box = fx.fields[f]
            ? centreInRect(r[f].box, toPixels(fx.fields[f], prep.width, prep.height), width(rect))
            : true;
          return {
            legibility: r[f].legibility,
            raw: r[f].value_text,
            norm: n,
            valid:
              n !== null &&
              validateField(
                f,
                n,
                { registry, season: { from: "2026-04-01", to: "2026-08-31" } },
                ra.member_no.value_text,
              ) === null &&
              box,
          };
        };
        const o = agreement(sr(ra), sr(rb), undefined, { required: f !== "clerk_initials" });
        if (!o) continue;
        rules[`rule${o.rule}`] = (rules[`rule${o.rule}`] ?? 0) + 1;
        const want = (truth[i] as Truth).values[f] ?? "";
        const exp = normaliseField(f, want);
        if (o.score >= 0.85 && (!exp || exp.value !== o.value)) unsafe++;
      }
    });
    const flagged = (ex: Extraction) =>
      ex.anomalies.filter((x) => x.kind === "INSTRUCTION_LIKE_TEXT").map((x) => x.verbatim);
    perImage[img.id] = {
      size: [prep.width, prep.height],
      visual_tokens: prep.visualTokens,
      wall_ms_parallel: wall,
      page_A: a.extraction.page,
      page_B: b.extraction.page,
      score_A: sA,
      score_B: sB,
      agreement_rules: rules,
      unsafe_auto_accepts: unsafe,
      instruction_like_text: { A: flagged(a.extraction), B: flagged(b.extraction) },
      legibility: Object.fromEntries(
        (["A", "B"] as const).map((v) => [
          v,
          (v === "A" ? a : b).extraction.rows.map((r) => ({
            serial: r.serial.value_text,
            copy: r.copy,
            grade: `${r.grade.value_text} ${r.grade.legibility} from:${r.grade.overwritten_from}`,
            net: `${r.net_kg.value_text} ${r.net_kg.legibility}`,
            signature: r.signature,
          })),
        ]),
      ),
    };
  }

  const total = calls.reduce((s, c) => s + c.cost_usd, 0);
  const allBoxes = Object.values(perImage).reduce<{ n: number; inside: number }>(
    (acc, v) => {
      const x = v as {
        score_A: { boxes: number; boxesInside: number };
        score_B: { boxes: number; boxesInside: number };
      };
      return {
        n: acc.n + x.score_A.boxes + x.score_B.boxes,
        inside: acc.inside + x.score_A.boxesInside + x.score_B.boxesInside,
      };
    },
    { n: 0, inside: 0 },
  );
  const report = {
    note: "SMOKE ONLY: synthetic images drawn by code; never part of the eval set (C-24).",
    generated_at: new Date().toISOString(),
    model: "claude-opus-5-5",
    effort: "low",
    calls,
    totals: {
      cost_usd: Number(total.toFixed(4)),
      box_centres_inside: allBoxes.inside,
      boxes: allBoxes.n,
      box_centre_rate: allBoxes.n ? Number((allBoxes.inside / allBoxes.n).toFixed(4)) : null,
    },
    images: perImage,
  };
  writeFileSync(`${SMOKE_DIR}report.json`, `${JSON.stringify(report, null, 2)}\n`);
  for (const c of calls) {
    console.log(
      `${c.image} ${c.variant} ${c.provenance} ${c.model_served} stop=${c.stop_reason} ${c.latency_ms}ms first=${c.first_delta_ms}ms in=${c.input_tokens} out=${c.output_tokens} think=${c.thinking_tokens} cacheR=${c.cache_read_input_tokens} cacheW=${c.cache_creation_input_tokens} $${c.cost_usd.toFixed(4)}`,
    );
  }
  console.log(
    `total recorded cost US$${total.toFixed(4)}; box centres inside ${allBoxes.inside}/${allBoxes.n}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
