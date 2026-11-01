// The 80 mm print for one member's line (W-TR-09 "Print statement", `@page { size: 80mm auto }`): what the
// thermal print carries, as data the console lays out. Exact pesos for cash at the run's recorded rate, the rate
// line, the ReceiptBar, the slips, the rate-card hash, the batch seal (printed in black), a QR to the member's
// signed statement link, and a "Nadawat" box with a witness line. The record never says whether the member signs
// or thumbmarks (S1.12 "No inferred traits").
//
// The QR's link is a bearer credential (S3.8: one line, read-only, 30 days, revocable), and this is a GET: a
// print must not mint a fresh credential each time. So the link is a pure function of (workspace, line, issue
// day, generation): its jti is an HMAC of them and it expires 30 days after the issue day began (Asia/Manila), or
// with its workspace if sooner. Ed25519 signatures are deterministic, so every print of a line on one day carries
// the very same token. The first print of each link records it in the ledger (`link.issued`, `via: "print"`, ids
// and expiry only; idempotent under the workspace lock), so it is revoked like any issued link: by its id
// (`POST /v1/links/member/revoke`; the print names it in `memberLink.jti`) or with every live link of its line
// (`POST /v1/links/member/revoke-line`, a lost slip). Once revoked (a `link.revoked` entry naming its jti), the
// day's next generation is printed instead: one live printed link per line and day, and at most
// PRINT_LINK_GENERATIONS a day in all.
import { createHmac } from "node:crypto";
import {
  LABEL_REVIEW_STATUS,
  MEMBER_LINE_LABELS,
  MemberLineState,
  MoneyDTO,
  Provenance,
} from "@fairsplit/contracts";
import { type DbOrTx, schema, type WorkspaceScope } from "@fairsplit/db";
import { format, jcs } from "@fairsplit/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { recordPrintedLink } from "../credentials/issue/index.js";
import { type CredentialKeys, LINK_TTL_MS, signLink } from "../credentials/verify/index.js";
import type { AppDeps } from "../lib/context.js";
import { problem } from "../lib/problem.js";
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
  /** Cebuano and Filipino translations remain marked until native review (OD-2). */
  reviewChip: z.string().nullable(),
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
  /**
   * The QR: the member's signed, read-only statement link, the same for every print of the line that day; it
   * expires 30 days after the issue day began (Asia/Manila), or with its workspace if that is sooner. `jti` names
   * it for `POST /v1/links/member/revoke` (a lost slip); once revoked, the day's next print carries a fresh one.
   */
  memberLink: z.strictObject({ url: z.string(), jti: z.string(), expiresAt: z.iso.datetime() }),
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

/** Asia/Manila: UTC+8 all year (no daylight saving). A print "day" is the co-op's calendar day. */
const MANILA_OFFSET_MS = 8 * 60 * 60_000;

/** The HKDF purpose of the printed-link id key (its own subkey of FS_COOKIE_SECRET). */
export const PRINT_LINK_JTI_PURPOSE = "link:print-jti";

/** Fresh printed links one line may get in a day, each after the previous one was revoked. */
export const PRINT_LINK_GENERATIONS = 8;

/** The ledger kind that revokes a signed link by its jti (written by `revokeLink`, credentials/issue). */
export const LINK_REVOKED_KIND = "link.revoked";

