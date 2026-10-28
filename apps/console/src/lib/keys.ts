// Signing keys by their IDs (S3.8, register C-13). Each signing-key kind has exactly one ID shape in IC-01
// (contracts `KEY_ID_PATTERN_BY_KIND`), so the ID alone says what a key is: `fs-analyn-w1` the treasurer's
// persisted browser key (kind `web`, registered once from /ops), `fs-ernesto-a1` the Chair's app key (kind
// `app`), `fs-analyn-demo-k3x9q2` a key made for one judge session (kind `web_demo`, a labelled demo key) and
// `fs-analyn-s1` a seed-only sample key (kind `seeded`). Demo and seeded keys are sample keys: what they sign is
// never called verified (contracts `SAMPLE_KEY_KINDS`).

import { KEY_ID_PATTERN_BY_KIND, SAMPLE_KEY_KINDS, type SigningKeyKind } from "@fairsplit/contracts";

const KINDS = Object.keys(KEY_ID_PATTERN_BY_KIND) as SigningKeyKind[];

/** The kind a key ID's shape names, or null for an ID no signing key can carry. */
export function signingKeyKind(keyId: string): SigningKeyKind | null {
  return KINDS.find((kind) => KEY_ID_PATTERN_BY_KIND[kind].test(keyId)) ?? null;
}

/** True for a demo or seeded key: a sample, never a verified signer. */
export function isSampleKey(keyId: string): boolean {
  const kind = signingKeyKind(keyId);
  return kind !== null && SAMPLE_KEY_KINDS.includes(kind);
}
