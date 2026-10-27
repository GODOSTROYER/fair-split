// The `explain` outbox task (IC-01 TaskName, args {lineId, lang}): records which template words a member's
// statement uses, in `statements` (words and placeholders only; code renders every number at read time, I1).
// No model is called here: AI-8 drafts variants offline and a person commits them (S4.5). Idempotent: one row
// per line and language, upserted, and the task completes in the same transaction (I7).
import { TaskArgs } from "@fairsplit/contracts";
import { type Db, schema, withWorkspaceTx } from "@fairsplit/db";
import type { TaskHandler } from "@fairsplit/outbox";
import { eq } from "drizzle-orm";
import { loadStatementContext } from "./facts.js";
import { statementPlan } from "./plan.js";
import { TEMPLATES_V1 } from "./templates.js";
import { placeholdersOf, validateTemplate } from "./validate.js";

export function explainTask(db: Db): TaskHandler {
  return async (rawArgs, ctx) => {
    const args = TaskArgs.explain.parse(rawArgs);
    const [line] = await db
      .select({ workspaceId: schema.memberLines.workspaceId })
      .from(schema.memberLines)
      .where(eq(schema.memberLines.id, args.lineId))
      .limit(1);
    // A line purged with its judge workspace: nothing to explain any more.
    if (!line) return;
    const sc = await loadStatementContext(db, line.workspaceId, args.lineId, args.lang);
    if (!sc) return;
    const plan = statementPlan(sc.facts);
    const sentences = plan.sentences.map((s) => {
      const id = `${s.slot}.${s.variant}`;
      const text = TEMPLATES_V1[args.lang][id] ?? "";
      const problems = validateTemplate(id, text, args.lang);
      if (problems.length > 0) throw new Error(`statement template refused: ${problems.join("; ")}`);
      return { id, text, placeholders: placeholdersOf(text) };
    });
    const smsId = `sms.${plan.sms.variant}`;
    const smsText = TEMPLATES_V1[args.lang][smsId] ?? null;
    await withWorkspaceTx(db, line.workspaceId, async (tx) => {
      await tx
        .insert(schema.statements)
        .values({
          workspaceId: line.workspaceId,
          lineId: args.lineId,
          lang: args.lang,
          sentences,
          smsText,
          provenance: sc.provenance,
        })
        .onConflictDoUpdate({
          target: [schema.statements.lineId, schema.statements.lang],
          set: { sentences, smsText, provenance: sc.provenance },
        });
      await ctx.complete(tx);
    });
  };
}
