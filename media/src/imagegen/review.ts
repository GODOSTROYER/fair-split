import { z } from "zod";
import { intendedExpect } from "../fixtures/build.js";
import {
  Expect,
  type FieldFixture,
  type Fixture,
  LEGIBILITY,
  LOGBOOK_COLUMNS,
  type LogbookPageFixture,
  SLOTS,
  type SlipImageFixture,
  slipFieldEntries,
} from "../fixtures/schema.js";
import { currentMasterAttempt, type FieldMatch, type ManifestStore } from "./manifest.js";

/**
 * A recorded visual check of generated images by an agent (media/review/*.json). For each image,
 * identified by its sha256 prefix: how many written values were checked and which did not show what the
 * prompt asked for. A version-2 file also records, for an accepted master, what each field visibly shows
 * and whether every crop rectangle was checked. `apply-review` copies the counts into the manifest and the
 * observations into the image's fixture as `checkedBy: "agent"`; a fixture whose every field and crop an
 * agent checked becomes `agent-checked`. An agent's check never replaces a person's (C-24): fields a person
 * checked in `imagegen review` are kept, and only a person at a terminal can make a fixture
 * `human-reviewed`.
 *
 * `where` names a field: on a one-slip page `fields.gross_kg`, `deductions.0`, `signature` or
 * `anomalies.0`; on a four-slip photo the same with the slot first (`BR.fields.gross_kg`); on a logbook
 * page `line 7.net_kg`. Version-1 files (22 Oct) predate fixtures with observations: they update counts only.
 */
export const Observation = z.object({
  where: z.string().min(1),
  visible: z.string(),
  legibility: z.enum(LEGIBILITY),
  expect: Expect.optional(),
  note: z.string().optional(),
});
export type Observation = z.infer<typeof Observation>;

export const AgentTrapObservation = z.object({
  /** The slip's slot (ONLY on a one-slip page). */
  slot: z.enum(SLOTS),
  trap: z.enum(["WATER_STAIN", "MARGIN_NOTE"]),
  /** An agent's look can show a trap failed; only a recorded read can show it holds. */
  status: z.literal("FAILED"),
  evidence: z.string().min(1),
});

const ReviewImage = z.object({
  asset: z.string(),
  sha256Prefix: z.string().regex(/^[0-9a-f]{8,64}$/),
  promptVersion: z.string(),
  checked: z.number().int().positive(),
  /** Values that differ from what the prompt asked for. */
  mismatches: z.array(
    z.object({ where: z.string(), expected: z.string(), visible: z.string(), cause: z.string() }),
  ),
  /**
   * Every field of the image was checked, so fields not listed under `observed` (or `mismatches`) show
   * exactly what was requested: CLEAR, SMUDGED where the request washes characters out, ABSENT where blank.
   */
  allFieldsChecked: z.boolean().default(false),
  /** Every crop rectangle of the fixture was looked at on the crop sheet and overlay. */
  cropsChecked: z.boolean().default(false),
  /** Fields whose crop does not hold exactly its box (the fixture must be redrafted). */
  cropIssues: z.array(z.string()).default([]),
  observed: z.array(Observation).default([]),
  traps: z.array(AgentTrapObservation).default([]),
  notes: z.array(z.string()).default([]),
});
type ReviewImageOut = z.output<typeof ReviewImage>;

export const ReviewFile = z
  .object({
    v: z.union([z.literal(1), z.literal(2)]),
    reviewer: z.string(),
    method: z.string(),
    reviewedAt: z.string(),
    images: z.array(ReviewImage),
  })
  .superRefine((r, ctx) => {
    if (r.v !== 1) return;
    r.images.forEach((img, i) => {
      if (img.allFieldsChecked || img.cropsChecked || img.observed.length || img.traps.length) {
        ctx.addIssue({
          code: "custom",
          path: ["images", i],
          message: "a version-1 review records counts only; observations need v: 2",
        });
      }
    });
  });
export type ReviewFile = z.input<typeof ReviewFile>;

