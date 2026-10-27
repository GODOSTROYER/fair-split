/**
 * Payloads stored in jsonb and hashed into the ledger must survive the round trip byte-for-byte under JCS.
 * `toJsonValue` normalises once, before hashing and storing: bigint → decimal string (money stays exact),
 * Date → ISO-8601, undefined object members dropped; NaN, ±Infinity, functions, symbols and \u0000 (which jsonb
 * rejects) are refused.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function toJsonValue(value: unknown, path = "$"): JsonValue {
  if (value === null) return null;
  switch (typeof value) {
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`${path}: ${value} is not representable in JSON`);
      return Object.is(value, -0) ? 0 : value;
    case "bigint":
      return value.toString(10);
    case "string":
      if (value.includes("\u0000")) throw new TypeError(`${path}: NUL characters cannot be stored in jsonb`);
      if (LONE_SURROGATE.test(value)) throw new TypeError(`${path}: lone surrogate`);
      return value;
    case "object": {
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) throw new TypeError(`${path}: invalid Date`);
        return value.toISOString();
      }
      if (Array.isArray(value))
        return value.map((v, i) => toJsonValue(v === undefined ? null : v, `${path}[${i}]`));
      const out: { [key: string]: JsonValue } = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === undefined) continue;
        if (k.includes("\u0000")) throw new TypeError(`${path}: NUL in key`);
        // defineProperty, not assignment: a "__proto__" key must stay data, never become a prototype
        Object.defineProperty(out, k, {
          value: toJsonValue(v, `${path}.${k}`),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    default:
      throw new TypeError(`${path}: ${typeof value} is not JSON`);
  }
}

export function toJsonObject(value: unknown, path = "$"): { [key: string]: JsonValue } {
  const v = toJsonValue(value, path);
  if (v === null || typeof v !== "object" || Array.isArray(v))
    throw new TypeError(`${path}: expected an object`);
  return v;
}
