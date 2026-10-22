// Primitive value schemas shared by every contract. Money is always integer minor units
// (US cents or PHP centavos); weights are integer grams. Nothing here is a float amount.
import { z } from "zod";

/** Integer minor units (cents for USD, centavos for PHP). Safe-integer range only. */
export const Cents = z.int();
export type Cents = z.infer<typeof Cents>;

export const NonNegCents = z.int().nonnegative();
export type NonNegCents = z.infer<typeof NonNegCents>;

/** Integer grams. Slip kilos are written to 0.01 kg, so 10 g is the finest unit used. */
export const Grams = z.int().nonnegative();
export type Grams = z.infer<typeof Grams>;

export const Currency = z.enum(["USD", "PHP"]);
export type Currency = z.infer<typeof Currency>;

export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "lowercase hex sha256");
export type Sha256Hex = z.infer<typeof Sha256Hex>;

export const Uuid = z.uuid();
export type Uuid = z.infer<typeof Uuid>;

export const IsoDate = z.iso.date();
export type IsoDate = z.infer<typeof IsoDate>;

export const IsoDateTime = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Member number as printed on slips: "M-014". */
export const MemberNo = z.string().regex(/^M-\d{3}$/);
export type MemberNo = z.infer<typeof MemberNo>;

/** Slip serial from the triplicate pad: "0457". */
export const SlipSerial = z.string().regex(/^\d{4}$/);
export type SlipSerial = z.infer<typeof SlipSerial>;

/** Season ID code used in identifiers: "2026A". */
export const SeasonCode = z.string().regex(/^\d{4}[A-Z]$/);
export type SeasonCode = z.infer<typeof SeasonCode>;

/** Season label used in copy and routes: "2026-A". */
export const SeasonLabel = z.string().regex(/^\d{4}-[A-Z]$/);
export type SeasonLabel = z.infer<typeof SeasonLabel>;

/** runSlug = `{seasonCode}-r{runSeq}`, e.g. "2026A-r37". */
export const RunSlug = z.string().regex(/^\d{4}[A-Z]-r\d+$/);
export type RunSlug = z.infer<typeof RunSlug>;

/** Photo IDs: the replay set A–L and the earlier photos P01–P54. Letters are IDs, not dates. */
export const PhotoId = z.string().regex(/^(?:[A-L]|P\d{2})$/);
export type PhotoId = z.infer<typeof PhotoId>;

/** Plot number as printed: "P-053-B". */
export const PlotNo = z.string().regex(/^P-\d{3}-[A-Z]$/);
export type PlotNo = z.infer<typeof PlotNo>;

/** Ed25519 key IDs: `fs-{persona}-{a|w}{n}`, e.g. "fs-ernesto-a1". */
export const KeyId = z.string().regex(/^fs-[a-z]+-[aw]\d+$/);
export type KeyId = z.infer<typeof KeyId>;

export const Lang = z.enum(["ceb", "fil", "en"]);
export type Lang = z.infer<typeof Lang>;
export const LANGS = Lang.options;

/** I8: every row carries one of these, and the UI renders it as a label. */
export const Provenance = z.enum(["live", "replay", "simulated_rail", "seeded"]);
export type Provenance = z.infer<typeof Provenance>;
export const PROVENANCES = Provenance.options;

/** A positive rational, e.g. an exchange rate as centavos per cent (62.50 PHP/USD = 125/2). */
export const Rational = z.strictObject({ num: z.int().positive(), den: z.int().positive() });
export type Rational = z.infer<typeof Rational>;

/** Money as sent to UI code, which may not import `domain`: the display string is made server-side. */
export const MoneyDTO = z.strictObject({
  cents: Cents,
  currency: Currency,
  display: z.string(),
});
export type MoneyDTO = z.infer<typeof MoneyDTO>;

/** Kilos as sent to UI code. */
export const KgDTO = z.strictObject({
  grams: Grams,
  display: z.string(),
});
export type KgDTO = z.infer<typeof KgDTO>;

/** Fixed per-run exchange rate. For display and peso-denominated ledger items only. */
export const Fx = z.strictObject({
  centavosPerCent: Rational,
  display: z.string(),
  source: z.string(),
});
export type Fx = z.infer<typeof Fx>;

/** Arbitrary JSON value (payloads, evidence). */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export const Json: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(Json), z.record(z.string(), Json)]),
);
