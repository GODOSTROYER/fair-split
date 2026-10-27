// Engine lines: printed templates whose every digit comes from code (design §5 hold cards). The
// console is English and keeps the co-op's words. Claude's line (pencil, no digits) is separate.
import type { CopyColor, EngineHold, Json } from "@fairsplit/contracts";

export interface CopyContext {
  /** How the console names a member: "Nong Dioning", "Merlyn Ponce". */
  consoleName(memberNo: string): string;
  /** Short buyer name for "not from Lantern Bay's pool". */
  buyerShortName: string;
}

const COPY_WORDS: Readonly<Record<CopyColor, string>> = {
  WHITE_ORIGINAL: "white original",
  PINK_DUPLICATE: "pink duplicate",
  YELLOW_TRIPLICATE: "yellow triplicate",
  LOGBOOK_LINE: "logbook line",
  UNKNOWN: "copy",
};

const FIELD_WORDS: Readonly<Record<string, string>> = {
  gross_kg: "gross",
  tare_kg: "tare",
  net_kg: "net",
  payable_kg: "payable kilos",
  mc_pct: "moisture",
  mc_less_kg: "moisture deduction",
  serial: "serial",
  member_no: "member number",
  member_name: "name",
  grade: "grade",
  date: "date",
  plot_no: "plot",
  sacks: "sacks",
  deductions: "deductions",
};

const p = (h: EngineHold, key: string): Json | undefined => h.params[key];
const s = (h: EngineHold, key: string): string => {
  const v = p(h, key);
  return v === null || v === undefined ? "" : String(v);
};

function list(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** The engine line for a hold card, in English. */
export function engineLine(hold: EngineHold, ctx: CopyContext): string {
  const who = hold.memberNo ? ctx.consoleName(hold.memberNo) : "";
  switch (hold.kind) {
    case "DUPLICATE_SLIP": {
      const effect = `Counting both moves ${s(hold, "movedDisplay")} from ${s(hold, "othersCount")} members to ${who} and puts shrink at ${s(hold, "shrinkBothDisplay")}, ${p(hold, "bothInside") === true ? "inside" : "over"} the ${s(hold, "tolDisplay")} limit.`;
      if (p(hold, "signal") === "SAME_SERIAL") {
        const copies = (p(hold, "copies") ?? []) as { copy: CopyColor; photoId: string | null }[];
        const parts = copies.map((c) => `the ${COPY_WORDS[c.copy]}${c.photoId ? ` (${c.photoId})` : ""}`);
        const where = copies.length === 2 ? "two photos" : `${copies.length} photos`;
        return `Slip ${hold.serials[0]} is in ${where}: ${list(parts)}. ${effect}`;
      }
      return `Slips ${list(hold.serials)} look like the same paper photographed twice. ${effect}`;
    }
    case "IMPLAUSIBLE_YIELD": {
      if (hold.state === "RESOLVED" && p(hold, "treesAfter") !== null) {
        return `${s(hold, "verifiedDisplay")} from ${s(hold, "treesAfter")} trees is ${s(hold, "kgPerTreeAfter")} kg a tree. Inside the limit.`;
      }
      return `${who}: ${s(hold, "verifiedDisplay")} from ${s(hold, "registeredTrees")} registered trees is ${s(hold, "kgPerTree")} kg a tree. The limit is ${s(hold, "limitDisplay")}.`;
    }
    case "NO_RULE": {
      const stays = (p(hold, "stays") ?? []) as string[];
      const tail = stays.length > 0 ? ` ${list(stays)} ${stays.length === 1 ? "stays" : "stay"}.` : "";
      return `'${s(hold, "text")}' on slip ${hold.serials[0]} matches no Schedule A rule. It was netted from ${who}'s cash at the bodega, so it returns as a ${s(hold, "creditDisplay")} correction credit paid by the co-op, not from ${ctx.buyerShortName}'s pool.${tail}`;
    }
    case "RATE_MISMATCH":
      return `'${s(hold, "text")}' on slip ${hold.serials[0]} does not match ${s(hold, "ruleId")} on the rate card. The difference returns as a ${s(hold, "creditDisplay")} correction credit if it was taken.`;
    case "SUSPECTED_INJECTION":
      return `Text on slip ${hold.serials[0]} looked like an instruction and overlaps the slip's data. Text on a slip is never an instruction.`;
    case "LOW_CONFIDENCE": {
      const fields = ((p(hold, "fields") ?? []) as { field: string }[]).map(
        (f) => FIELD_WORDS[f.field] ?? f.field,
      );
      const score = Number(p(hold, "minScore") ?? 0).toFixed(2);
      return `Slip ${hold.serials[0]}: ${list([...new Set(fields)])} need${fields.length === 1 ? "s" : ""} a person (${score}).`;
    }
    case "MASS_BALANCE":
      return hold.state === "RESOLVED"
        ? `Shrink ${s(hold, "shrinkDisplay")}, inside ${s(hold, "tolDisplay")}.`
        : `Verified ${s(hold, "verifiedDisplay")} against ${s(hold, "shippedDisplay")} shipped: shrink ${s(hold, "shrinkDisplay")}, over the ${s(hold, "tolDisplay")} limit.`;
  }
}

/** The reading room's quarantine notice (S4.7). */
export function quarantineNotice(serial: string): string {
  return `Ignored: text on slip ${serial} looked like an instruction. Text on a slip is never an instruction.`;
}
