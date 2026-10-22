// The key a client address is budgeted under (per-IP certificate-fetch budget, ./verify.ts).
//
// IPv4 addresses count one by one. IPv6 addresses count by /64: one subscriber usually holds a whole
// /64, so per-address budgets would be free to multiply. IPv4-mapped IPv6 (::ffff:a.b.c.d) counts as
// its IPv4 address. Anything else (missing, junk) shares one "unknown" budget, so it can never buy a
// fresh budget per request.

import { isIP } from "node:net";

export const UNKNOWN_CLIENT = "unknown";

/** Expand a valid IPv6 address (no zone) to its 8 hextets. */
function hextets(address: string): number[] | null {
  let text = address.toLowerCase();
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.split(".").map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tailParts = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups =
    halves.length === 2
      ? [...head, ...Array<string>(8 - head.length - tailParts.length).fill("0"), ...tailParts]
      : head;
  if (groups.length !== 8) return null;
  return groups.map((g) => Number.parseInt(g, 16));
}

/** Budget key for a client address: the IPv4 address, the IPv6 /64, or "unknown". */
export function clientIpKey(value: string | null | undefined): string {
  if (!value) return UNKNOWN_CLIENT;
  let address = value.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(address);
  if (bracketed?.[1]) address = bracketed[1];
  const zone = address.indexOf("%");
  if (zone >= 0) address = address.slice(0, zone);
  const kind = isIP(address);
  if (kind === 4) return address;
  if (kind !== 6) return UNKNOWN_CLIENT;
  const groups = hextets(address);
  if (!groups) return UNKNOWN_CLIENT;
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) {
    const [, , , , , , hi = 0, lo = 0] = groups;
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}
