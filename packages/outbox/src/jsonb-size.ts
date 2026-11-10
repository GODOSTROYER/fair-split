import type { JsonValue } from "@fairsplit/db";

/** Bytes in PostgreSQL's jsonb::text, including separator spaces and decimal exponent expansion. */
export function jsonbBytes(value: JsonValue): number {
  if (value === null) return 4;
  if (typeof value === "number") {
    const text = JSON.stringify(value);
    const [mantissa, exponent] = text.split("e");
    if (exponent === undefined || mantissa === undefined) return text.length;
    const sign = mantissa.startsWith("-") ? 1 : 0;
    const digits = mantissa.replace(/[-.]/g, "").length;
    const shift = Number(exponent);
    return sign + (shift < 0 ? 1 - shift + digits : Math.max(1 + shift, digits));
  }
  if (typeof value !== "object") return Buffer.byteLength(JSON.stringify(value));
  if (Array.isArray(value)) {
    return 2 + Math.max(0, value.length - 1) * 2 + value.reduce<number>((sum, v) => sum + jsonbBytes(v), 0);
  }
  const entries = Object.entries(value);
  return (
    2 +
    Math.max(0, entries.length - 1) * 2 +
    entries.reduce((sum, [key, v]) => sum + Buffer.byteLength(JSON.stringify(key)) + 2 + jsonbBytes(v), 0)
  );
}
