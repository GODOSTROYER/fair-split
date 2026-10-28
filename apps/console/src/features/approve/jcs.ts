// RFC 8785 (JCS) for the JSON this screen signs and hashes: objects with sorted keys, arrays in order, strings
// as ECMAScript JSON strings and integers as their shortest decimal. The approval payload and the lines root are
// exactly that shape, so the browser can rebuild the bytes the server hands it and refuse to sign when they
// differ (I4: the approved digest is the payout). Floats never occur in what Fair Split signs: they are refused.

export type JcsValue =
  | string
  | number
  | boolean
  | null
  | readonly JcsValue[]
  | { readonly [key: string]: JcsValue };

function compareKeys(a: string, b: string): number {
  // JCS sorts by UTF-16 code units, which is what plain string comparison does.
  return a < b ? -1 : a > b ? 1 : 0;
}

export function jcs(value: JcsValue): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) throw new RangeError("JCS here signs integers only");
      return String(value);
    default:
      break;
  }
  if (Array.isArray(value)) return `[${value.map((v) => jcs(v)).join(",")}]`;
  const object = value as { readonly [key: string]: JcsValue };
  const keys = Object.keys(object)
    .filter((k) => object[k] !== undefined)
    .sort(compareKeys);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(object[k] as JcsValue)}`).join(",")}}`;
}

/** UTF-8 bytes of a JCS string: exactly what an approver signs. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
