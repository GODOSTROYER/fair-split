// @fairsplit/seed (IC-03): typed accessors over the committed season snapshot, so UI workstreams
// render realistic data and no one hard-codes a figure. Everything here is provenance `seeded`.
import {
  type EngineLine,
  type EngineOutput,
  type SeasonSnapshot,
  SeasonSnapshot as SeasonSnapshotSchema,
  type SnapshotHold,
  type SnapshotLogbookPage,
  type SnapshotMember,
  type SnapshotPhoto,
  type SnapshotRun,
  type SnapshotSlip,
} from "@fairsplit/contracts";
import raw from "../snapshot/season-2026A.json" with { type: "json" };

let cached: SeasonSnapshot | null = null;

/** The whole snapshot, validated against the IC-03 schema on first access. */
export function getSnapshot(): SeasonSnapshot {
  if (!cached) cached = SeasonSnapshotSchema.parse(raw);
  return cached;
}

export type Checkpoint = keyof SeasonSnapshot["checkpoints"];

export function getSeason(): SeasonSnapshot["season"] & {
  coop: SeasonSnapshot["coop"];
  officers: SeasonSnapshot["officers"];
  payer: SeasonSnapshot["payer"];
  lot: SeasonSnapshot["lot"];
  fx: SeasonSnapshot["fx"];
  figures: SeasonSnapshot["figures"];
} {
  const s = getSnapshot();
  return {
    ...s.season,
    coop: s.coop,
    officers: s.officers,
    payer: s.payer,
    lot: s.lot,
    fx: s.fx,
    figures: s.figures,
  };
}

export function getMembers(): SnapshotMember[] {
  return getSnapshot().members;
}

export function getMember(memberNo: string): SnapshotMember | undefined {
  return getSnapshot().members.find((m) => m.memberNo === memberNo);
}

/** Every slip image (264), optionally only one member's or one photo's. */
export function getSlips(filter: { memberNo?: string; photoId?: string } = {}): SnapshotSlip[] {
  return getSnapshot().slips.filter(
    (s) =>
      (filter.memberNo === undefined || s.memberNo === filter.memberNo) &&
      (filter.photoId === undefined || s.photoId === filter.photoId),
  );
}

export function getPhotos(set?: "REPLAY" | "EARLIER"): SnapshotPhoto[] {
  return getSnapshot().photos.filter((p) => set === undefined || p.set === set);
}

export function getRateCard(): SeasonSnapshot["rateCard"] {
  return getSnapshot().rateCard;
}

export function getRun(): SnapshotRun {
  return getSnapshot().run;
}

/** Engine output at a checkpoint: after reading, after slip 0462 by hand, or resolved (default). */
export function getComputation(checkpoint: Checkpoint = "resolved"): EngineOutput {
  return getSnapshot().checkpoints[checkpoint];
}

export function getLines(checkpoint: Checkpoint = "resolved"): EngineLine[] {
  return getComputation(checkpoint).lines;
}

export function getLine(memberNo: string, checkpoint: Checkpoint = "resolved"): EngineLine | undefined {
  return getLines(checkpoint).find((l) => l.memberNo === memberNo);
}

/** The seed's five items: H1, H2, H3, slip 0462 by hand, and the mass-balance dial. */
export function getHolds(): SnapshotHold[] {
  return getSnapshot().holds;
}

export function getLogbook(): SnapshotLogbookPage[] {
  return getSnapshot().logbook;
}

export function getFigures(): SeasonSnapshot["figures"] {
  return getSnapshot().figures;
}

export function getProof(): SeasonSnapshot["proof"] {
  return getSnapshot().proof;
}

/**
 * The keys a verifier pins for the seeded Proof (`/.well-known/fairsplit-keys.json` shape), passed
 * to `verifyChain` separately from the bundle. All are sample keys: the result is "sample" in demo
 * mode and "failed" otherwise.
 */
export function getPublishedKeys(): SeasonSnapshot["publishedKeys"] {
  return getSnapshot().publishedKeys;
}
