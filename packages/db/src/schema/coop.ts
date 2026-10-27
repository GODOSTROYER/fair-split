/**
 * Co-op and rules group (register §7): coops, members, plots, seasons, lots, rate_cards, rate_rules,
 * ratifications. Figures (thresholds, prices) are never defaults here: they come from the seed snapshot (IC-03).
 *
 * I2 lives in SQL (migrations/0002, 0008): once `rate_cards.ratified_at` is set, any write to the card or its
 * rules, and any change to its season's terms (SEASON_RULE_COLUMNS), raises `FS409 RATE_CARD_RATIFIED:<sha256>`;
 * `rate_cards.sha256` must equal sha256(canonical_jcs).
 */
import { sql } from "drizzle-orm";
import { check, date, integer, jsonb, numeric, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { LANGS } from "../_shims/contracts.js";
import {
  cents,
  checkCurrency,
  checkIn,
  checkProvenance,
  checkSha,
  createdAt,
  currency,
  grams,
  id,
  provenance,
  sha256,
  tstz,
  wsFk,
  wsIdUnique,
} from "./_columns.js";
import { workspaceId } from "./workspace.js";

export const coops = pgTable(
  "coops",
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text("name").notNull(),
    region: text("region").notNull(),
    commodity: text("commodity").notNull().default("cacao"),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [checkProvenance("coops", t.provenance), wsIdUnique("coops", t)],
);

export const members = pgTable(
  "members",
  {
    id: id(),
    workspaceId: workspaceId(),
    coopId: uuid("coop_id").notNull(),
    /** M-014 */
    memberNo: text("member_no").notNull(),
    displayName: text("display_name").notNull(),
    honorific: text("honorific"),
    lang: text("lang", { enum: LANGS }).notNull(),
    /** Key into PP_RECEIVERS (env); the receiver address itself never lives in the repo. Null means cash. */
    receiverRef: text("receiver_ref"),
    rail: text("rail", { enum: ["ON", "OFF"] })
      .notNull()
      .generatedAlwaysAs(sql`case when receiver_ref is null then 'OFF' else 'ON' end`),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    checkIn("members_lang_ck", t.lang, LANGS),
    checkProvenance("members", t.provenance),
    unique("members_member_no_uq").on(t.workspaceId, t.memberNo),
    wsIdUnique("members", t),
    wsFk("members_coop_fk", t, t.coopId, coops),
  ],
);

export const plots = pgTable(
  "plots",
  {
    id: id(),
    workspaceId: workspaceId(),
    memberId: uuid("member_id").notNull(),
    /** P-053-B */
    plotCode: text("plot_code").notNull(),
    trees: integer("trees").notNull(),
    areaHa: numeric("area_ha", { precision: 8, scale: 4 }),
    /** never public */
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lon: numeric("lon", { precision: 9, scale: 6 }),
    registeredAt: tstz("registered_at"),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    check("plots_trees_ck", sql`${t.trees} >= 0`),
    checkProvenance("plots", t.provenance),
    unique("plots_plot_code_uq").on(t.workspaceId, t.plotCode),
    wsIdUnique("plots", t),
    wsFk("plots_member_fk", t, t.memberId, members),
  ],
);

export const seasons = pgTable(
  "seasons",
  {
    id: id(),
    workspaceId: workspaceId(),
    coopId: uuid("coop_id").notNull(),
    /** ID code, e.g. 2026A */
    code: text("code").notNull(),
    /** Display label, e.g. 2026-A */
    label: text("label").notNull(),
    opensOn: date("opens_on").notNull(),
    closesOn: date("closes_on").notNull(),
    /** Time zone in which slip dates are written; I2 compares slip_date to ratified_at in this zone. */
    tz: text("tz").notNull().default("Asia/Manila"),
    currency: currency().notNull(),
    cosignBatchCents: cents("cosign_batch_cents").notNull(),
    cosignLineCents: cents("cosign_line_cents").notNull(),
    massBalanceTolBp: integer("mass_balance_tol_bp").notNull(),
    kgPerTreeMaxG: integer("kg_per_tree_max_g").notNull(),
    autoAcceptBp: integer("auto_accept_bp").notNull(),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    check("seasons_code_ck", sql`${t.code} ~ '^[0-9]{4}[A-Z]$'`),
    check("seasons_dates_ck", sql`${t.opensOn} <= ${t.closesOn}`),
    checkCurrency("seasons_currency_ck", t.currency),
    check("seasons_auto_accept_bp_ck", sql`${t.autoAcceptBp} between 0 and 10000`),
    checkProvenance("seasons", t.provenance),
    unique("seasons_code_uq").on(t.workspaceId, t.code),
    wsIdUnique("seasons", t),
    wsFk("seasons_coop_fk", t, t.coopId, coops),
  ],
);

/**
 * The season's terms, which belong to its rate card (register §2: the Chair co-signs any batch over US$300 and any
 * line over US$150, mass-balance tolerance ±2.0%, yield limit 1.6 kg per tree, auto-accept at 0.85), with the zone,
 * currency and dates the card's rules are read in. Once the card is ratified none of them changes, for any role
 * (I2, migrations/0008: `FS409 RATE_CARD_RATIFIED:<card sha256>`). `repos(scope).seasons.update` never writes them;
 * `seasons.setRules()` does, while the card is still a draft.
 */
export const SEASON_RULE_COLUMNS = [
  "tz",
  "currency",
  "opensOn",
  "closesOn",
  "cosignBatchCents",
  "cosignLineCents",
  "massBalanceTolBp",
  "kgPerTreeMaxG",
  "autoAcceptBp",
] as const satisfies readonly (keyof typeof seasons.$inferInsert)[];

export const lots = pgTable(
  "lots",
  {
    id: id(),
    workspaceId: workspaceId(),
    seasonId: uuid("season_id").notNull(),
    /** LB-PH-2026-03 */
    lotCode: text("lot_code").notNull(),
    sacks: integer("sacks").notNull(),
    shippedG: grams("shipped_g").notNull(),
    grade1ShippedG: grams("grade1_shipped_g").notNull(),
    shippedOn: date("shipped_on"),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    check("lots_grams_ck", sql`${t.grade1ShippedG} between 0 and ${t.shippedG}`),
    checkProvenance("lots", t.provenance),
    unique("lots_lot_code_uq").on(t.workspaceId, t.lotCode),
    wsIdUnique("lots", t),
    wsFk("lots_season_fk", t, t.seasonId, seasons),
  ],
);

export const rateCards = pgTable(
  "rate_cards",
  {
    id: id(),
    workspaceId: workspaceId(),
    seasonId: uuid("season_id").notNull(),
    /** BR 2026-04 */
    code: text("code").notNull(),
    /** RFC 8785 JCS of the whole card, rules and GA citation included */
    canonicalJcs: text("canonical_jcs").notNull(),
    sha256: sha256("sha256").notNull(),
    ratifiedAt: tstz("ratified_at"),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    checkSha("rate_cards_sha256_ck", t.sha256),
    check(
      "rate_cards_sha256_matches_ck",
      sql`${t.sha256} = encode(sha256(convert_to(${t.canonicalJcs}, 'UTF8')), 'hex')`,
    ),
    checkProvenance("rate_cards", t.provenance),
    unique("rate_cards_season_uq").on(t.workspaceId, t.seasonId),
    unique("rate_cards_sha256_uq").on(t.workspaceId, t.sha256),
    wsIdUnique("rate_cards", t),
    wsFk("rate_cards_season_fk", t, t.seasonId, seasons),
  ],
);

export const RULE_KINDS = ["SHARE", "DEDUCTION"] as const;

export const rateRules = pgTable(
  "rate_rules",
  {
    id: id(),
    workspaceId: workspaceId(),
    rateCardId: uuid("rate_card_id").notNull(),
    /** R0..R4 */
    ruleId: text("rule_id").notNull(),
    kind: text("kind", { enum: RULE_KINDS }).notNull(),
    category: text("category").notNull(),
    basis: text("basis").notNull(),
    /** integer parameters only (I1: the model never writes a number; values are re-parsed by code) */
    params: jsonb("params").notNull(),
    sourcePage: integer("source_page"),
    sourceBbox: jsonb("source_bbox"),
    sourceQuote: text("source_quote").notNull(),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    checkIn("rate_rules_kind_ck", t.kind, RULE_KINDS),
    check("rate_rules_rule_id_ck", sql`${t.ruleId} ~ '^R[0-9]+$'`),
    checkProvenance("rate_rules", t.provenance),
    unique("rate_rules_rule_uq").on(t.rateCardId, t.ruleId),
    wsIdUnique("rate_rules", t),
    wsFk("rate_rules_card_fk", t, t.rateCardId, rateCards),
  ],
);

export const ratifications = pgTable(
  "ratifications",
  {
    id: id(),
    workspaceId: workspaceId(),
    rateCardId: uuid("rate_card_id").notNull(),
    /** persona or user id, e.g. secretary:theresa */
    approverId: text("approver_id").notNull(),
    role: text("role").notNull(),
    keyId: text("key_id"),
    payloadJcs: text("payload_jcs"),
    signature: text("signature"),
    signedAt: tstz("signed_at").notNull(),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    checkProvenance("ratifications", t.provenance),
    unique("ratifications_approver_uq").on(t.rateCardId, t.approverId),
    wsIdUnique("ratifications", t),
    wsFk("ratifications_card_fk", t, t.rateCardId, rateCards),
  ],
);
