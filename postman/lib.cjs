// The Postman collection's helper library. build.mjs embeds this file's source in the collection-level pre-request
// script, which defines the global `fs` before every request; packages/test-kit/test/postman-collection.test.mjs
// loads the same file under Node and checks it against node:crypto and the domain's own JCS.
//
// Plain ES2020 with BigInt and no imports: Postman's script sandbox has no Ed25519 and no node:crypto, so the demo
// keys sign here. Hashing is injected (`sha512`, `sha256Hex`): CryptoJS in the sandbox, node:crypto in tests.
//
//   ed25519      RFC 8032 Ed25519 (seed → public key, sign, verify), BigInt field and group arithmetic
//   jcs          RFC 8785 JSON canonicalization (what fs-api signs and hashes)
//   schemas      validates a response against the OpenAPI document fs-api serves (/v1/openapi.json)
//   simLabels    every PayPal-derived id and provenance must read "simulated" (I8)
//   verifyProof  recomputes a Proof bundle: lines, lines root, both approvals, batch, ledger chain, checkpoint

function createFairSplitLib(deps) {
  const { sha512, sha256Hex } = deps;

  // ------------------------------------------------------------------ bytes

  function hexToBytes(hex) {
    if (typeof hex !== "string" || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
      throw new TypeError("not a hex string");
    }
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function bytesToHex(bytes) {
    let s = "";
    for (const b of bytes) s += b.toString(16).padStart(2, "0");
    return s;
  }

  function utf8(text) {
    const out = [];
    for (const ch of String(text)) {
      const c = ch.codePointAt(0);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return Uint8Array.from(out);
  }

  function concat(...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  // ------------------------------------------------------------------ Ed25519 (RFC 8032)

  const P = 2n ** 255n - 19n;
  const L = 2n ** 252n + 27742317777372353535851937790883648493n;
  const mod = (a, m = P) => {
    const r = a % m;
    return r >= 0n ? r : r + m;
  };
  const pow = (base, exp) => {
    let r = 1n;
    let b = mod(base);
    let e = exp;
    while (e > 0n) {
      if (e & 1n) r = mod(r * b);
      b = mod(b * b);
      e >>= 1n;
    }
    return r;
  };
  const inv = (a) => pow(a, P - 2n);
  const D = mod(-121665n * inv(121666n));
  const D2 = mod(2n * D);
  const SQRT_M1 = pow(2n, (P - 1n) / 4n);
  const GX = 15112221349535400772501151409588531511454012693041857206046113283949847762202n;
  const GY = 46316835694926478169428394003475163141307993866256225615783033603165251855960n;
  // extended coordinates (X, Y, Z, T), x = X/Z, y = Y/Z, xy = T/Z
  const BASE = [GX, GY, 1n, mod(GX * GY)];
  const ZERO = [0n, 1n, 1n, 0n];

  function add(p, q) {
    const [X1, Y1, Z1, T1] = p;
    const [X2, Y2, Z2, T2] = q;
    const A = mod((Y1 - X1) * (Y2 - X2));
    const B = mod((Y1 + X1) * (Y2 + X2));
    const C = mod(T1 * D2 * T2);
    const DD = mod(Z1 * 2n * Z2);
    const E = B - A;
    const F = DD - C;
    const G = DD + C;
    const H = B + A;
    return [mod(E * F), mod(G * H), mod(F * G), mod(E * H)];
  }

  function multiply(point, scalar) {
    let r = ZERO;
    let q = point;
    let k = scalar;
    while (k > 0n) {
      if (k & 1n) r = add(r, q);
      q = add(q, q);
      k >>= 1n;
    }
    return r;
  }

  function leToBig(bytes) {
    let n = 0n;
    for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
    return n;
  }

  function bigToLe32(n) {
    const out = new Uint8Array(32);
    let v = n;
    for (let i = 0; i < 32; i++) {
      out[i] = Number(v & 255n);
      v >>= 8n;
    }
    return out;
  }

  function encodePoint(p) {
    const zi = inv(p[2]);
    const x = mod(p[0] * zi);
    const y = mod(p[1] * zi);
    const out = bigToLe32(y);
    if (x & 1n) out[31] |= 0x80;
    return out;
  }

  function decodePoint(bytes) {
    if (bytes.length !== 32) return null;
    const b = Uint8Array.from(bytes);
    const sign = (b[31] & 0x80) !== 0;
    b[31] &= 0x7f;
    const y = leToBig(b);
    if (y >= P) return null;
    const y2 = mod(y * y);
    const u = mod(y2 - 1n);
    const v = mod(D * y2 + 1n);
    let x = mod(u * pow(v, 3n) * pow(u * pow(v, 7n), (P - 5n) / 8n));
    const vx2 = mod(v * x * x);
    if (vx2 === mod(-u)) x = mod(x * SQRT_M1);
    else if (vx2 !== u) return null;
    if (x === 0n && sign) return null;
    if (((x & 1n) === 1n) !== sign) x = mod(-x);
    return [x, y, 1n, mod(x * y)];
  }

  function expandSeed(seed) {
    if (seed.length !== 32) throw new RangeError("an Ed25519 seed is 32 bytes");
    const h = sha512(seed);
    const a = Uint8Array.from(h.slice(0, 32));
    a[0] &= 248;
    a[31] &= 127;
    a[31] |= 64;
    return { scalar: leToBig(a), prefix: h.slice(32, 64) };
  }

  const ed25519 = {
    publicKeyHex(seedHex) {
      const { scalar } = expandSeed(hexToBytes(seedHex));
      return bytesToHex(encodePoint(multiply(BASE, scalar)));
    },
    /** A detached signature (hex) over `message` (a string is signed as its UTF-8 bytes). */
    sign(seedHex, message) {
      const msg = typeof message === "string" ? utf8(message) : message;
      const { scalar, prefix } = expandSeed(hexToBytes(seedHex));
      const A = encodePoint(multiply(BASE, scalar));
      const r = mod(leToBig(sha512(concat(prefix, msg))), L);
      const R = encodePoint(multiply(BASE, r));
      const k = mod(leToBig(sha512(concat(R, A, msg))), L);
      const S = mod(r + k * scalar, L);
      return bytesToHex(concat(R, bigToLe32(S)));
    },
    /** Never throws: false for any malformed key or signature. */
    verify(publicKeyHex, message, signatureHex) {
      try {
        if (!/^[0-9a-f]{64}$/.test(publicKeyHex) || !/^[0-9a-f]{128}$/.test(signatureHex)) return false;
        const msg = typeof message === "string" ? utf8(message) : message;
        const Abytes = hexToBytes(publicKeyHex);
        const sig = hexToBytes(signatureHex);
        const A = decodePoint(Abytes);
        const R = decodePoint(sig.slice(0, 32));
        const S = leToBig(sig.slice(32));
        if (!A || !R || S >= L) return false;
        const k = mod(leToBig(sha512(concat(sig.slice(0, 32), Abytes, msg))), L);
        const left = encodePoint(multiply(BASE, S));
        const right = encodePoint(add(R, multiply(A, k)));
        return bytesToHex(left) === bytesToHex(right);
      } catch {
        return false;
      }
    },
  };

  // ------------------------------------------------------------------ JCS (RFC 8785)

  function jcs(value) {
    if (value === null) return "null";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new TypeError("JCS cannot carry a non-finite number");
      return JSON.stringify(value);
    }
    if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : jcs(v))).join(",")}]`;
    if (typeof value === "object") {
      const keys = Object.keys(value)
        .filter((k) => value[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(value[k])}`).join(",")}}`;
    }
    throw new TypeError(`JCS cannot carry a ${typeof value}`);
  }

  // ------------------------------------------------------------------ OpenAPI response schemas

  /** `/v1/runs/{runSlug}/approvals` → a RegExp over a request path, most specific (fewest params) first. */
  function pathMatchers(doc) {
    const out = [];
    for (const [template, ops] of Object.entries(doc.paths || {})) {
      const params = (template.match(/\{[^}]+\}/g) || []).length;
      const re = new RegExp(
        `^${template
          .split(/\{[^}]+\}/)
          .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("[^/]+")}$`,
      );
      out.push({ template, re, params, ops });
    }
    return out.sort((a, b) => a.params - b.params);
  }

  /** The JSON Schema the document gives for one response, or null when it documents none. */
  function responseSchema(doc, method, path, status) {
    const hit = pathMatchers(doc).find((m) => m.re.test(path) && m.ops[method.toLowerCase()]);
    if (!hit) return { operationId: null, schema: null };
    const op = hit.ops[method.toLowerCase()];
    const res = op.responses?.[String(status)];
    const schema = res?.content?.["application/json"]?.schema ?? null;
    return { operationId: op.operationId, template: hit.template, schema };
  }

  /** Draft 2020-12 → what the sandbox's draft-07 validator reads: refs into one document, no `$schema`. */
  function toDraft7(node) {
    if (Array.isArray(node)) return node.map(toDraft7);
    if (!node || typeof node !== "object") return node;
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "$schema") continue;
      if (k === "prefixItems" && Array.isArray(v)) {
        out.items = v.map(toDraft7);
        continue;
      }
      out[k] = toDraft7(v);
    }
    return out;
  }

  const FORMATS = {
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "date-time": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    date: /^\d{4}-\d{2}-\d{2}$/,
    email: /^[^@\s]+@[^@\s]+$/,
    uri: /^[a-z][a-z0-9+.-]*:/i,
    url: /^[a-z][a-z0-9+.-]*:/i,
  };

  /** Validates `body` against `schema` (a `$ref` into the document's components) with the sandbox's Ajv. */
  function makeValidator(doc, Ajv) {
    const ajv = new Ajv({ allErrors: true, unknownFormats: "ignore", schemaId: "auto", logger: false });
    for (const [name, re] of Object.entries(FORMATS)) ajv.addFormat(name, re);
    ajv.addSchema({ $id: "fs-openapi.json", components: toDraft7(doc.components || {}) });
    const cache = {};
    return function validate(schema, body) {
      const key = JSON.stringify(schema);
      if (!cache[key]) {
        const rooted = JSON.parse(key.replace(/"#\/components\//g, '"fs-openapi.json#/components/'));
        cache[key] = ajv.compile(toDraft7(rooted));
      }
      const ok = cache[key](body);
      return { ok, errors: ok ? [] : (cache[key].errors || []).slice(0, 5) };
    };
  }

  // ------------------------------------------------------------------ the simulated label (I8)

  /** Ids PayPal mints, with the simulator's marker inside PayPal's own format (paypal-sim README). */
  const SIM_ID_RULES = {
    paypalInvoiceId: /^INV2-SIM/,
    invoiceId: /^INV2-SIM/,
    payoutItemId: /^SIM/,
    payoutBatchId: /^SIM/,
    payout_batch_id: /^SIM/,
    payout_item_id: /^SIM/,
    paypalEventId: /^WH-SIM/,
    debug_id: /^sim-[0-9a-f]{12}$/,
  };
  const PAYPAL_PROVENANCE = ["simulated_rail", "replay"];

  /**
   * Every PayPal-derived value in `body` that does not carry the simulated label: a PayPal id without the
   * simulator's marker, a webhook event id that is not `WH-SIM…`, or a PayPal-derived object whose provenance
   * is neither `simulated_rail` nor a labelled `replay`. Returns the offending paths.
   */
  function simLabelIssues(body) {
    const issues = [];
    let seen = 0;
    const walk = (v, path) => {
      if (Array.isArray(v)) {
        v.forEach((x, i) => {
          walk(x, `${path}[${i}]`);
        });
        return;
      }
      if (!v || typeof v !== "object") return;
      const paypalObject = Object.keys(v).some((k) => k in SIM_ID_RULES && v[k] !== null);
      if (paypalObject && "provenance" in v) {
        seen++;
        if (!PAYPAL_PROVENANCE.includes(v.provenance)) issues.push(`${path}.provenance=${v.provenance}`);
      }
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === "string" && SIM_ID_RULES[k]) {
          seen++;
          if (!SIM_ID_RULES[k].test(x)) issues.push(`${path}.${k}=${x}`);
        }
        if (typeof x === "string" && /eventId$/i.test(k) && /^WH-/.test(x)) {
          seen++;
          if (!/^WH-SIM/.test(x)) issues.push(`${path}.${k}=${x}`);
        }
        walk(x, `${path}.${k}`);
      }
    };
    walk(body, "$");
    return { issues, seen };
  }

  // ------------------------------------------------------------------ Proof verify

  const GENESIS = "0".repeat(64);

  function linesRoot(lines) {
    const sorted = lines
      .map((l) => ({ memberNo: l.memberNo, lineSha256: l.lineSha256 }))
      .sort((a, b) => (a.memberNo < b.memberNo ? -1 : a.memberNo > b.memberNo ? 1 : 0));
    return sha256Hex(jcs(sorted));
  }

  function chainOk(ledger) {
    let prev = GENESIS;
    let seq = 1;
    for (const e of ledger) {
      const fact = {
        seq: e.seq,
        kind: e.kind,
        actorKind: e.actorKind,
        actorId: e.actorId,
        impersonatedBy: e.impersonatedBy,
        payload: e.payload,
        at: e.at,
      };
      if (e.seq !== seq || e.prevHash !== prev || sha256Hex(e.prevHash + jcs(fact)) !== e.entryHash) {
        return { ok: false, brokenAtSeq: e.seq };
      }
      prev = e.entryHash;
      seq++;
    }
    return { ok: true, brokenAtSeq: null, head: prev, length: ledger.length };
  }

  /** The checkpoint bytes: JCS{purpose, v, keyId, runId, seq, entryHash, at} (domain `checkpointBytes`). */
  function checkpointJcs(c) {
    return jcs({
      purpose: "fairsplit.ledger.checkpoint",
      v: c.v,
      keyId: c.keyId,
      runId: c.runId,
      seq: c.seq,
      entryHash: c.entryHash,
      at: c.at,
    });
  }

  /**
   * Recomputes what a Proof bundle claims, trusting only `ledgerKeys` (the published keys, by keyId):
   * every line hash, the lines root both approvals signed, both signatures, the batch against the signed
   * payload, money per line, the hash chain and the signed checkpoint over its head.
   */
  function verifyProof(bundle, ledgerKeys) {
    const lines = bundle.lines || [];
    const badLines = lines.filter((l) => sha256Hex(jcs(l.canonical)) !== l.lineSha256).map((l) => l.memberNo);
    const unbalanced = lines
      .filter((l) => l.premiumCents + l.bonusCents - l.deductionsCents + l.creditsCents !== l.netCents)
      .map((l) => l.memberNo);
    const root = linesRoot(lines);
    const approvals = (bundle.approvals || []).map((a) => ({
      role: a.role,
      keyId: a.keyId,
      linesRootMatches: a.payload.linesDigest === root,
      batchMatches: a.payload.batchSha256 === bundle.batch?.batchSha256,
      signatureOk: ed25519.verify(a.publicKeyHex, jcs(a.payload), a.signatureHex),
    }));
    const items = bundle.batch?.items || [];
    const itemsCents = items.reduce((n, i) => n + i.amountCents, 0);
    const paypalNet = lines.filter((l) => l.rail === "PAYPAL").reduce((n, l) => n + l.netCents, 0);
    const signed = bundle.approvals?.[0]?.payload;
    const chain = chainOk(bundle.ledger || []);
    const cp = bundle.checkpoint;
    const ledgerKey = cp ? ledgerKeys[cp.keyId] : undefined;
    const checkpoint = {
      keyPublished: !!ledgerKey,
      headMatches: !!cp && chain.ok && cp.entryHash === chain.head && cp.seq === chain.length,
      signatureOk: !!cp && !!ledgerKey && ed25519.verify(ledgerKey, checkpointJcs(cp), cp.signatureHex),
    };
    return {
      lines: { total: lines.length, badLines, unbalanced },
      linesRoot: root,
      approvals,
      batch: {
        itemCount: items.length,
        itemsCents,
        paypalNetCents: paypalNet,
        signedItemCount: signed?.itemCount ?? null,
        signedTotalCents: signed?.totalCents ?? null,
      },
      chain,
      checkpoint,
    };
  }

  return {
    v: 1,
    hexToBytes,
    bytesToHex,
    utf8,
    ed25519,
    jcs,
    sha256Hex,
    responseSchema,
    makeValidator,
    simLabelIssues,
    linesRoot,
    chainOk,
    verifyProof,
  };
}

if (typeof module === "object" && module && module.exports) module.exports = { createFairSplitLib };