export function fieldMatchOf(img: {
  checked: number;
  mismatches: { where: string; expected: string; visible: string }[];
}): FieldMatch {
  return {
    matched: img.checked - img.mismatches.length,
    total: img.checked,
    mismatches: img.mismatches.map(({ where, expected, visible }) => ({ where, expected, visible })),
  };
}

/** Legibility of a field that shows exactly what was requested. */
export function defaultLegibility(requested: string): (typeof LEGIBILITY)[number] {
  if (requested === "") return "ABSENT";
  return requested.includes("?") ? "SMUDGED" : "CLEAR";
}

/** Every field of a slip or logbook fixture, keyed by its `where` path. */
export function fixtureFields(f: Fixture): Map<string, FieldFixture> {
  const out = new Map<string, FieldFixture>();
  if (f.kind === "slip_page" || f.kind === "slip_photo") {
    const sf = f as SlipImageFixture;
    for (const s of sf.slips) {
      for (const e of slipFieldEntries(s))
        out.set(sf.kind === "slip_page" ? e.path : `${s.slot}.${e.path}`, e.field);
    }
  } else if (f.kind === "logbook_page") {
    for (const l of (f as LogbookPageFixture).lines) {
      for (const c of LOGBOOK_COLUMNS) out.set(`line ${l.line}.${c}`, l.cells[c]);
    }
  }
  return out;
}

export interface ObservationResult {
  /** Paths (or traps) that matched nothing in the fixture. */
  unplaced: string[];
  /** Fields a person already checked, which an agent's observation does not overwrite. */
  keptHuman: string[];
}

/**
 * Writes observations into a fixture: listed fields take the observed values, mismatches not listed take
 * their visible value, and with `allFieldsChecked` every other field shows what was requested. A field a
 * person checked is never overwritten by an agent. Where the visible value differs from the request and
 * no `expect` is given, the reader may do either (EITHER): a wrong render is relabelled, never "fixed".
 */
export function applyObservations(
  f: Fixture,
  img: Pick<ReviewImageOut, "allFieldsChecked" | "observed" | "mismatches" | "traps">,
  at: string,
  by: "agent" | "human" = "agent",
): ObservationResult {
  const fields = fixtureFields(f);
  const out: ObservationResult = { unplaced: [], keptHuman: [] };
  const seen = new Set<string>();
  const set = (
    path: string,
    o: {
      visible: string;
      legibility: (typeof LEGIBILITY)[number];
      expect?: z.infer<typeof Expect> | undefined;
    },
  ) => {
    const field = fields.get(path);
    if (!field) {
      out.unplaced.push(path);
      return;
    }
    seen.add(path);
    if (by === "agent" && field.checkedBy === "human") {
      out.keptHuman.push(path);
      return;
    }
    field.visible = o.visible;
    field.legibility = o.legibility;
    field.expect = o.expect ?? (o.visible === field.requested ? intendedExpect(field.requested) : "EITHER");
    field.checkedBy = by;
  };
  for (const o of img.observed) set(o.where, o);
  for (const m of img.mismatches) {
    if (seen.has(m.where)) continue;
    set(m.where, { visible: m.visible, legibility: m.visible.includes("?") ? "SMUDGED" : "CLEAR" });
  }
  if (img.allFieldsChecked) {
    for (const [path, field] of fields) {
      if (seen.has(path)) continue;
      set(path, { visible: field.requested, legibility: defaultLegibility(field.requested) });
    }
  }
  if (f.kind === "slip_page" || f.kind === "slip_photo") {
    for (const t of img.traps) {
      const slip = (f as SlipImageFixture).slips.find((s) => s.slot === t.slot);
      const check = slip?.trapChecks.find((c) => c.trap === t.trap);
      if (!check) {
        out.unplaced.push(`${t.slot} trap ${t.trap}`);
        continue;
      }
      // A recorded read's verdict outranks a look.
      if (check.by === "read") continue;
      Object.assign(check, { status: t.status, by, at, evidence: t.evidence });
    }
  }
  return out;
}

