import { z } from "zod";
import { COPY_COLOURS, SLIP_FIELDS } from "../template/slip-template.js";

/**
 * Reviewed crop fixtures (IC-11: `media/fixtures/{photo}.json`): for each image, every slip's serial,
 * copy colour, corner quad and one rectangle per field. Rectangles are normalised to 0–1 of the image as
 * stored in `image.master` (S4 deviation 6) with the origin top-left, so they apply unchanged to the
 * display WebP. Fixtures are the only source of crops (C-10); model boxes never are.
 *
 * A fixture moves `draft → agent-checked → human-reviewed`. Only a person can set `human-reviewed`
 * (register section 11, "Checking image labels"); consumers must show anything less as pending review.
 */

export const NRect = z
  .object({
    x1: z.number().min(0).max(1),
    y1: z.number().min(0).max(1),
    x2: z.number().min(0).max(1),
    y2: z.number().min(0).max(1),
  })
  .refine((r) => r.x2 > r.x1 && r.y2 > r.y1, { message: "rectangle must have x2 > x1 and y2 > y1" });
export type NRect = z.infer<typeof NRect>;

const NPoint = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

/** Slip corners, normalised: top-left, top-right, bottom-right, bottom-left (the reviewer's four clicks). */
export const NQuad = z.tuple([NPoint, NPoint, NPoint, NPoint]);

export const Legibility = z.enum(["CLEAR", "SMUDGED", "OVERWRITTEN", "ILLEGIBLE", "ABSENT"]);

/** What a reader should do with a field (S4.10 labels): auto-accept, route to a person, or either. */
export const Expect = z.enum(["AUTO", "HUMAN", "EITHER"]);

export const FieldFixture = z.object({
  rect: NRect,
  /** The value the content spec asked for (seed truth). */
  value: z.string(),
  /** What is visibly written, as the reviewer reads it; "?" marks each unreadable character. */
  visible: z.string(),
  legibility: Legibility,
  expect: Expect,
});
export type FieldFixture = z.infer<typeof FieldFixture>;

export const SlipFieldName = z.enum(SLIP_FIELDS);

export const SlipFixture = z.object({
  position: z.enum(["TL", "TR", "BL", "BR", "FULL"]),
  serial: z.string().regex(/^\d{4}$/),
  copy: z.enum(COPY_COLOURS),
  quad: NQuad,
  fields: z.record(SlipFieldName, FieldFixture),
  traps: z.array(z.string()),
  duplicateOf: z.string().nullable(),
});
export type SlipFixture = z.infer<typeof SlipFixture>;

export const ImageRef = z.object({
  master: z.string(),
  display: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const FixtureReview = z.object({
  status: z.enum(["draft", "agent-checked", "human-reviewed"]),
  /** How rectangles were made, e.g. "grid-detect v1 (ruled lines snapped), visual check of every crop". */
  method: z.string(),
  reviewer: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  notes: z.array(z.string()),
});
export type FixtureReview = z.infer<typeof FixtureReview>;

const Base = {
  v: z.literal(1),
  id: z.string().min(1),
  /** I8: every fixture describes a synthetic image. */
  synthetic: z.literal(true),
  image: ImageRef,
  review: FixtureReview,
};

export const SlipImageFixture = z
  .object({
    ...Base,
    kind: z.enum(["slip_photo", "slip_page"]),
    template: z.literal("slip-v1"),
    slips: z.array(SlipFixture).min(1).max(4),
  })
  .superRefine((f, ctx) => {
    for (const [i, s] of f.slips.entries()) {
      const missing = SLIP_FIELDS.filter((name) => !s.fields[name]);
      if (missing.length)
        ctx.addIssue({
          code: "custom",
          path: ["slips", i, "fields"],
          message: `missing fields: ${missing.join(", ")}`,
        });
    }
    if (f.kind === "slip_page" && (f.slips.length !== 1 || f.slips[0]?.position !== "FULL")) {
      ctx.addIssue({
        code: "custom",
        path: ["slips"],
        message: "a slip_page fixture holds exactly one FULL slip",
      });
    }
    if (f.kind === "slip_photo") {
      const pos = f.slips.map((s) => s.position).sort();
      if (pos.join() !== "BL,BR,TL,TR")
        ctx.addIssue({ code: "custom", path: ["slips"], message: "a slip_photo has TL, TR, BL and BR" });
    }
  });
export type SlipImageFixture = z.infer<typeof SlipImageFixture>;

/** A Schedule A clause on a BR 2026-04 page: the hover target on C2 and the source box for AI-5's checks. */
export const ClauseFixture = z.object({
  id: z.string(),
  rect: NRect,
  text: z.string(),
});

export const RateCardPageFixture = z.object({
  ...Base,
  kind: z.literal("rate_card_page"),
  page: z.number().int().positive(),
  textLayer: z.string(),
  blocks: z.array(ClauseFixture).min(1),
});
export type RateCardPageFixture = z.infer<typeof RateCardPageFixture>;

export const LogbookCell = z.object({ rect: NRect, value: z.string(), visible: z.string() });

export const LogbookPageFixture = z.object({
  ...Base,
  kind: z.literal("logbook_page"),
  page: z.number().int().positive(),
  columns: z.array(z.string()).min(1),
  lines: z.array(
    z.object({
      line: z.number().int().positive(),
      rect: NRect,
      serial: z.string(),
      cells: z.record(z.string(), LogbookCell),
    }),
  ),
});
export type LogbookPageFixture = z.infer<typeof LogbookPageFixture>;

export const Fixture = z.union([SlipImageFixture, RateCardPageFixture, LogbookPageFixture]);
export type Fixture = z.infer<typeof Fixture>;

/** JSON Schema for non-TypeScript consumers, written to media/fixtures/fixture.schema.json. */
export function fixtureJsonSchema(): unknown {
  return z.toJSONSchema(z.union([SlipImageFixture, RateCardPageFixture, LogbookPageFixture]), {
    unrepresentable: "any",
    io: "input",
  });
}
