/**
 * Typed errors for the integrity rules enforced in SQL (migrations/0002 on). Triggers raise SQLSTATE FS409/FS422
 * with the message "<CODE>:<detail>"; `asDbError` turns a driver error (possibly wrapped by Drizzle) into a
 * `FairSplitDbError` the API can map, e.g. RATE_CARD_RATIFIED → 409 citing the card hash (MM-4).
 */
/** Codes raised by the SQL integrity layer. RATE_CARD_RATIFIED is the register's MM-4 code. */
export const DB_ERROR_CODES = [
  "RATE_CARD_RATIFIED",
  "RULES_BEFORE_FACTS",
  "APPEND_ONLY",
  "LEDGER_FORK",
  "ITEM_STATUS_REGRESSION",
  "RETURN_WITHOUT_CANCEL",
  "PURGE_REFUSED",
  /** a column that never changes once written, e.g. workspaces.kind (subject: "table.column") */
  "FROZEN_COLUMN",
] as const;
export type DbErrorCode = (typeof DB_ERROR_CODES)[number];

export class FairSplitDbError extends Error {
  override readonly name = "FairSplitDbError";
  constructor(
    readonly code: DbErrorCode,
    /** the part after "<CODE>:" — for RATE_CARD_RATIFIED, the card's sha256 */
    readonly subject: string,
    readonly sqlState: string,
    readonly detail: string | undefined,
    options?: { cause?: unknown },
  ) {
    super(`${code}:${subject}${detail ? ` (${detail})` : ""}`, options);
  }
  /** HTTP status the API should answer with */
  get httpStatus(): 409 | 422 {
    return this.sqlState === "FS422" ? 422 : 409;
  }
}

interface PgLikeError {
  code?: unknown;
  message?: unknown;
  detail?: unknown;
  cause?: unknown;
}

/** The Postgres error inside whatever wrapped it (Drizzle wraps driver errors as `cause`). */
export function pgError(e: unknown): (PgLikeError & { code: string; message: string }) | null {
  let cur: unknown = e;
  for (let depth = 0; depth < 5 && cur && typeof cur === "object"; depth++) {
    const c = cur as PgLikeError;
    if (typeof c.code === "string" && /^[0-9A-Z]{5}$/.test(c.code) && typeof c.message === "string") {
      return c as PgLikeError & { code: string; message: string };
    }
    cur = c.cause;
  }
  return null;
}

export function asDbError(e: unknown): FairSplitDbError | null {
  const pg = pgError(e);
  if (!pg || (pg.code !== "FS409" && pg.code !== "FS422")) return null;
  const idx = pg.message.indexOf(":");
  const code = (idx > 0 ? pg.message.slice(0, idx) : pg.message) as DbErrorCode;
  if (!DB_ERROR_CODES.includes(code)) return null;
  const subject = idx > 0 ? pg.message.slice(idx + 1) : "";
  return new FairSplitDbError(code, subject, pg.code, typeof pg.detail === "string" ? pg.detail : undefined, {
    cause: e,
  });
}

/** Re-throws integrity violations as FairSplitDbError; anything else unchanged. */
export function rethrowDbError(e: unknown): never {
  throw asDbError(e) ?? e;
}

/** SQLSTATE helpers for common driver-level outcomes. */
export const isUniqueViolation = (e: unknown) => pgError(e)?.code === "23505";
export const isPermissionDenied = (e: unknown) => pgError(e)?.code === "42501";
export const isCheckViolation = (e: unknown) => pgError(e)?.code === "23514";
export const isSerializationFailure = (e: unknown) => {
  const c = pgError(e)?.code;
  return c === "40001" || c === "40P01";
};
