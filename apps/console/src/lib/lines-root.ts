// IC-02 `linesDigest`, the second digest both keys sign (domain `linesRootSha256`, S3 ledger `lines.computed`):
// sha256 of JCS([{memberNo, lineSha256}]) over every member line of the run, cash lines included, sorted by
// member number. The console computes it from the lines the run serves (W-TR-07), and its mock signs it the same
// way fs-api does.

import { jcs } from "./jcs.js";
import { sha256Hex } from "./sha256.js";

export interface HashedLine {
  readonly memberNo: string;
  readonly lineSha256: string;
}

export function linesRoot(lines: readonly HashedLine[]): string {
  const sorted = lines
    .map((l) => ({ memberNo: l.memberNo, lineSha256: l.lineSha256 }))
    .sort((a, b) => (a.memberNo < b.memberNo ? -1 : a.memberNo > b.memberNo ? 1 : 0));
  return sha256Hex(jcs(sorted));
}
