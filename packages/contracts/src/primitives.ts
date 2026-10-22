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

// ---------------------------------------------------------------- key IDs (S3.8, register C-13)
// Every key ID is anchored lowercase ASCII with bounded parts. `{persona}` is 1-24 letters and is
// never `ledger` or `demo` (those words mark the server's ledger keys and demo keys); `{n}` is
// 1-9999 with no leading zero; a demo key's suffix is exactly 6 of [a-z0-9].

/** Each key ID shape, the one source for the schemas below and for the domain's sample rule. */
export const KEY_ID_PATTERNS = {
  /** A person's app key in SecureStore behind biometrics: `fs-{persona}-a{n}` (`fs-ernesto-a1`). */
  app: /^fs-(?!(?:ledger|demo)-)[a-z]{1,24}-a[1-9][0-9]{0,3}$/,
  /** A persisted non-extractable WebCrypto key: `fs-{persona}-w{n}` (the treasurer's `fs-analyn-w1`). */
  web: /^fs-(?!(?:ledger|demo)-)[a-z]{1,24}-w[1-9][0-9]{0,3}$/,
  /** A labelled browser key made for one judge session (C-13): `fs-{persona}-demo-{6}`. */
  demo: /^fs-(?!(?:ledger|demo)-)[a-z]{1,24}-demo-[a-z0-9]{6}$/,
  /** A seed-only officer key: `fs-{persona}-s{n}`. */
  seeded: /^fs-(?!(?:ledger|demo)-)[a-z]{1,24}-s[1-9][0-9]{0,3}$/,
  /** The server's ledger signing key: `fs-ledger-k{n}`. */
  ledger: /^fs-ledger-k[1-9][0-9]{0,3}$/,
  /** A seed-only ledger key: `fs-ledger-s{n}`. */
  seededLedger: /^fs-ledger-s[1-9][0-9]{0,3}$/,
} as const;

/**
 * A key a person holds: an app key (`a`), a persisted browser key (`w`) or a judge-session demo key
 * (`demo`). Only these are registered in `device_keys` or accepted by the API.
 */
export const DeviceKeyId = z
  .string()
  .regex(/^fs-(?!(?:ledger|demo)-)[a-z]{1,24}-(?:[aw][1-9][0-9]{0,3}|demo-[a-z0-9]{6})$/);
export type DeviceKeyId = z.infer<typeof DeviceKeyId>;

/**
 * A seed-only key: `fs-{persona}-s{n}`. Its private half derives from public text so the seeded
 * Proof verifies; it is labelled seeded, never registered in `device_keys` and never trusted.
 */
export const SeededKeyId = z.string().regex(KEY_ID_PATTERNS.seeded);
export type SeededKeyId = z.infer<typeof SeededKeyId>;

/**
 * Any key ID a signed approval may carry: a device key, or a seeded key in seeded data. Never a
 * ledger key ID: those are `LedgerKeyId` only.
 */
export const KeyId = z
  .string()
  .regex(/^fs-(?!(?:ledger|demo)-)[a-z]{1,24}-(?:[aws][1-9][0-9]{0,3}|demo-[a-z0-9]{6})$/);
export type KeyId = z.infer<typeof KeyId>;

/** The server's ledger signing key: `fs-ledger-k{n}`; a seed-only key is `fs-ledger-s{n}`. */
export const LedgerKeyId = z.string().regex(/^fs-ledger-[ks][1-9][0-9]{0,3}$/);
export type LedgerKeyId = z.infer<typeof LedgerKeyId>;

/** A seed-only key, officer (`fs-{persona}-s{n}`) or ledger (`fs-ledger-s{n}`). */
export function isSeededKeyId(keyId: string): boolean {
  return KEY_ID_PATTERNS.seeded.test(keyId) || KEY_ID_PATTERNS.seededLedger.test(keyId);
}

/** Raw 32-byte Ed25519 public key, lowercase hex. */
export const Ed25519PublicKeyHex = z.string().regex(/^[0-9a-f]{64}$/);
export type Ed25519PublicKeyHex = z.infer<typeof Ed25519PublicKeyHex>;

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
