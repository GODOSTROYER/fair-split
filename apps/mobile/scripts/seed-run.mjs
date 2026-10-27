// The co-sign run of the seed snapshot, copied into the app's demo fixture.
//
// The demo co-sign request has to be the seed's run r37 to the byte: the Chair's phone recomputes its batch hash,
// every member line's hash and the lines digest with WS-CORE's functions, and the judge compares the hash with the
// console's. The app may not import @fairsplit/seed (register §6, dependency-cruiser `layer-ui`), so this script
// copies what the co-sign needs from `packages/seed/snapshot/season-2026A.json` into `src/_shims/seed-run.json`, and
// `seed-run.test.mjs` fails whenever the copy and the snapshot differ. After WS-CORE regenerates the snapshot:
//
//   node scripts/seed-run.mjs            (then: corepack pnpm exec biome format --write src/_shims/seed-run.json)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SNAPSHOT = new URL("../../../packages/seed/snapshot/season-2026A.json", import.meta.url);
export const OUT = new URL("../src/_shims/seed-run.json", import.meta.url);

/**
 * What the demo co-sign carries, nothing more: the run's identity, its PayPal batch items and every member line with
 * the content its hash covers (contracts `ProofLine`, narrowed to what the phone checks).
 */
export function extractSeedRun(snapshot) {
  const { run, season, rateCard, proof } = snapshot;
  return {
    source: "packages/seed/snapshot/season-2026A.json",
    runId: run.id,
    runSlug: run.runSlug,
    seasonId: season.id,
    rateCardSha256: rateCard.sha256,
    senderBatchId: run.senderBatchId,
    items: run.items.map((i) => ({
      senderItemId: i.senderItemId,
      receiver: i.receiver,
      amountCents: i.amountCents,
      currency: i.currency,
      memberNo: i.memberNo,
    })),
    lines: proof.lines.map((l) => ({
      memberNo: l.memberNo,
      rail: l.rail,
      netCents: l.netCents,
      canonical: l.canonical,
      lineSha256: l.lineSha256,
    })),
  };
}

export function readSnapshot() {
  return JSON.parse(readFileSync(SNAPSHOT, "utf8"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(OUT, `${JSON.stringify(extractSeedRun(readSnapshot()), null, 2)}\n`);
  process.stdout.write(`wrote ${fileURLToPath(OUT)}\n`);
}
