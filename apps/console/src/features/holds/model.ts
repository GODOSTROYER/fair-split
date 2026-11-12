// W-TR-06's model: which hold the drawer shows, its card state, and both voices. The engine's line is a
// template whose every digit comes from the engine's own facts about the hold (`EngineHold.params` in the
// snapshot's checkpoints); Claude's line is the recorded pencil sentence with no digits. Nothing here computes
// money: it reads the engine and formats what it said.

import type {
  EngineHold,
  HoldResolutionKind,
  SeasonSnapshot,
  SnapshotHold,
  SnapshotMember,
  SnapshotSlip,
} from "@fairsplit/contracts";
import { webRoutes } from "@fairsplit/contracts";
import type { HoldCardState } from "@fairsplit/ui-web";
import { blockingHolds, holdCards, type RunHold, type RunView } from "../../data/run-view.js";
import { format } from "../../lib/format.js";
import { engineHold, engineOutput, isOpenHold, splitBasis } from "../split/model.js";
import { en, HOLDS } from "../split/shared/copy.js";

/** A hold by its label ("H1") or its ID, as `?hold=` may carry either. */
export function findHold(view: RunView, holdId: string): RunHold | undefined {
  return (
    view.holds[holdId] ??
    Object.values(view.holds).find((h) => h.label === holdId || h.holdId === holdId || h.key === holdId)
  );
}

export interface DrawerFlags {
  /** A press is in flight: the slab is down, the event has not arrived. */
  readonly resolving: boolean;
  /** Someone else (the Chair) is looking at this hold right now (presence). */
  readonly conflict: boolean;
}

/** S2.7's HoldCard states from the register's hold states (OPEN, ASKED_CHAIR, RESOLVED, EXCLUDED). */
export function cardState(hold: RunHold, flags: DrawerFlags): HoldCardState {
  if (hold.state === "RESOLVED") return "resolved";
  if (hold.state === "EXCLUDED") return "excluded";
  if (flags.resolving) return "resolving";
  if (hold.state === "ASKED_CHAIR") return "asked-chair";
  if (flags.conflict) return "conflict";
  return "open";
}

/** "Hold 1 of 3" among the cards a person decides (H1–H3). */
export function position(
  view: RunView,
  hold: RunHold,
): { readonly index: number; readonly total: number } | null {
  const cards = holdCards(view);
  const index = cards.findIndex((h) => h.holdId === hold.holdId);
  return index < 0 ? null : { index: index + 1, total: cards.length };
}

export interface NextStepLink {
  readonly href: string;
  readonly words: string;
  readonly kind: "hold" | "by-hand" | "approve";
}

/** Where the treasurer goes after deciding: the next open card, slip 0462 by hand, or Approve. */
export function nextAfter(snapshot: SeasonSnapshot, view: RunView, current: RunHold): NextStepLink | null {
  const open = holdCards(view).filter((h) => isOpenHold(h) && h.holdId !== current.holdId);
  const card = open.find((h) => h.label > current.label) ?? open[0];
  if (card)
    return {
      href: webRoutes.holdDrawer(view.runSlug, card.label),
      words: HOLDS.next(card.label),
      kind: "hold",
    };
  const byHand = Object.values(view.holds).find((h) => h.kind === "LOW_CONFIDENCE" && isOpenHold(h));
  if (byHand) {
    const serial = seededHold(snapshot, byHand)?.serials[0] ?? "";
    return {
      href: webRoutes.byHand(snapshot.season.label, serial),
      words: HOLDS.byHandLink(serial),
      kind: "by-hand",
    };
  }
  if (blockingHolds(view).length === 0 && (view.state === "IN_REVIEW" || view.state === "COMPUTED")) {
    return { href: webRoutes.approve(view.runSlug), words: HOLDS.allDecided, kind: "approve" };
  }
  return null;
}

export function seededHold(snapshot: SeasonSnapshot, hold: RunHold): SnapshotHold | undefined {
  return snapshot.holds.find((h) => h.key === hold.key) ?? snapshot.holds.find((h) => h.label === hold.label);
}

export function memberOf(snapshot: SeasonSnapshot, memberNo: string | null): SnapshotMember | undefined {
  return memberNo ? snapshot.members.find((m) => m.memberNo === memberNo) : undefined;
}

