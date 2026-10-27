// The 80 mm print for one member's line (W-TR-09 "Print statement", `@page { size: 80mm auto }`): what the
// thermal print carries, as data the console lays out. Exact pesos for cash at the run's recorded rate, the rate
// line, the ReceiptBar, the slips, the rate-card hash, the batch seal (printed in black), a QR to the member's
// signed statement link, and a "Nadawat" box with a witness line. The record never says whether the member signs
// or thumbmarks (S1.12 "No inferred traits").
import { randomUUID } from "node:crypto";
import { MEMBER_LINE_LABELS, MemberLineState, MoneyDTO, Provenance } from "@fairsplit/contracts";
import { type DbOrTx, schema } from "@fairsplit/db";
import { format } from "@fairsplit/domain";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { LINK_TTL_MS, signLink } from "../credentials/verify/index.js";
import type { AppDeps } from "../lib/context.js";
import type { StatementContext } from "./facts.js";
import { payKindOf, statementPlan } from "./plan.js";
import {
  estimateText,
  pesoEstimateCentavos,
  pesoExactCentavos,
  rateLine,
  renderStatement,
} from "./render.js";
import { Lang, RenderedSentence } from "./types.js";

const Segment = z.strictObject({
  kind: z.enum(["premium", "bonus", "deduction", "credit", "net"]),
  label: z.string(),
  amount: MoneyDTO,
  ruleId: z.string().nullable(),
});

export const PrintSlip = z.strictObject({
  paper: z.literal("80mm"),
  coop: z.strictObject({ name: z.string(), region: z.string() }),
  season: z.strictObject({ code: z.string(), label: z.string() }),
  run: z.strictObject({ runSlug: z.string(), provenance: Provenance }),
  member: z.strictObject({ memberNo: z.string(), name: z.string(), addressedAs: z.string(), lang: Lang }),
  line: z.strictObject({
    state: MemberLineState,
    statusWords: z.string(),
    pay: z.enum(["checking", "excluded", "cash", "paypal"]),
  }),
  amount: z
    .strictObject({
      usd: MoneyDTO,
      php: z.strictObject({ centavos: z.int(), display: z.string(), exact: z.boolean() }).nullable(),
      /** "From US$127.84 at ₱62.50 to the dollar" (cash) — the rate is recorded on the run. */
      rateLine: z.string().nullable(),
    })
    .nullable(),
  receipt: z.array(Segment),
  slips: z.array(z.string()),
  rateCard: z.strictObject({ resolutionNo: z.string(), sha256: z.string(), display: z.string() }),
  seal: z.strictObject({ batchSha256: z.string().nullable(), display: z.string().nullable() }),
  statement: z.array(RenderedSentence),
  /** The QR: the member's signed, read-only statement link (30 days; a reprint rotates it). */
  memberLink: z.strictObject({ url: z.string(), expiresAt: z.iso.datetime() }),
  nadawat: z.strictObject({ box: z.literal(true), witnessLine: z.literal(true), words: z.string() }),
  printedAt: z.iso.datetime(),
  provenance: Provenance,
});
export type PrintSlip = z.infer<typeof PrintSlip>;

const NADAWAT: Readonly<Record<Lang, string>> = {
  ceb: "Nadawat",
  fil: "Natanggap",
  en: "Received",
};

const SEGMENT_WORDS: Readonly<Record<Lang, { premium: string; bonus: string; net: string; credit: string }>> =
  {
    en: { premium: "Premium, no deductions", bonus: "Bonus", net: "Your pay", credit: "Returned to you" },
    ceb: { premium: "Premium, walay kaltas", bonus: "Bonus", net: "Inyong bayad", credit: "Gibalik kaninyo" },
    fil: {
      premium: "Premium, walang kaltas",
      bonus: "Bonus",
      net: "Inyong bayad",
      credit: "Ibinalik sa inyo",
    },
  };

const CATEGORY_SHORT = { CBU: "CBU", LOAN: "Loan", ADVANCE: "Advance" } as const;

