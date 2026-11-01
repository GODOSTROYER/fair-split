// AU2: the renderer owns every word and hash. This export only records its output and exact spoken spans.
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { Db } from "@fairsplit/db";
import { getMember } from "@fairsplit/seed";
import { findRepoRoot } from "../static.js";
import { loadStatementContext } from "./facts.js";
import { statementPlan } from "./plan.js";
import { fillTemplate, renderFact, renderStatement, spokenScript } from "./render.js";
import { TEMPLATES_V1 } from "./templates.js";
import type { Lang, Placeholder, PlannedSentence } from "./types.js";

export interface StatementRequest {
  member_no: string;
  lang: Lang;
}

export interface SpokenSpan {
  spoken: string;
  /** UTF-16 index into the sentence's exact spoken text, for inserting pause markers. */
  start: number;
}

export function sentenceSpans(sentence: PlannedSentence, lang: Lang) {
  const template = TEMPLATES_V1[lang][`${sentence.slot}.${sentence.variant}`];
  if (template === undefined) throw new Error(`missing template ${sentence.slot}.${sentence.variant}`);
  const placeholders: (SpokenSpan & { name: string })[] = [];
  for (const match of template.matchAll(/\{\{([A-Z_]+)\}\}/g)) {
    const name = match[1] as Placeholder;
    const fact = sentence.facts[name];
    if (!fact) throw new Error(`missing fact ${name}`);
    const start = fillTemplate(template.slice(0, match.index), sentence.facts, "spoken", lang).length;
    placeholders.push({ name, spoken: renderFact(fact, "spoken", lang), start });
  }
  const mentionSpans = sentence.mentions.map((ref) => {
    const [kind, id] = ref.split(":");
    const parent = placeholders.find((p) => {
      const fact = sentence.facts[p.name as Placeholder];
      return kind === "rule"
        ? fact?.k === "rule" && fact.id === id
        : (fact?.k === "slip" && fact.serial === id) ||
            (fact?.k === "slips" && fact.serials.includes(id ?? ""));
    });
    if (!parent || !id) throw new Error(`unanchored mention ${ref}`);
    const spoken = renderFact(
      kind === "rule" ? { k: "rule", id } : { k: "slip", serial: id },
      "spoken",
      lang,
    );
    const relative = parent.spoken.indexOf(spoken);
    if (relative < 0) throw new Error(`mention ${ref} absent from spoken placeholder`);
    return { ref, spoken, start: parent.start + relative };
  });
  if (mentionSpans.some((m, i) => i > 0 && m.start < (mentionSpans[i - 1]?.start ?? 0)))
    throw new Error("mentions are not in spoken order");
  return { placeholders, mentionSpans };
}

export async function exportStatementPlans(
  db: Db,
  world: { workspaceId: string; lineIds: ReadonlyMap<string, string> },
  requests: readonly StatementRequest[],
) {
  const exported = [];
  for (const request of requests) {
    const lineId = world.lineIds.get(request.member_no);
    if (!lineId) throw new Error(`missing line ${request.member_no}`);
    const ctx = await loadStatementContext(db, world.workspaceId, lineId, request.lang);
    if (!ctx) throw new Error(`missing statement context ${request.member_no}`);
    if (ctx.facts.readingProvenance === "live") throw new Error("statement export requires a seeded reading");
    const plan = statementPlan(ctx.facts);
    if (request.member_no === "M-031") {
      // The second PAY form is known before a return. The receipt's day is not: PAY.cash is never planned.
      const paypal = statementPlan({ ...ctx.facts, state: "PAID", cashDay: null });
      const pay = paypal.sentences.find((s) => s.slot === "PAY");
      const at = plan.sentences.findIndex((s) => s.slot === "PAY");
      if (!pay || at < 0) throw new Error("Rhea's two PAY forms are missing");
      plan.sentences.splice(at, 0, pay);
    }
    const rendered = renderStatement(plan);
    const sentences = spokenScript(plan).map((spoken, i) => {
      const sentence = plan.sentences[i];
      if (!sentence) throw new Error("renderer changed sentence count");
      return {
        ...spoken,
        ...sentenceSpans(sentence, request.lang),
        displayText: rendered.display[i]?.text ?? "",
      };
    });
    // Database clones allocate fresh member_line UUIDs. The export/demo uses the stable member seed UUID
    // (ADR-0011, K1d), while a real route read is always keyed by that workspace's actual line UUID.
    const canonicalLineId = getMember(request.member_no)?.id;
    if (!canonicalLineId) throw new Error(`missing canonical member ${request.member_no}`);
    exported.push({ member_no: request.member_no, lang: request.lang, lineId: canonicalLineId, sentences });
  }
  return {
    v: 1 as const,
    synthetic: true as const,
    notice:
      "Seed stand-in, not a Claude recording. PayPal-derived facts: Simulated PayPal sandbox. Audio is synthetic (Gemini TTS).",
    requests: exported,
  };
}

export function serializeStatementPlans(plans: Awaited<ReturnType<typeof exportStatementPlans>>): string {
  // Generated JSON must already satisfy the repository formatter, otherwise the pre-commit hook changes
  // its bytes after export. Use the exact pinned local tool; no downloads or hand-maintained formatter.
  const root = findRepoRoot();
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/@biomejs/biome/bin/biome"),
      "format",
      "--stdin-file-path=media/statement-plans.json",
    ],
    { cwd: root, input: JSON.stringify(plans, null, 2), encoding: "utf8", windowsHide: true },
  );
  if (result.error || result.status !== 0)
    throw new Error("the pinned local Biome could not format the statement export");
  return result.stdout;
}
