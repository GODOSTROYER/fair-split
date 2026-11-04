import { z } from "zod";
import { NQuad } from "../fixtures/schema.js";
import { COPY_COLOURS } from "../template/slip-template.js";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const matrix = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);

export const Placement = z
  .object({
    slot: z.enum(["TL", "TR", "BL", "BR"]),
    serial: z.string().regex(/^\d{4}$/),
    copy: z.enum(COPY_COLOURS),
    synthetic: z.literal(true),
    kind: z.enum(["hero-flat", "code-drawn"]),
    label: z.enum(["Codex-made · synthetic", "code-drawn · synthetic"]),
    sourceFile: z.string(),
    sourceSha256: hash,
    sourceFixture: z.string(),
    sourceFixtureSha256: hash,
    sourceQuad: NQuad,
    targetQuad: NQuad,
    /** Full source image normalised coordinates -> photo normalised coordinates (row-major homography). */
    transform: matrix,
    seedDifferences: z.array(z.object({ field: z.string(), seed: z.string(), visible: z.string() })),
  })
  .refine((p) => p.label === (p.kind === "hero-flat" ? "Codex-made · synthetic" : "code-drawn · synthetic"), {
    message: "the synthetic source label must match how the slip was made",
    path: ["label"],
  });
export type Placement = z.infer<typeof Placement>;

export const Composition = z.object({
  id: z.string().regex(/^[A-L]$/),
  synthetic: z.literal(true),
  label: z.literal("Code-composed · synthetic"),
  renderer: z.literal("desk-photo-v2"),
  contentSha256: hash,
  caption: z.object({
    file: z.string(),
    sha256: hash,
    textSha256: hash,
    synthetic: z.literal(true),
    label: z.literal("code-drawn · synthetic"),
  }),
  template: z.object({ file: z.literal("template/slip-v1.json"), sha256: hash }),
  image: z.object({
    file: z.string(),
    sha256: hash,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    bytes: z.number().int().positive(),
  }),
  fixture: z.string(),
  fixtureSha256: hash,
  light: z.object({ topLeftGain: z.number(), bottomRightGain: z.number() }),
  shadow: z.object({ offsetX: z.number(), offsetY: z.number(), blur: z.number(), opacity: z.number() }),
  placements: z.tuple([Placement, Placement, Placement, Placement]),
});
export type Composition = z.infer<typeof Composition>;
