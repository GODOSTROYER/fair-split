import { z } from "zod";
import type { FieldMatch, ManifestStore } from "./manifest.js";

/**
 * A recorded visual check of generated images: for each image (identified by its sha256 prefix), how
 * many written values were checked and which did not show what the prompt asked for. The file is
 * committed (media/review/*.json) as the evidence behind the value-fidelity numbers; `apply-review`
 * copies the counts into the manifest. An agent's check never replaces the person's review of labels.
 */
export const ReviewFile = z.object({
  v: z.literal(1),
  reviewer: z.string(),
  method: z.string(),
  reviewedAt: z.string(),
  images: z.array(
    z.object({
      asset: z.string(),
      sha256Prefix: z.string().regex(/^[0-9a-f]{8,64}$/),
      promptVersion: z.string(),
      checked: z.number().int().positive(),
      mismatches: z.array(
        z.object({ where: z.string(), expected: z.string(), visible: z.string(), cause: z.string() }),
      ),
      notes: z.array(z.string()).default([]),
    }),
  ),
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

/** Records each image's check on its master or trial; returns how many images matched a manifest entry. */
export async function applyReview(store: ManifestStore, input: ReviewFile): Promise<number> {
  const review = ReviewFile.parse(input);
  let applied = 0;
  await store.update((m) => {
    for (const img of review.images) {
      const e = m.assets[img.asset];
      if (!e) continue;
      const fm = fieldMatchOf(img);
      if (
        e.master?.sha256.startsWith(img.sha256Prefix) ||
        e.attempts.some(
          (a) => a.outcome === "accepted" && a.output?.sha256.startsWith(img.sha256Prefix) && e.master,
        )
      ) {
        const isMaster = e.attempts
          .find((a) => a.outcome === "accepted")
          ?.output?.sha256.startsWith(img.sha256Prefix);
        if (isMaster) {
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
              ...img.notes,
            ],
          };
          applied++;
          continue;
        }
      }
      const t = e.trials.find((x) => x.sha256.startsWith(img.sha256Prefix));
      if (t) {
        t.fieldMatch = fm;
        applied++;
      }
    }
  });
  return applied;
}