/**
 * The engine's facts about a hold as the run stands: an open hold is described by the computation the run's
 * decisions match now (before 0462 is entered the dial still waits, so H1's figures differ); a decided hold by
 * the computation that decided it.
 */
export function factsFor(snapshot: SeasonSnapshot, view: RunView, hold: RunHold): EngineHold | undefined {
  const basis = splitBasis(view);
  // API mark IDs are UUIDs; the snapshot's engine keeps the seed mark IDs. Match that same member and
  // slip when keys differ, taking facts only from the engine output for the run's current basis.
  const serials = seededHold(snapshot, hold)?.serials ?? [];
  const find = (output: ReturnType<typeof engineOutput>): EngineHold | undefined => {
    const exact = engineHold(output, hold.key);
    if (exact) return exact;
    const matches = output.holds.filter(
      (candidate) =>
        candidate.kind === hold.kind &&
        candidate.memberNo === hold.memberNo &&
        candidate.serials.some((serial) => serials.includes(serial)),
    );
    return matches.length === 1 ? matches[0] : undefined;
  };
  if (isOpenHold(hold)) {
    const now = find(engineOutput(snapshot, basis));
    if (now) return now;
  }
  return (
    find(snapshot.checkpoints.resolved) ??
    find(snapshot.checkpoints.byHand) ??
    find(snapshot.checkpoints.read)
  );
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" ? v : fallback);

export interface DuplicateFacts {
  readonly serial: string;
  readonly photoA: string;
  readonly photoB: string;
  readonly moved: string;
  readonly others: number;
  readonly shrinkBoth: string;
  readonly shrinkOnce: string;
  readonly limit: string;
  /** Counting both still leaves shrink inside the limit (slip 0462 is not entered yet). */
  readonly bothInside: boolean;
  readonly holderBoth: string;
  readonly holderOnce: string;
}

export function duplicateFacts(
  facts: EngineHold | undefined,
  seeded: SnapshotHold | undefined,
): DuplicateFacts {
  const p = facts?.params ?? {};
  const copies = Array.isArray(p.copies)
    ? (p.copies as readonly { photoId?: unknown; copy?: unknown }[])
    : [];
  const white = copies.find((c) => c.copy === "WHITE_ORIGINAL") ?? copies[0];
  const pink = copies.find((c) => c.copy === "PINK_DUPLICATE") ?? copies[1];
  return {
    serial: facts?.serials[0] ?? seeded?.serials[0] ?? "",
    photoA: str(white?.photoId),
    photoB: str(pink?.photoId),
    moved: str(p.movedDisplay),
    others: num(p.othersCount),
    shrinkBoth: str(p.shrinkBothDisplay),
    shrinkOnce: str(p.shrinkOnceDisplay),
    limit: str(p.tolDisplay),
    bothInside: p.bothInside === true,
    holderBoth: str(p.holderNetBothDisplay),
    holderOnce: str(p.holderNetOnceDisplay),
  };
}

export interface YieldFacts {
  readonly kg: string;
  readonly trees: number;
  readonly perTree: string;
  readonly limit: string;
  /** The plot the registry holds but has not registered (P-053-B), when there is one. */
  readonly pendingPlot: { readonly plotNo: string; readonly areaHa: string; readonly trees: number } | null;
  readonly treesAfter: number | null;
  readonly perTreeAfter: string | null;
  /** Kilos a tree against the limit (1 = at the limit), for the bar. A display ratio, never money. */
  readonly ratio: number;
  readonly ratioAfter: number | null;
}

export function yieldFacts(
  snapshot: SeasonSnapshot,
  hold: RunHold,
  member: SnapshotMember | undefined,
): YieldFacts {
  const before = engineHold(snapshot.checkpoints.read, hold.key)?.params ?? {};
  const after = engineHold(snapshot.checkpoints.resolved, hold.key)?.params ?? {};
  const pending = member?.plots.find((p) => !p.registered) ?? null;
  const limitG = num(before.limitGPerTree, snapshot.rateCard.canonical.rules.tolerances.kgPerTreeMaxG);
  const verifiedG = num(before.verifiedG);
  const trees = num(before.registeredTrees);
  const treesAfter = typeof after.treesAfter === "number" ? after.treesAfter : null;
  return {
    kg: str(before.verifiedDisplay),
    trees,
    perTree: str(before.kgPerTree),
    limit: str(before.limitDisplay),
    pendingPlot: pending ? { plotNo: pending.plotNo, areaHa: pending.areaHa, trees: pending.trees } : null,
    treesAfter,
    perTreeAfter: typeof after.kgPerTreeAfter === "string" ? after.kgPerTreeAfter : null,
    ratio: trees > 0 && limitG > 0 ? verifiedG / trees / limitG : 0,
    ratioAfter: treesAfter && limitG > 0 ? verifiedG / treesAfter / limitG : null,
  };
}

export interface NoRuleFacts {
  readonly text: string;
  readonly written: string;
  readonly credit: string;
  readonly creditCents: number;
  readonly serial: string;
  /** Box 13's other lines and the rule each one matches. */
  readonly marks: readonly {
    readonly text: string;
    readonly rule: string | null;
    readonly amount: string | null;
  }[];
  readonly hauling: string;
}

export function noRuleFacts(
  snapshot: SeasonSnapshot,
  hold: RunHold,
  facts: EngineHold | undefined,
): NoRuleFacts {
  const p = facts?.params ?? {};
  const serial = facts?.serials[0] ?? seededHold(snapshot, hold)?.serials[0] ?? "";
  const slip = slipCopies(snapshot, serial)[0];
  const marks = (slip?.marks ?? []).map((m) => ({
    text: m.text,
    rule: /^R\d$/.test(m.ruleId) ? m.ruleId : null,
    amount: m.writtenCentavos === null ? null : format.money(m.writtenCentavos, "PHP"),
  }));
  const hauling = slip?.marks.find((m) => m.ruleId === "R2");
  const mark =
    slip?.marks.find((m) => hold.key === `NO_RULE:${m.markId}`) ??
    slip?.marks.find((m) => m.ruleId === "NO_MATCH");
  const writtenCentavos = typeof p.writtenCentavos === "number" ? p.writtenCentavos : mark?.writtenCentavos;
  return {
    text: str(p.text, mark?.text ?? ""),
    written: str(p.writtenDisplay, writtenCentavos == null ? "" : format.pesoWhole(writtenCentavos)),
    credit: str(p.creditDisplay, typeof p.creditCents === "number" ? format.money(p.creditCents) : ""),
    creditCents: num(p.creditCents),
    serial,
    marks,
    hauling: hauling?.writtenCentavos != null ? format.money(hauling.writtenCentavos, "PHP") : "",
  };
}

/** Every copy of a slip in the evidence (the white original first). */
export function slipCopies(snapshot: SeasonSnapshot, serial: string): SnapshotSlip[] {
  const order = {
    WHITE_ORIGINAL: 0,
    PINK_DUPLICATE: 1,
    YELLOW_TRIPLICATE: 2,
    LOGBOOK_LINE: 3,
    UNKNOWN: 4,
  } as const;
  return snapshot.slips.filter((s) => s.serial === serial).sort((a, b) => order[a.copy] - order[b.copy]);
}

export type TwinField = "serial" | "date" | "member" | "net";

export interface TwinRow {
  readonly field: TwinField;
  readonly a: string;
  readonly b: string;
  readonly match: boolean;
}

/** MM-3's honest count: the fields the two copies share, compared as written. "4 of 4" only when all four match. */
export function twinRows(a: SnapshotSlip, b: SnapshotSlip): TwinRow[] {
  const pick = (s: SnapshotSlip, field: TwinField) => {
    switch (field) {
      case "serial":
        return s.serial;
      case "date":
        return s.boxes["1"];
      case "member":
        return s.boxes["2"];
      case "net":
        return s.boxes["8"];
    }
  };
  return (["serial", "date", "member", "net"] as const).map((field) => {
    const va = pick(a, field);
    const vb = pick(b, field);
    return { field, a: va, b: vb, match: va === vb };
  });
}

export interface Voices {
  readonly title: string;
  readonly engineLine: string;
  readonly claudeLine: string | null;
  readonly effect: string | null;
}

/**
 * Both voices for a hold card (unslop spec §3.7: one line plus the decision). The title names the hold, or once it
 * is decided, what was decided; the engine's line is one sentence; the effect is the money's delta. Digits only
 * ever come from the engine's facts.
 */
export function voices(snapshot: SeasonSnapshot, view: RunView, hold: RunHold): Voices {
  const seeded = seededHold(snapshot, hold);
  const facts = factsFor(snapshot, view, hold);
  const member = memberOf(snapshot, hold.memberNo);
  const claude = seeded?.claudeLine ?? null;
  const decided = hold.state === "RESOLVED";
  switch (hold.kind) {
    case "DUPLICATE_SLIP": {
      const d = duplicateFacts(facts, seeded);
      const name = member?.consoleName ?? hold.memberNo ?? "";
      // UI gate round 3: the engine's sentence becomes a number line ("63 members −US$17.94 → Nong Dioning
      // +US$17.94"); the seed's pink-copy sentence goes (the captions "B · white original", "D · pink duplicate"
      // say it, and the stand-in's glyph sits by the field match); the effect names the money and the dial's move.
      return {
        title: decided
          ? hold.resolution === "TWO_DELIVERIES"
            ? HOLDS.h1TitleTwo(d.serial)
            : HOLDS.h1TitleOnce(d.serial)
          : en("W-TR-06.H1.title", { slip: d.serial }),
        engineLine: d.bothInside
          ? HOLDS.h1EngineInside(d.moved, d.others, d.shrinkBoth, d.limit)
          : HOLDS.h1Flow(d.moved, d.others, name),
        claudeLine: null,
        effect: d.bothInside
          ? HOLDS.h1EffectInside(d.moved, d.others)
          : HOLDS.h1Effect(d.moved, d.others, d.shrinkBoth, d.shrinkOnce),
      };
    }
    case "IMPLAUSIBLE_YIELD": {
      const y = yieldFacts(snapshot, hold, member);
      const name = member?.displayName ?? hold.memberNo ?? "";
      return {
        title: decided ? HOLDS.h2TitleDone(name) : HOLDS.h2Title(name, y.perTree),
        engineLine: HOLDS.h2Engine(y.kg, y.trees, y.limit),
        claudeLine: claude ?? en("W-TR-06.H2.claude"),
        effect: y.pendingPlot ? HOLDS.yieldEffect(y.pendingPlot.plotNo) : null,
      };
    }
    case "NO_RULE": {
      const n = noRuleFacts(snapshot, hold, facts);
      return {
        title: decided ? HOLDS.h3TitleDone(n.serial) : HOLDS.h3Title(n.serial),
        engineLine: HOLDS.h3Engine(n.text || n.written),
        claudeLine: claude ?? en("W-TR-06.H3.claude"),
        effect: HOLDS.creditEffect(n.credit),
      };
    }
    default:
      return {
        title: hold.label,
        engineLine: seeded?.engineLine ?? "",
        claudeLine: claude,
        effect: null,
      };
  }
}

/** The printed result once a hold is decided, from the engine's facts and the resolution the person chose. */
export function resultLine(
  snapshot: SeasonSnapshot,
  view: RunView,
  hold: RunHold,
  resolution: HoldResolutionKind | null,
): string | null {
  if (hold.state !== "RESOLVED") return null;
  const facts = factsFor(snapshot, view, hold);
  switch (hold.kind) {
    case "DUPLICATE_SLIP": {
      const d = duplicateFacts(facts, seededHold(snapshot, hold));
      if (resolution === "TWO_DELIVERIES") return HOLDS.overrideNote;
      return HOLDS.h1Returned(d.moved, d.others);
    }
    case "IMPLAUSIBLE_YIELD": {
      const y = yieldFacts(snapshot, hold, memberOf(snapshot, hold.memberNo));
      if (y.treesAfter === null || y.perTreeAfter === null) return null;
      return en("W-TR-06.H2.result", { kg: y.kg, trees: y.treesAfter, perTree: `${y.perTreeAfter} kg` });
    }
    case "NO_RULE": {
      const n = noRuleFacts(snapshot, hold, facts);
      return HOLDS.creditReturned(n.credit);
    }
    default:
      return null;
  }
}
