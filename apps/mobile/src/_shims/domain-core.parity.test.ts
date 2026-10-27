/**
 * `domain-core.ts` is WS-CORE's digest code, copied byte for byte (the package itself may not reach UI code, register
 * §6). This test is the guard: every copied declaration must still be the package's text, `sha256Hex` must hash like
 * node:crypto (the package's own hash), and the copies must reproduce what the package produced for the seed run.
 * The package's files are read as text, never imported, so the app still depends on nothing but `contracts`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  batchCanonical,
  batchDigest,
  jcs,
  jcsSha256,
  linesDigest,
  linesRootJcs,
  parseSenderItemId,
  sha256Hex,
} from "./domain-core";

const DOMAIN_SRC = new URL("../../../../packages/domain/src/", import.meta.url);
const SNAPSHOT = new URL("../../../../packages/seed/snapshot/season-2026A.json", import.meta.url);
const read = (url: URL) => readFileSync(url, "utf8").replaceAll("\r\n", "\n");
const COPY = read(new URL("./domain-core.ts", import.meta.url));

/** `export function NAME(` or `export interface NAME {` up to its closing brace at the start of a line. */
function declaration(src: string, kind: "function" | "interface", name: string): string {
  const head = kind === "function" ? `export function ${name}(` : `export interface ${name} {`;
  const start = src.indexOf(head);
  if (start < 0) throw new Error(`${head} not found`);
  const end = src.indexOf("\n}\n", start);
  if (end < 0) throw new Error(`${name} has no closing brace`);
  return src.slice(start, end + 2);
}

const COPIED: readonly [file: string, kind: "function" | "interface", name: string][] = [
  ["jcs.ts", "function", "jcs"],
  ["jcs.ts", "function", "jcsBytes"],
  ["canon.ts", "function", "jcsSha256"],
  ["digest-input.ts", "interface", "BatchRun"],
  ["digest-input.ts", "interface", "BatchCanonical"],
  ["digest-input.ts", "function", "batchCanonical"],
  ["digest-input.ts", "function", "linesRootJcs"],
  ["digest-input.ts", "function", "approvalBytes"],
  ["batch.ts", "function", "batchDigest"],
  ["approval.ts", "function", "linesDigest"],
  ["ids.ts", "function", "parseSenderItemId"],
];

interface SnapshotLine {
  memberNo: string;
  rail: string;
  netCents: number;
  canonical: unknown;
  lineSha256: string;
}
interface Snapshot {
  run: {
    id: string;
    senderBatchId: string;
    batchSha256: string;
    items: { senderItemId: string; receiver: string; amountCents: number; currency: "USD" }[];
    approvals: { payload: { linesDigest: string; batchSha256: string } }[];
  };
  rateCard: { sha256: string };
  proof: { lines: SnapshotLine[] };
}

describe("domain-core is @fairsplit/domain's code (register §6 keeps the package out of the app)", () => {
  it.each(COPIED)("%s: %s %s is the package's text, byte for byte", (file, kind, name) => {
    const real = declaration(read(new URL(file, DOMAIN_SRC)), kind, name);
    expect(declaration(COPY, kind, name)).toBe(real);
  });

  it("the package still hashes with node:crypto's sha256, the one function the app writes itself", () => {
    expect(read(new URL("canon.ts", DOMAIN_SRC))).toContain(
      'return createHash("sha256").update(data).digest("hex");',
    );
  });

  it("sha256Hex hashes exactly like node:crypto, for text and for bytes", () => {
    const node = (d: string | Uint8Array) => createHash("sha256").update(d).digest("hex");
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (s) => {
        expect(sha256Hex(s)).toBe(node(s));
      }),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (b) => {
        expect(sha256Hex(b)).toBe(node(b));
      }),
      { numRuns: 200 },
    );
  });
});

describe("the copies reproduce what the package computed for the seed run (packages/seed snapshot)", () => {
  const snap = JSON.parse(read(SNAPSHOT)) as Snapshot;
  const run = {
    runId: snap.run.id,
    senderBatchId: snap.run.senderBatchId,
    rateCardSha256: snap.rateCard.sha256,
  };

  it("batchSha256 of run r37's eight items", () => {
    const items = snap.run.items.map(({ senderItemId, receiver, amountCents, currency }) => ({
      senderItemId,
      receiver,
      amountCents,
      currency,
    }));
    expect(batchDigest(run, items).batchSha256).toBe(snap.run.batchSha256);
    expect(batchDigest(run, [...items].reverse()).batchSha256).toBe(snap.run.batchSha256);
    for (const a of snap.run.approvals) expect(a.payload.batchSha256).toBe(snap.run.batchSha256);
  });

  it("every line hash is sha256(JCS(canonical)), and linesDigest is the root both keys signed", () => {
    for (const l of snap.proof.lines) expect(jcsSha256(l.canonical), l.memberNo).toBe(l.lineSha256);
    const signed = snap.run.approvals.map((a) => a.payload.linesDigest);
    expect(new Set(signed).size).toBe(1);
    expect(linesDigest(snap.proof.lines)).toBe(signed[0]);
    expect(linesDigest([...snap.proof.lines].reverse())).toBe(signed[0]);
    expect(sha256Hex(linesRootJcs(snap.proof.lines))).toBe(signed[0]);
  });

  it("keeps the package's refusals: no empty batch, no duplicate item, no duplicate or missing member line", () => {
    expect(() => batchCanonical(run, [])).toThrow(RangeError);
    const [item] = snap.run.items;
    if (!item) throw new Error("the seed run has items");
    expect(() => batchCanonical(run, [item, item])).toThrow(/duplicate sender_item_id/);
    expect(() => batchCanonical(run, [{ ...item, amountCents: 0 }])).toThrow(RangeError);
    expect(() => linesDigest([])).toThrow(RangeError);
    const [line] = snap.proof.lines;
    if (!line) throw new Error("the seed run has lines");
    expect(() => linesDigest([line, line])).toThrow(/one line per member/);
    expect(() => jcs(undefined)).toThrow(TypeError);
  });

  it("reads sender_item_id as the register writes it, re-routes included", () => {
    expect(parseSenderItemId("r37-M-014")).toEqual({ runSeq: 37, rerouteN: null, memberNo: "M-014" });
    expect(parseSenderItemId("r37x2-M-031")).toEqual({ runSeq: 37, rerouteN: 2, memberNo: "M-031" });
    expect(parseSenderItemId("M-014")).toBeNull();
  });
});
