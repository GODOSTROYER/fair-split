// The Postman collection (postman/, WS-QA): it is what postman/build.mjs builds, it only ever targets a local keyless
// stack, and its sandbox library (postman/lib.cjs) signs, canonicalises and verifies exactly as fs-api does:
// Ed25519 against node:crypto, JCS against the domain's own `canonicalize`, Proof verify on a bundle built here.
import { spawnSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(import.meta.url);
const { createFairSplitLib } = require(resolve(root, "postman/lib.cjs"));
const canonicalizeModule = createRequire(resolve(root, "packages/domain/package.json"))("canonicalize");
const canonicalize = canonicalizeModule.default ?? canonicalizeModule;
const { COLLECTION_PATH, script } = await import(resolve(root, "postman/build.mjs"));
const { localOrigin, parseArgs, summarise, NEWMAN_VERSION } = await import(resolve(root, "postman/run.mjs"));

const sha256Hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const fair = createFairSplitLib({
  sha512: (b) => new Uint8Array(createHash("sha512").update(b).digest()),
  sha256Hex,
});

/** A node:crypto Ed25519 key from a 32-byte seed (PKCS#8 prefix for a raw seed). */
function nodeKey(seed) {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const publicKeyHex = Buffer.from(
    createPublicKey(privateKey).export({ format: "jwk" }).x,
    "base64url",
  ).toString("hex");
  return { privateKey, publicKeyHex };
}

const requests = (items) => items.flatMap((i) => (i.item ? requests(i.item) : [i]));
const collection = JSON.parse(readFileSync(COLLECTION_PATH, "utf8"));
const environment = JSON.parse(
  readFileSync(resolve(root, "postman/localhost.postman_environment.json"), "utf8"),
);

describe("the Postman collection", () => {
  it("is exactly what postman/build.mjs builds (rebuild with `node postman/build.mjs`)", () => {
    // plain Node, not Vitest: the scripts are function bodies, and Vitest's transform would change their text
    const r = spawnSync(process.execPath, [resolve(root, "postman/build.mjs"), "--check"], {
      encoding: "utf8",
    });
    expect(r.stderr + r.stdout).toContain("postman collection is up to date");
    expect(r.status).toBe(0);
    expect(collection.info.schema).toBe(
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    );
  });

  it("targets only {{baseUrl}} or {{simBaseUrl}}, never a literal host", () => {
    const urls = requests(collection.item).map((r) => r.request.url);
    expect(urls.length).toBeGreaterThan(60);
    for (const u of urls) expect(u, u).toMatch(/^\{\{(baseUrl|simBaseUrl)\}\}\//);
  });

  it("names every request uniquely (polls re-run themselves by name) and tests every one", () => {
    const all = requests(collection.item);
    const names = all.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    for (const r of all)
      expect(
        r.event?.some((e) => e.listen === "test"),
        r.name,
      ).toBe(true);
  });

  it("covers the judge loop, Proof verify and the four labelled failure paths", () => {
    expect(collection.item.map((f) => f.name)).toEqual([
      "0 Setup",
      "1 The judge's 60-second loop",
      "2 Proof verify",
      "3 Labelled failure paths",
    ]);
    const failures = collection.item[3].item.map((f) => f.name);
    expect(failures).toEqual([
      "3a Insufficient funds (ERRPYO005)",
      "3b Tamper refused after both keys (I4)",
      "3c Duplicate webhook delivery",
      "3d Pairing token reused",
    ]);
  });

  it("carries no credential: no fs-api token shape, no simulator secret, an empty environment but loopback", () => {
    const text = readFileSync(COLLECTION_PATH, "utf8") + JSON.stringify(environment);
    expect(text).not.toMatch(/\bfs[tdpmb]_[A-Za-z0-9_-]{20,}/);
    expect(text).not.toContain("not-a-paypal-secret");
    const values = Object.fromEntries(environment.values.map((v) => [v.key, v.value]));
    expect(values).toEqual({
      baseUrl: "http://127.0.0.1:8787",
      simBaseUrl: "",
      simClientId: "",
      simClientSecret: "",
    });
  });

  it("script() keeps a function's body, dedented, with ARGS first", () => {
    function sample() {
      const x = 1;
      if (x) {
        return x;
      }
    }
    expect(script(sample, { a: 1 })).toEqual([
      'const ARGS = {"a":1};',
      "const x = 1;",
      "if (x) {",
      "  return x;",
      "}",
    ]);
  });
});

describe("postman/run.mjs", () => {
  it("runs only against a loopback http origin", () => {
    expect(localOrigin("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(localOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
    for (const bad of [
      "https://fs-api.onrender.com",
      "http://fs-api.onrender.com",
      "https://127.0.0.1:8787",
      "http://10.0.0.5:8787",
      "http://127.0.0.1:8787/v1",
    ]) {
      expect(() => localOrigin(bad), bad).toThrow(/local keyless stack/);
    }
    expect(() => localOrigin(null)).toThrow(/--base-url/);
  });

  it("parses its flags and passes everything after -- to newman", () => {
    const o = parseArgs(["--base-url", "http://127.0.0.1:1", "--no-sim", "--", "--bail"]);
    expect(o).toMatchObject({ baseUrl: "http://127.0.0.1:1", sim: false, extra: ["--bail"] });
    expect(() => parseArgs(["--nope"])).toThrow(/unknown argument/);
  });

  it("pins newman to an exact version", () => {
    expect(NEWMAN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("summarises newman's JSON report", () => {
    const report = {
      run: {
        stats: {
          requests: { total: 3, failed: 0 },
          testScripts: { total: 6, failed: 0 },
          assertions: { total: 9, failed: 1 },
        },
        timings: { started: 0, completed: 2500, responseAverage: 12, responseMin: 2, responseMax: 40 },
        failures: [{ source: { name: "1.01 x" }, error: { test: "t", message: "m" } }],
      },
    };
    expect(summarise(report)).toBe(
      [
        "requests     3 (0 failed)",
        "test scripts 6 (0 failed)",
        "assertions   9 (1 failed)",
        "duration     2.5 s; responses avg 12 ms, min 2 ms, max 40 ms",
        "FAILED 1.01 x: t m",
      ].join("\n"),
    );
  });
});

describe("postman/lib.cjs", () => {
  it("Ed25519: the same public key and signature bytes as node:crypto, and its verify agrees", () => {
    for (let i = 0; i < 12; i++) {
      const seed = randomBytes(32);
      const { privateKey, publicKeyHex } = nodeKey(seed);
      const message = `{"approverId":"board:ernesto","n":${i},"note":"₱ ✓ ñ 𝄞"}`;
      const theirs = sign(null, Buffer.from(message, "utf8"), privateKey).toString("hex");
      expect(fair.ed25519.publicKeyHex(seed.toString("hex"))).toBe(publicKeyHex);
      expect(fair.ed25519.sign(seed.toString("hex"), message)).toBe(theirs);
      expect(fair.ed25519.verify(publicKeyHex, message, theirs)).toBe(true);
      expect(fair.ed25519.verify(publicKeyHex, `${message} `, theirs)).toBe(false);
      const flipped = (theirs[0] === "0" ? "1" : "0") + theirs.slice(1);
      expect(fair.ed25519.verify(publicKeyHex, message, flipped)).toBe(false);
    }
  });

  it("Ed25519 verify never throws on malformed input", () => {
    const { publicKeyHex } = nodeKey(randomBytes(32));
    for (const [k, s] of [
      ["", ""],
      ["zz", "00"],
      [publicKeyHex, "ab"],
      ["f".repeat(64), "0".repeat(128)],
      [publicKeyHex, "f".repeat(128)],
    ]) {
      expect(fair.ed25519.verify(k, "m", s)).toBe(false);
    }
  });

  it("JCS: byte for byte what the domain's canonicalize gives", () => {
    const values = [
      { b: 1, a: [true, null, "x"], é: { z: 0.1, y: -0, x: 1e21, w: 1e-7 } },
      { v: 1, purpose: "fs.register-demo-key", ws: "0", approverId: "board:ernesto", publicKeyHex: "ab" },
      [" ", '"quoted"', "tab\t", { "\u{1F600}": 1, דּ: 2, a: 3 }],
      { nested: { deeper: [{ k: 2, j: [] }, {}] }, n: 4.5e-3, big: 123456789012345 },
    ];
    for (const v of values) expect(fair.jcs(v)).toBe(canonicalize(v));
  });

  it("finds the most specific OpenAPI path and its response schema", () => {
    const doc = {
      paths: {
        "/v1/proof/{runSlug}": {
          get: {
            operationId: "proof",
            responses: { 200: { content: { "application/json": { schema: { $ref: "#/a" } } } } },
          },
        },
        "/v1/proof/{runSlug}/metrics": { get: { operationId: "proof.metrics", responses: { 200: {} } } },
        "/v1/runs/{runSlug}/approvals": { post: { operationId: "submitApproval", responses: {} } },
      },
    };
    expect(fair.responseSchema(doc, "GET", "/v1/proof/2026A-r1", 200)).toMatchObject({
      operationId: "proof",
      schema: { $ref: "#/a" },
    });
    expect(fair.responseSchema(doc, "GET", "/v1/proof/2026A-r1/metrics", 200)).toMatchObject({
      operationId: "proof.metrics",
      schema: null,
    });
    expect(fair.responseSchema(doc, "GET", "/v1/runs/2026A-r1/approvals", 200).operationId).toBe(null);
  });

  it("inv.i8.postman: flags any PayPal-derived value that does not read simulated", () => {
    const ok = {
      run: { provenance: "simulated_rail" },
      invoice: { paypalInvoiceId: "INV2-SIM7-335X-QKIV-MQGB", provenance: "simulated_rail" },
      items: [{ payoutItemId: "SIMWE6EDWDU3D", eventId: "WH-SIMEMC2QM727CK6S9-07G4MSA3XECP0TZ8L" }],
      error: { debug_id: "sim-886c58ee0e9c" },
      replayed: { paypalInvoiceId: "INV2-SIM7-335X-QKIV-MQGB", provenance: "replay" },
    };
    expect(fair.simLabelIssues(ok)).toEqual({ issues: [], seen: 7 });
    const bad = {
      invoice: { paypalInvoiceId: "INV2-ABCD-335X-QKIV-MQGB", provenance: "live" },
      items: [{ payoutItemId: "5ZK4XB3A9E2LS", eventId: "WH-1AB23456CD789012E-3F456789GH012345J" }],
      error: { debug_id: "f1e2d3c4b5a69" },
    };
    expect(fair.simLabelIssues(bad).issues).toEqual([
      "$.invoice.provenance=live",
      "$.invoice.paypalInvoiceId=INV2-ABCD-335X-QKIV-MQGB",
      "$.items[0].payoutItemId=5ZK4XB3A9E2LS",
      "$.items[0].eventId=WH-1AB23456CD789012E-3F456789GH012345J",
      "$.error.debug_id=f1e2d3c4b5a69",
    ]);
  });

  describe("Proof verify on a bundle signed here", () => {
    const officer = (role) => ({ role, seed: randomBytes(32) });
    const keys = [officer("treasurer"), officer("chair")].map((o) => ({ ...o, ...nodeKey(o.seed) }));
    const ledgerKey = nodeKey(randomBytes(32));
    const canon = (memberNo, rail, net) => ({
      v: 1,
      memberNo,
      rail,
      premiumCents: net,
      bonusCents: 0,
      deductions: [],
      credits: [],
      netCents: net,
    });
    const lines = [
      canon("M-002", "PAYPAL", 3027),
      canon("M-001", "CASH", 6320),
      canon("M-003", "PAYPAL", 1200),
    ].map((c) => ({
      memberNo: c.memberNo,
      rail: c.rail,
      premiumCents: c.premiumCents,
      bonusCents: 0,
      deductionsCents: 0,
      creditsCents: 0,
      netCents: c.netCents,
      canonical: c,
      lineSha256: sha256Hex(fair.jcs(c)),
    }));
    const items = lines
      .filter((l) => l.rail === "PAYPAL")
      .map((l) => ({ amountCents: l.netCents, payoutItemId: "SIMAAAAAAAAAA", receiver: "withheld" }));
    const batchSha256 = sha256Hex("batch");
    const approvals = keys.map((k) => {
      const payload = {
        v: 1,
        role: k.role,
        batchSha256,
        linesDigest: fair.linesRoot(lines),
        itemCount: items.length,
        totalCents: 4227,
        currency: "USD",
      };
      const signatureHex = sign(null, Buffer.from(fair.jcs(payload), "utf8"), k.privateKey).toString("hex");
      return { role: k.role, keyId: `k-${k.role}`, publicKeyHex: k.publicKeyHex, payload, signatureHex };
    });
    const ledger = [];
    for (const [i, kind] of ["rate_card.ratified", "lines.computed", "batch.posted"].entries()) {
      const prevHash = ledger.at(-1)?.entryHash ?? "0".repeat(64);
      const e = {
        seq: i + 1,
        kind,
        actorKind: "system",
        actorId: "fs-api",
        impersonatedBy: null,
        payload: { i },
        at: "2026-11-04T00:00:00.000Z",
      };
      ledger.push({ ...e, prevHash, entryHash: sha256Hex(prevHash + fair.jcs(e)) });
    }
    const cp = {
      v: 1,
      runId: "r",
      seq: 3,
      entryHash: ledger[2].entryHash,
      at: "2026-11-04T00:00:01.000Z",
      keyId: "fs-ledger-k1",
    };
    const cpJcs = fair.jcs({ purpose: "fairsplit.ledger.checkpoint", ...cp });
    const checkpoint = {
      ...cp,
      signatureHex: sign(null, Buffer.from(cpJcs, "utf8"), ledgerKey.privateKey).toString("hex"),
    };
    const bundle = { lines, approvals, batch: { batchSha256, items }, ledger, checkpoint };
    const published = { "fs-ledger-k1": ledgerKey.publicKeyHex };

    it("a faithful bundle verifies in every part", () => {
      const r = fair.verifyProof(bundle, published);
      expect(r.lines).toEqual({ total: 3, badLines: [], unbalanced: [] });
      expect(r.approvals.every((a) => a.linesRootMatches && a.batchMatches && a.signatureOk)).toBe(true);
      expect(r.batch).toMatchObject({
        itemCount: 2,
        itemsCents: 4227,
        paypalNetCents: 4227,
        signedTotalCents: 4227,
      });
      expect(r.chain).toMatchObject({ ok: true, length: 3 });
      expect(r.checkpoint).toEqual({ keyPublished: true, headMatches: true, signatureOk: true });
    });

    it("inv.i4.postman: one cent moved on a line breaks its hash, and re-hashing it breaks both signed roots", () => {
      const altered = structuredClone(bundle);
      altered.lines[0].canonical.netCents += 1;
      altered.lines[0].netCents += 1;
      expect(fair.verifyProof(altered, published).lines.badLines).toEqual(["M-002"]);
      altered.lines[0].lineSha256 = sha256Hex(fair.jcs(altered.lines[0].canonical));
      const r = fair.verifyProof(altered, published);
      expect(r.lines.badLines).toEqual([]);
      expect(r.approvals.map((a) => a.linesRootMatches)).toEqual([false, false]);
    });

    it("a re-chained ledger or an unpublished checkpoint key fails", () => {
      const rechained = structuredClone(bundle);
      rechained.ledger[1].payload = { i: 99 };
      expect(fair.verifyProof(rechained, published).chain).toMatchObject({ ok: false, brokenAtSeq: 2 });
      expect(fair.verifyProof(bundle, {}).checkpoint).toEqual({
        keyPublished: false,
        headMatches: true,
        signatureOk: false,
      });
    });
  });
});