/** The co-op's calendar day (Asia/Manila) of an instant: `YYYY-MM-DD`. */
export function issueDayOf(at: Date): string {
  return new Date(at.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

function issueDayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`) - MANILA_OFFSET_MS;
}

/** The id of a line's printed link on `day`: 128 bits of HMAC, base64url (as random link ids are). */
export function printLinkJti(
  keys: Pick<CredentialKeys, "hmacKey">,
  workspaceId: string,
  lineId: string,
  day: string,
  generation = 0,
): string {
  return createHmac("sha256", keys.hmacKey(PRINT_LINK_JTI_PURPOSE))
    .update(
      jcs({ v: 1, ws: workspaceId.toLowerCase(), lineId: lineId.toLowerCase(), day, n: generation }),
      "utf8",
    )
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

/** Which of `jtis` a `link.revoked` entry of the workspace's chain names. */
async function revokedAmong(db: DbOrTx, workspaceId: string, jtis: readonly string[]): Promise<Set<string>> {
  const le = schema.ledgerEntries;
  const jti = sql<string>`${le.payload}->>'jti'`;
  const rows = await db
    .select({ jti })
    .from(le)
    .where(and(eq(le.workspaceId, workspaceId), eq(le.kind, LINK_REVOKED_KIND), inArray(jti, [...jtis])));
  return new Set(rows.map((r) => r.jti));
}

export interface PrintedLink {
  /** `https://<origin>/s/<token>`: the token is the link's secret, never logged. */
  url: string;
  jti: string;
  expiresAt: Date;
}

/**
 * The member link a print of this line carries today: the day's first generation nobody revoked. Signed through
 * the shell's link codec (the bytes JUDGE's issuer signs); it moves to `credentials/issue` once that helper
 * accepts a given jti and expiry. The first print of each link records it in `scope`'s name
 * (`recordPrintedLink`), so it can be revoked. Throws RATE_LIMITED (until the next Manila day) when every
 * generation of the day was revoked.
 */
export async function printMemberLink(
  deps: Pick<AppDeps, "env" | "credentials">,
  db: DbOrTx,
  o: {
    scope: WorkspaceScope;
    workspaceId: string;
    lineId: string;
    now: Date;
    workspaceExpiresAt: Date | null;
  },
): Promise<PrintedLink> {
  if (o.scope.workspaceId !== o.workspaceId.toLowerCase()) {
    throw new TypeError("printMemberLink: a printed link is recorded in its own workspace's ledger");
  }
  const day = issueDayOf(o.now);
  const dayStart = issueDayStartMs(day);
  const ends = Math.min(dayStart + LINK_TTL_MS, o.workspaceExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY);
  const exp = Math.floor(ends / 1000);
  const candidates = Array.from({ length: PRINT_LINK_GENERATIONS }, (_, n) =>
    printLinkJti(deps.credentials.keys, o.workspaceId, o.lineId, day, n),
  );
  const revoked = await revokedAmong(db, o.workspaceId, candidates);
  const jti = candidates.find((j) => !revoked.has(j));
  if (!jti) {
    throw problem.rateLimited(
      dayStart + 24 * 60 * 60_000 - o.now.getTime(),
      "This line's printed links were all revoked today; print it again tomorrow.",
    );
  }
  const token = signLink(deps.credentials.keys.linkPrivateKey, {
    v: 1,
    k: "member",
    ws: o.workspaceId.toLowerCase(),
    lineId: o.lineId.toLowerCase(),
    jti,
    exp,
  });
  const expiresAt = new Date(exp * 1000);
  await recordPrintedLink(db, o.scope, { jti, lineId: o.lineId.toLowerCase(), expiresAt }, o.now);
  return { url: `${deps.env.publicOrigin}/s/${token}`, jti, expiresAt };
}

export async function printSlip(
  deps: Pick<AppDeps, "env" | "credentials" | "clock">,
  db: DbOrTx,
  sc: StatementContext,
  /** Who prints: the printed link's `link.issued` entry is attributed to this scope. */
  scope: WorkspaceScope,
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
  const [workspace] = await db
    .select({ expiresAt: schema.workspaces.expiresAt })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, sc.workspaceId))
    .limit(1);

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

  const now = deps.clock.now();
  const link = await printMemberLink(deps, db, {
    scope,
    workspaceId: sc.workspaceId,
    lineId: f.lineId,
    now,
    workspaceExpiresAt: workspace?.expiresAt ?? null,
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
    reviewChip: lang === "en" ? null : LABEL_REVIEW_STATUS,
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
    memberLink: { url: link.url, jti: link.jti, expiresAt: link.expiresAt.toISOString() },
    nadawat: { box: true, witnessLine: true, words: NADAWAT[lang] },
    printedAt: now.toISOString(),
    provenance: sc.provenance,
  };
}
