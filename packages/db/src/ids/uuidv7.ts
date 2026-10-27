/**
 * UUIDv7 (RFC 9562 §5.7), monotonic within a process.
 *
 * Layout: 48-bit Unix milliseconds | ver 0111 | 12-bit counter (rand_a) | var 10 | 62 random bits (rand_b).
 * Within one millisecond the 12-bit counter (seeded randomly in its lower half) increments, which is
 * RFC 9562 §6.2 method 1. On counter overflow, or if the wall clock steps backwards, the generator borrows
 * the next millisecond so ids stay strictly increasing; byte order then equals creation order, which keeps
 * B-tree inserts append-only. The database default `fs_uuidv7()` produces the same layout for SQL inserts.
 */
import { randomFillSync } from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

export interface Uuidv7Generator {
  (): string;
  /** Exposed for tests: generate with an explicit clock reading. */
  at(nowMs: number): string;
}

export function createUuidv7Generator(clock: () => number = Date.now): Uuidv7Generator {
  let lastMs = -1;
  let counter = 0;
  const rnd = new Uint8Array(10);

  const at = (nowMs: number): string => {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > 0xffff_ffff_ffff) {
      throw new RangeError(`uuidv7: timestamp out of range: ${nowMs}`);
    }
    randomFillSync(rnd);
    let ms = nowMs;
    if (ms > lastMs) {
      // fresh millisecond: seed the counter in [0, 0x7ff] so at least 2048 ids fit before borrowing
      counter = ((rnd[8] as number) << 4) | ((rnd[9] as number) >> 4);
      counter &= 0x7ff;
    } else {
      // same millisecond, or the clock went backwards: keep the previous millisecond and count up
      ms = lastMs;
      counter += 1;
      if (counter > 0xfff) {
        ms += 1;
        counter = 0;
      }
    }
    lastMs = ms;

    const b = new Uint8Array(16);
    b[0] = Math.floor(ms / 2 ** 40) & 0xff;
    b[1] = Math.floor(ms / 2 ** 32) & 0xff;
    b[2] = (ms >>> 24) & 0xff;
    b[3] = (ms >>> 16) & 0xff;
    b[4] = (ms >>> 8) & 0xff;
    b[5] = ms & 0xff;
    b[6] = 0x70 | ((counter >>> 8) & 0x0f);
    b[7] = counter & 0xff;
    b[8] = 0x80 | ((rnd[0] as number) & 0x3f);
    for (let i = 1; i < 8; i++) b[8 + i] = rnd[i] as number;

    let s = "";
    for (let i = 0; i < 16; i++) {
      s += HEX[b[i] as number];
      if (i === 3 || i === 5 || i === 7 || i === 9) s += "-";
    }
    return s;
  };

  const gen = (() => at(clock())) as Uuidv7Generator;
  gen.at = at;
  return gen;
}

/** Process-wide monotonic generator. */
export const uuidv7: () => string = createUuidv7Generator();

export function isUuidv7(value: string): boolean {
  return UUID_RE.test(value);
}

/** The Unix-millisecond timestamp embedded in a UUIDv7. */
export function uuidv7Timestamp(value: string): number {
  if (!isUuidv7(value)) throw new TypeError(`not a UUIDv7: ${value}`);
  return Number.parseInt(value.slice(0, 8) + value.slice(9, 13), 16);
}
