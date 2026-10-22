import type { AssetSpec, DeductionRule, PhotoPosition, SlipSpec } from "../content/types.js";
import type {
  FieldFixture,
  Fixture,
  LogbookPageFixture,
  SlipFixture,
  SlipImageFixture,
} from "../fixtures/schema.js";
import { SLIP_ROW_FIELDS } from "../fixtures/schema.js";
import { type CaseLabel, LABEL_VERSION, type SlipLabel, type Trap } from "./schema.js";

/**
 * Builds the eval label for one checked fixture (S4.10 "Labels"). Drafts (any value still UNVERIFIED)
 * produce no label. Hero flats, photos and documents are `dev` cases (S4.8); the 24 test cases come later
 * from the eval images.
 */

/** A logbook remark's rule, by its wording (the logbook is a witness; only the multa appears on page 14). */
export function ruleForRemark(text: string): DeductionRule {
  const t = text.toUpperCase();
  if (/HAUL|HAKOT/.test(t)) return "R2";
  if (/\bCBU\b/.test(t)) return "R1";
  if (/LOAN|UTANG/.test(t)) return "R3";
  if (/ADVANCE|BALE/.test(t)) return "R4";
  return "NO_MATCH";
}

function fieldLabel(f: FieldFixture) {
  return { value: f.value, visible: f.visible, expect: f.expect };
}

function slipSpecOf(asset: AssetSpec, slot: string): SlipSpec | null {
  if (asset.kind === "slip_page") return slot === "ONLY" ? asset.slip : null;
  if (asset.kind === "slip_photo") return asset.slips[slot as PhotoPosition] ?? null;
  return null;
}

function slipLabel(s: SlipFixture, spec: SlipSpec): SlipLabel {
  const traps = new Set<Trap>();
  if (s.traps.includes("WATER_STAIN")) traps.add("LOW_CONFIDENCE");
  if (s.traps.includes("MARGIN_NOTE")) traps.add("INJECTION");
  if (s.duplicateOf) traps.add("DUPLICATE");
  const rules = [spec.deductionRules?.deduction_1, spec.deductionRules?.deduction_2];
  const deductions = s.deductions.flatMap((d, i) => {
    if (d.visible === "" && d.value === "") return [];
    const rule = rules[i] ?? "NO_MATCH";
    traps.add(rule === "NO_MATCH" ? "NO_RULE" : "RULED_DEDUCTION");
    return [{ visible: d.visible, rule, expect: d.expect }];
  });
  for (const t of spec.extraTraps ?? []) traps.add(t);
  const note = s.anomalies[0];
  const marginNote = spec.artifacts.find((a) => a.kind === "MARGIN_NOTE");
  return {
    slot: s.slot,
    serial: s.serial,
    copy: s.copy,
    fields: Object.fromEntries(SLIP_ROW_FIELDS.map((f) => [f, fieldLabel(s.fields[f])])),
    deductions,
    traps: [...traps].sort(),
    duplicate_of: s.duplicateOf,
    injection:
      note && marginNote?.kind === "MARGIN_NOTE" ? { lang: marginNote.lang, text: note.visible } : null,
  };
}

function logbookSlips(f: LogbookPageFixture): SlipLabel[] {
  return f.lines.map((l) => {
    const c = l.cells;
    const remark = c.remarks;
    return {
      slot: String(l.line),
      serial: l.serial,
      copy: "LOGBOOK_LINE",
      fields: {
        line_no: fieldLabel(c.line),
        date: fieldLabel(c.date),
        serial: fieldLabel(c.serial),
        member_no: fieldLabel(c.member_no),
        member_name: fieldLabel(c.member_name),
        net_kg: fieldLabel(c.net_kg),
        grade: fieldLabel(c.grade),
      },
      deductions:
        remark.visible === "" && remark.value === ""
          ? []
          : [{ visible: remark.visible, rule: ruleForRemark(remark.value), expect: remark.expect }],
      traps: [],
      duplicate_of: null,
      injection: null,
    };
  });
}

/** The label for a fixture, or null while the fixture is a draft or has no labelled slips. */
export function buildLabel(fixture: Fixture, asset: AssetSpec): CaseLabel | null {
  if (fixture.review.status === "draft") return null;
  if (fixture.kind === "rate_card_page") return null;
  const slips =
    fixture.kind === "logbook_page"
      ? logbookSlips(fixture as LogbookPageFixture)
      : (fixture as SlipImageFixture).slips.map((s) => {
          const spec = slipSpecOf(asset, s.slot);
          if (!spec) throw new Error(`${fixture.id}: no content spec for slot ${s.slot}`);
          return slipLabel(s, spec);
        });
  return {
    v: LABEL_VERSION,
    synthetic: true,
    case: fixture.id,
    set: "dev",
    status: fixture.review.status,
    kind: fixture.kind,
    image: fixture.image.master,
    fixture: `fixtures/${fixture.id}.json`,
    slips,
    rate_card: null,
    reviewer: fixture.review.reviewer ?? "unknown",
    reviewed_at: fixture.review.reviewedAt ?? "",
  };
}