export async function printSlip(
  deps: Pick<AppDeps, "env" | "credentials" | "clock">,
  db: DbOrTx,
  sc: StatementContext,
): Promise<PrintSlip> {
  const f = sc.facts;
  const lang = f.lang;
  const [member] = await db
    .select({ displayName: schema.members.displayName })
    .from(schema.members)
    .where(and(eq(schema.members.workspaceId, sc.workspaceId), eq(schema.members.id, sc.memberId)))
    .limit(1);
  const [run] = await db
    .select({
      seasonCode: schema.payRuns.seasonCode,
      seasonId: schema.payRuns.seasonId,
      rateCardSha256: schema.payRuns.rateCardSha256,
      batchSha256: schema.payRuns.batchSha256,
    })
    .from(schema.payRuns)
    .where(and(eq(schema.payRuns.workspaceId, sc.workspaceId), eq(schema.payRuns.id, sc.runId)))
    .limit(1);
  const [season] = run
    ? await db
        .select({ label: schema.seasons.label, coopId: schema.seasons.coopId })
        .from(schema.seasons)
        .where(and(eq(schema.seasons.workspaceId, sc.workspaceId), eq(schema.seasons.id, run.seasonId)))
        .limit(1)
    : [];
  const [coop] = season
    ? await db
        .select({ name: schema.coops.name, region: schema.coops.region })
        .from(schema.coops)
        .where(and(eq(schema.coops.workspaceId, sc.workspaceId), eq(schema.coops.id, season.coopId)))
        .limit(1)
    : [];

  const pay = payKindOf(f);
  const plan = statementPlan(f);
  const rendered = renderStatement(plan);
  const words = SEGMENT_WORDS[lang];
  const showMoney = pay === "cash" || pay === "paypal";
  const receipt: PrintSlip["receipt"] = showMoney
    ? [
        { kind: "premium", label: words.premium, amount: format.moneyDTO(f.premiumCents), ruleId: "R0" },
        { kind: "bonus", label: words.bonus, amount: format.moneyDTO(f.bonusCents), ruleId: "R0" },
        ...f.deductions.map((d) => ({
          kind: "deduction" as const,
          label: `${CATEGORY_SHORT[d.category]} (${d.ruleId}, ${f.resolutionNo})`,
          amount: format.moneyDTO(-d.amountCents),
          ruleId: d.ruleId,
        })),
        ...f.credits.map((c) => ({
          kind: "credit" as const,
          label: c.serial ? `${words.credit} (${c.serial})` : words.credit,
          amount: format.moneyDTO(c.amountCents),
          ruleId: null,
        })),
        { kind: "net", label: words.net, amount: format.moneyDTO(f.netCents), ruleId: null },
      ]
    : [];

  let amount: PrintSlip["amount"] = null;
  if (showMoney) {
    if (pay === "cash" && f.fx) {
      const exact = pesoExactCentavos(f.netCents, f.fx);
      amount = {
        usd: format.moneyDTO(f.netCents),
        php: { centavos: exact, display: format.money(exact, "PHP"), exact: true },
        rateLine: rateLine(f.netCents, f.fx, lang),
      };
    } else if (pay === "paypal" && f.fx) {
      const est = pesoEstimateCentavos(f.netCents, f.fx);
      amount = {
        usd: format.moneyDTO(f.netCents),
        php: { centavos: est, display: estimateText(est, lang), exact: false },
        rateLine: null,
      };
    } else {
      amount = { usd: format.moneyDTO(f.netCents), php: null, rateLine: null };
    }
  }

  const nowMs = deps.clock.nowMs();
  const exp = Math.floor((nowMs + LINK_TTL_MS) / 1000);
  const token = signLink(deps.credentials.keys.linkPrivateKey, {
    v: 1,
    k: "member",
    ws: sc.workspaceId,
    lineId: f.lineId,
    jti: randomUUID(),
    exp,
  });

  return {
    paper: "80mm",
    coop: { name: coop?.name ?? f.coop, region: coop?.region ?? "" },
    season: { code: run?.seasonCode ?? "", label: season?.label ?? "" },
    run: { runSlug: sc.runSlug, provenance: sc.provenance },
    member: {
      memberNo: f.memberNo,
      name: member?.displayName ?? f.honorific,
      addressedAs: f.honorific,
      lang,
    },
    line: { state: f.state, statusWords: MEMBER_LINE_LABELS[f.state][lang], pay },
    amount,
    receipt,
    slips: [...f.slipSerials],
    rateCard: {
      resolutionNo: f.resolutionNo,
      sha256: run?.rateCardSha256 ?? "",
      display: run ? format.hashGroups(run.rateCardSha256) : "",
    },
    seal: {
      batchSha256: run?.batchSha256 ?? null,
      display: run?.batchSha256 ? format.hashAllGroups(run.batchSha256) : null,
    },
    statement: rendered.display,
    memberLink: { url: `${deps.env.publicOrigin}/s/${token}`, expiresAt: new Date(exp * 1000).toISOString() },
    nadawat: { box: true, witnessLine: true, words: NADAWAT[lang] },
    printedAt: new Date(nowMs).toISOString(),
    provenance: sc.provenance,
  };
}