export interface ApplyResult {
  /** Images matched to a manifest master or trial. */
  images: number;
  /** Fixtures updated with observations, by asset id. */
  fixtures: string[];
  /** Fixtures that became agent-checked. */
  agentChecked: string[];
  /** Observation paths that matched no field, by asset id. */
  unplaced: Record<string, string[]>;
  /** Fields left as a person checked them, by asset id. */
  keptHuman: Record<string, string[]>;
  /** Masters in the file whose fixture is missing or was drawn on other pixels. */
  skippedFixtures: string[];
}

export interface FixtureIo {
  readFixture: (assetId: string) => Promise<Fixture | null>;
  writeFixture: (f: Fixture) => Promise<void>;
}

/**
 * Records each image's check on its master or trial in the manifest and, for a version-2 file, writes
 * the master's observations into its fixture (`io` is injected for tests). A draft fixture whose fields
 * are all checked, whose crops were all checked and none found wrong becomes `agent-checked`.
 */
export async function applyReview(
  store: ManifestStore,
  input: ReviewFile,
  io?: FixtureIo,
): Promise<ApplyResult> {
  const review = ReviewFile.parse(input);
  const result: ApplyResult = {
    images: 0,
    fixtures: [],
    agentChecked: [],
    unplaced: {},
    keptHuman: {},
    skippedFixtures: [],
  };
  const masters: (ReviewImageOut & { masterSha256: string })[] = [];
  await store.update((m) => {
    for (const img of review.images) {
      const e = m.assets[img.asset];
      if (!e) continue;
      const fm = fieldMatchOf(img);
      // Only a check of the current master's pixels describes it; one of a replaced master measures that
      // image, which is a trial now, below.
      if (e.master && currentMasterAttempt(e)?.output?.sha256.startsWith(img.sha256Prefix)) {
        e.review = {
          status: "agent-checked",
          reviewer: review.reviewer,
          at: review.reviewedAt,
          method: review.method,
          fieldMatch: fm,
          deviations: [
            ...img.mismatches.map(
              (x) => `${x.where}: expected "${x.expected}", visible "${x.visible}" (${x.cause})`,
            ),
            ...img.traps.map((t) => `${t.slot} ${t.trap} trap ${t.status}: ${t.evidence}`),
            ...img.notes,
          ],
        };
        result.images++;
        masters.push({ ...img, masterSha256: e.master.sha256 });
        continue;
      }
      const t = e.trials.find((x) => x.sha256.startsWith(img.sha256Prefix));
      if (t) {
        t.fieldMatch = fm;
        result.images++;
      }
    }
  });
  if (!io || review.v === 1) return result;
  for (const img of masters) {
    const f = await io.readFixture(img.asset);
    // A fixture drawn on an earlier master describes other pixels: leave it for `fixture --force`.
    if (!f || f.image.sha256 !== img.masterSha256) {
      result.skippedFixtures.push(img.asset);
      continue;
    }
    const obs = applyObservations(f, img, review.reviewedAt, "agent");
    if (obs.unplaced.length) result.unplaced[img.asset] = obs.unplaced;
    if (obs.keptHuman.length) result.keptHuman[img.asset] = obs.keptHuman;
    f.review.notes = [
      ...f.review.notes.filter((n) => !n.startsWith("Values checked:")),
      `Values checked: ${review.reviewer}, ${review.reviewedAt}`,
    ];
    if (img.cropIssues.length) {
      f.review.status = "draft";
      f.review.session = null;
      f.review.cropIssues = [...new Set([...f.review.cropIssues, ...img.cropIssues])];
    }
    const allChecked = [...fixtureFields(f).values()].every((x) => x.legibility !== "UNVERIFIED");
    if (f.review.status === "draft" && allChecked && img.cropsChecked && f.review.cropIssues.length === 0) {
      f.review = {
        ...f.review,
        status: "agent-checked",
        reviewer: review.reviewer,
        reviewedAt: review.reviewedAt,
        method: `${f.review.method}; values and crops checked: ${review.method}`,
      };
      result.agentChecked.push(img.asset);
    }
    await io.writeFixture(f);
    result.fixtures.push(img.asset);
  }
  return result;
}
