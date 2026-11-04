// Builds fair-split.postman_collection.json (Postman collection v2.1) from this file: `node postman/build.mjs`.
// `--check` exits 1 when the committed collection differs from what this file builds.
//
// Every script below is a real function (so Biome parses and lints it); `script()` keeps only its body. Scripts run in
// Postman's sandbox, where `pm`, `fair` (the global the collection pre-request defines from lib.cjs) and `fairCache`
// exist. A script that needs arguments gets them as `const ARGS = …;` on its first line.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const COLLECTION_PATH = join(HERE, "fair-split.postman_collection.json");
const LIB_PATH = join(HERE, "lib.cjs");

/** The function's body as script lines, dedented; `args` become `const ARGS = …;`. */
export function script(fn, args) {
  const src = fn.toString();
  const lines = src.slice(src.indexOf("{") + 1, src.lastIndexOf("}")).split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  const body = lines.map((l) => l.slice(indent));
  return args === undefined ? body : [`const ARGS = ${JSON.stringify(args)};`, ...body];
}

// ---------------------------------------------------------------------------------------------- collection scripts

/** Before every request: the helper library as the global `fair`, with CryptoJS for hashing and randomness. */
function collectionPre() {
  if (typeof fair === "undefined" || fair.v !== 1) {
    const C = require("crypto-js");
    const toWords = (bytes) => {
      const words = [];
      for (let i = 0; i < bytes.length; i++) words[i >>> 2] |= bytes[i] << (24 - (i % 4) * 8);
      return C.lib.WordArray.create(words, bytes.length);
    };
    const fromWords = (wa) => {
      const out = new Uint8Array(wa.sigBytes);
      for (let i = 0; i < wa.sigBytes; i++) out[i] = (wa.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 255;
      return out;
    };
    fair = createFairSplitLib({
      sha512: (bytes) => fromWords(C.SHA512(toWords(bytes))),
      sha256Hex: (text) => C.SHA256(C.enc.Utf8.parse(text)).toString(C.enc.Hex),
    });
    fair.seed = () => C.lib.WordArray.random(32).toString(C.enc.Hex);
    fairCache = {};
  }
}

/**
 * After every request: X-FS-Rail on every fs-api answer, the response against the OpenAPI document fs-api serves,
 * the simulated label on every PayPal-derived value, and the simulator's own markers on its answers.
 */
function collectionTest() {
  const url = pm.request.url.toString();
  const base = pm.variables.get("baseUrl");
  const simBase = pm.variables.get("simBaseUrl");
  const path = `/${pm.request.url.path.join("/")}`;
  const method = pm.request.method;
  let json = null;
  try {
    json = pm.response.json();
  } catch {
    json = null;
  }
  if (base && url.startsWith(base)) {
    if (path.startsWith("/v1/") || path.startsWith("/webhooks/")) {
      pm.test("[rail] X-FS-Rail reads simulated", () => {
        pm.expect(pm.response.headers.get("X-FS-Rail")).to.equal("simulated");
      });
    }
    if (!fairCache.doc && pm.collectionVariables.get("openapi")) {
      fairCache.doc = JSON.parse(pm.collectionVariables.get("openapi"));
      fairCache.validate = fair.makeValidator(fairCache.doc, require("ajv"));
    }
    if (fairCache.doc && json !== null) {
      const hit = fair.responseSchema(fairCache.doc, method, path, pm.response.code);
      if (hit.schema) {
        pm.test(`[schema] ${hit.operationId} ${pm.response.code} matches the OpenAPI document`, () => {
          const r = fairCache.validate(hit.schema, json);
          pm.expect(r.errors, JSON.stringify(r.errors)).to.eql([]);
        });
      }
    }
  }
  if (simBase && url.startsWith(simBase)) {
    pm.test("[label] the simulator marks its answer (x-fairsplit-simulated)", () => {
      pm.expect(pm.response.headers.get("x-fairsplit-simulated")).to.equal("true");
    });
  }
  // the OpenAPI document is schemas, not data: its examples are not PayPal values
  if (json !== null && path !== "/v1/openapi.json") {
    const scan = fair.simLabelIssues(json);
    if (scan.seen > 0) {
      pm.test(`[label] ${scan.seen} PayPal-derived value(s) carry the simulated label`, () => {
        pm.expect(scan.issues).to.eql([]);
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------- shared scripts

/** Polls the run until ARGS.states holds (or ARGS.ms pass), then asserts; re-runs itself every 500 ms. */
function waitRunTest() {
  const view = pm.response.code === 200 ? pm.response.json() : null;
  const state = view?.run?.state;
  const done =
    !!view &&
    ((ARGS.states.includes(state) && (!ARGS.holdsClear || view.holds.open === 0)) ||
      (ARGS.stopAt || []).includes(state));
  const key = `poll:${pm.info.requestName}`;
  if (!pm.collectionVariables.get(key)) pm.collectionVariables.set(key, String(Date.now() + ARGS.ms));
  if (!done && Date.now() < Number(pm.collectionVariables.get(key))) {
    pm.execution.setNextRequest(pm.info.requestName);
    setTimeout(() => {}, 500);
  } else {
    pm.collectionVariables.unset(key);
    pm.test(`run reaches ${ARGS.states.join(" or ")} within ${ARGS.ms / 1000} s (at ${state})`, () => {
      pm.expect(ARGS.states).to.include(state);
    });
    if (view) {
      pm.collectionVariables.set("runState", state);
      pm.test("the run and its invoice are PayPal-derived and labelled simulated", () => {
        pm.expect(view.rail).to.equal("simulated");
        pm.expect(view.run.provenance).to.equal(pm.collectionVariables.get("paypalProvenance"));
        if (view.invoice)
          pm.expect(view.invoice.provenance).to.equal(pm.collectionVariables.get("paypalProvenance"));
      });
      if (ARGS.lines) {
        pm.test(`lines by state: ${JSON.stringify(ARGS.lines)}`, () => {
          pm.expect(view.lines).to.eql(ARGS.lines);
        });
      }
      if (ARGS.holds) {
        pm.test(`holds: ${JSON.stringify(ARGS.holds)}`, () => {
          pm.expect(view.holds).to.include(ARGS.holds);
        });
      }
      if (ARGS.mark) pm.collectionVariables.set(ARGS.mark, String(Date.now()));
      if (ARGS.within) {
        const ms = Date.now() - Number(pm.collectionVariables.get("pressedAt"));
        console.log(`${ARGS.withinLabel}: ${ms} ms after the first press`);
        pm.test(`${ARGS.withinLabel} within ${ARGS.within / 1000} s of the first press (${ms} ms)`, () => {
          pm.expect(ms).to.be.at.most(ARGS.within);
        });
      }
      if (ARGS.invoiced) {
        pm.test(
          "the invoice is the simulator's (INV2-SIM…), its pay page the simulator's labelled page",
          () => {
            pm.expect(view.invoice.paypalInvoiceId).to.match(/^INV2-SIM/);
            pm.expect(
              view.invoice.payerViewUrl.startsWith(`${pm.variables.get("baseUrl")}/paypal-sim/`),
            ).to.equal(true);
            pm.expect(view.invoice.amountCents).to.be.above(0);
          },
        );
        pm.collectionVariables.set("invoiceId", view.invoice.paypalInvoiceId);
      }
    }
  }
}

function sessionPressPre() {
  // A first press carries no judge cookie: forget any this jar kept from an earlier run (Postman app).
  pm.cookies.jar().clear(pm.variables.get("baseUrl"), () => {});
  pm.collectionVariables.set("pressedAt", String(Date.now()));
}

function sessionPressTest() {
  pm.test("201 Created: a judge session, a workspace and its run", () => {
    pm.response.to.have.status(201);
  });
  const s = pm.response.json();
  const cookie = /fs_js=([^;]+)/.exec(pm.response.headers.get("Set-Cookie") || "");
  pm.test("the judge cookie fs_js is HttpOnly and SameSite", () => {
    pm.expect(cookie, "Set-Cookie fs_js").to.not.equal(null);
    pm.expect(pm.response.headers.get("Set-Cookie"))
      .to.match(/HttpOnly/i)
      .and.match(/SameSite=Lax/i);
  });
  if (ARGS.again) {
    pm.test("the same judge session gets a fresh workspace and run", () => {
      pm.expect(s.sessionId).to.equal(pm.collectionVariables.get("sessionId"));
      pm.expect(s.workspaceId).to.not.equal(pm.collectionVariables.get("workspaceId"));
      pm.expect(s.runSlug).to.not.equal(pm.collectionVariables.get("runSlug"));
    });
  }
  pm.collectionVariables.set("sessionId", s.sessionId);
  pm.collectionVariables.set("workspaceId", s.workspaceId);
  pm.collectionVariables.set("runSlug", s.runSlug);
  pm.collectionVariables.set("seasonCode", s.runSlug.replace(/-r[0-9]+$/, ""));
  pm.collectionVariables.set("consoleToken", s.consoleToken);
  if (cookie) pm.collectionVariables.set("judgeCookie", cookie[1]);
  // tokens never go to the console: the cookie and console token stay in collection variables
  pm.cookies.jar().clear(pm.variables.get("baseUrl"), () => {});
}

function sessionViewTest() {
  pm.response.to.have.status(200);
  const s = pm.response.json();
  pm.test("the rail is the simulated PayPal sandbox, labelled", () => {
    pm.expect(s.rail.rail).to.equal("simulated");
    pm.expect(s.rail.label).to.equal(pm.collectionVariables.get("simulatedLabel"));
    pm.expect(["live", "replay"]).to.include(s.rail.mode);
  });
  pm.test("no tamper is armed", () => {
    pm.expect(s.tamper.changePayoutArmed).to.equal(false);
  });
  // live: PayPal's (simulated) answers are fresh, `simulated_rail`; over quota a run replays, labelled `replay`
  pm.collectionVariables.set("railMode", s.rail.mode);
  pm.collectionVariables.set("paypalProvenance", s.rail.mode === "live" ? "simulated_rail" : "replay");
  console.log(`rail: ${s.rail.mode} (${s.rail.reason ?? "within quota"})`);
}

function markPaidPre() {
  if (!pm.collectionVariables.get("idem.markPaid")) {
    pm.collectionVariables.set("idem.markPaid", pm.variables.replaceIn("{{$guid}}"));
  }
}

function markPaidTest() {
  const b = pm.response.json();
  const queued = pm.response.code === 429 && b.code === "QUEUED";
  const tries = Number(pm.collectionVariables.get("markPaidTries") || "0") + 1;
  pm.collectionVariables.set("markPaidTries", String(tries));
  if (queued && tries < 10) {
    // PayPal's window is full (fs-api's limiter): the step waits its turn. Honour the wait it names, then ask
    // again with a new key (the stored 429 would replay to the same key).
    console.log(`Mark paid QUEUED, waiting ${b.retryAfterMs} ms as asked`);
    pm.test("QUEUED names its wait (retryAfterMs and Retry-After)", () => {
      pm.expect(b.retryAfterMs).to.be.above(0);
      pm.expect(pm.response.headers.get("Retry-After")).to.be.a("string");
    });
    pm.collectionVariables.set("markPaidQueued", "1");
    pm.collectionVariables.unset("idem.markPaid");
    pm.execution.setNextRequest(pm.info.requestName);
    setTimeout(() => {}, b.retryAfterMs + 200);
  } else if (pm.response.code === 409 && pm.collectionVariables.get("markPaidQueued")) {
    pm.test("409 after QUEUED: the queued step already ran on its own", () => {
      pm.expect(b.code).to.be.a("string");
    });
  } else {
    pm.test("200: the invoice is marked paid on the simulated rail", () => {
      pm.response.to.have.status(200);
      pm.expect(b.invoiceStatus).to.equal("MARKED_AS_PAID");
      pm.expect(b.invoiceId).to.equal(pm.collectionVariables.get("invoiceId"));
      pm.expect(b.provenance).to.equal(pm.collectionVariables.get("paypalProvenance"));
    });
    pm.collectionVariables.set("markPaidBody", JSON.stringify(b));
  }
}

function markPaidReplayPre() {
  if (pm.collectionVariables.get("markPaidQueued") || !pm.collectionVariables.get("markPaidBody")) {
    console.log("skipped: Mark paid was paced (QUEUED), so there is no stored 200 to replay");
    pm.execution.skipRequest();
  }
}

function markPaidReplayTest() {
  pm.test("same Idempotency-Key and body: the stored answer replays, PayPal is not called twice", () => {
    pm.response.to.have.status(200);
    pm.expect(pm.response.headers.get("Idempotent-Replayed")).to.equal("true");
    pm.expect(pm.response.json()).to.eql(JSON.parse(pm.collectionVariables.get("markPaidBody")));
  });
}

function slipTest() {
  pm.response.to.have.status(200);
  const fields = pm.response.json().slips.flatMap((s) => s.fields);
  const gross = fields.find((f) => f.field === "gross_kg");
  pm.test(
    "slip 0462 has a smudged gross_kg field, read by the seed's labelled stand-in (no live Claude read)",
    () => {
      pm.expect(gross, "gross_kg").to.be.an("object");
      pm.expect(gross.provenance).to.equal("seeded");
      pm.expect(gross.readA.legibility).to.equal("SMUDGED");
      pm.expect(gross.finalValue).to.equal(null);
    },
  );
  pm.collectionVariables.set("fieldId", gross.id);
}

function enterPre() {
  pm.collectionVariables.set("idem.enter", pm.variables.replaceIn("{{$guid}}"));
}

function enterTest() {
  pm.test("200: the person's value is final, decided by a person", () => {
    pm.response.to.have.status(200);
    pm.expect(pm.response.json().field).to.include({
      field: "gross_kg",
      finalValue: ARGS.value,
      decidedBy: "person",
    });
  });
  pm.collectionVariables.set("enterBody", pm.response.text());
}

function enterReplayTest() {
  pm.test("same Idempotency-Key, same body: the stored answer replays (Idempotent-Replayed: true)", () => {
    pm.response.to.have.status(200);
    pm.expect(pm.response.headers.get("Idempotent-Replayed")).to.equal("true");
    pm.expect(pm.response.json()).to.eql(JSON.parse(pm.collectionVariables.get("enterBody")));
  });
}

function enterMismatchTest() {
  pm.test("same Idempotency-Key, different body: 422 IDEMPOTENCY_KEY_REUSED, nothing changes", () => {
    pm.response.to.have.status(422);
    pm.expect(pm.response.json().code).to.equal("IDEMPOTENCY_KEY_REUSED");
  });
}

function holdsTest() {
  pm.response.to.have.status(200);
  const holds = pm.response.json().holds;
  pm.test("the reading raised H1 and H2, which block approval, and H3, which reserves its line", () => {
    const gate = (label) => holds.find((x) => x.label === label && x.state === "OPEN")?.gate;
    pm.expect(gate("H1")).to.equal("BLOCKS_APPROVAL");
    pm.expect(gate("H2")).to.equal("BLOCKS_APPROVAL");
    pm.expect(gate("H3")).to.equal("RESERVES_LINE");
  });
  for (const h of holds) pm.collectionVariables.set(`hold.${h.label}`, h.id);
}

function resolveTest() {
  pm.test(`200: ${ARGS.label} resolved`, () => {
    pm.response.to.have.status(200);
    pm.expect(pm.response.json().hold).to.include({ label: ARGS.label, state: "RESOLVED" });
  });
}

function frameTest() {
  pm.test("201: the Chair's frame token (board:ernesto)", () => {
    pm.response.to.have.status(201);
    pm.expect(pm.response.json()).to.include({ role: "board", persona: "ernesto" });
  });
  pm.collectionVariables.set("chairToken", pm.response.json().token);
}

/** A throwaway demo key made in this run; the server checks proof of possession over the statement. */
function registerKeyPre() {
  const seed = fair.seed();
  const publicKeyHex = fair.ed25519.publicKeyHex(seed);
  const statement = fair.jcs({
    v: 1,
    purpose: "fs.register-demo-key",
    ws: pm.collectionVariables.get("workspaceId"),
    approverId: ARGS.approverId,
    publicKeyHex,
  });
  pm.collectionVariables.set(`seed.${ARGS.role}`, seed);
  pm.collectionVariables.set(
    "keyBody",
    JSON.stringify({ publicKeyHex, signatureHex: fair.ed25519.sign(seed, statement) }),
  );
}

function registerKeyTest() {
  const b = pm.response.json();
  pm.test(`201: ${ARGS.approverId}'s browser demo key is registered, labelled a demo key`, () => {
    pm.response.to.have.status(201);
    pm.expect(b.approverId).to.equal(ARGS.approverId);
    pm.expect(b.kind).to.equal("web_demo");
    pm.expect(b.label).to.match(/demo key/i);
  });
  pm.collectionVariables.set(`keyId.${ARGS.role}`, b.keyId);
}

function payloadTest() {
  pm.response.to.have.status(200);
  const b = pm.response.json();
  pm.test(
    `the ${ARGS.role}'s payload: our JCS of it equals fs-api's, and it names the batch and lines root`,
    () => {
      pm.expect(fair.jcs(b.payload)).to.equal(b.jcs);
      pm.expect(b.payload.role).to.equal(ARGS.role);
      pm.expect(b.payload.batchSha256).to.match(/^[0-9a-f]{64}$/);
      pm.expect(b.payload.linesDigest).to.match(/^[0-9a-f]{64}$/);
      pm.expect(b.payload.currency).to.equal("USD");
    },
  );
  pm.collectionVariables.set(`payload.${ARGS.role}`, JSON.stringify(b.payload));
}

function approvePre() {
  const payload = JSON.parse(pm.collectionVariables.get(`payload.${ARGS.role}`));
  pm.collectionVariables.set(
    "approvalBody",
    JSON.stringify({
      role: ARGS.role,
      keyId: pm.collectionVariables.get(`keyId.${ARGS.role}`),
      signature: fair.ed25519.sign(pm.collectionVariables.get(`seed.${ARGS.role}`), fair.jcs(payload)),
      payload,
    }),
  );
}

function approveTest() {
  const b = pm.response.json();
  pm.test(`201: key ${ARGS.role === "treasurer" ? 1 : 2} signed, run ${ARGS.runState}`, () => {
    pm.response.to.have.status(201);
    pm.expect(b.runState).to.equal(ARGS.runState);
  });
  if (ARGS.role === "treasurer")
    pm.collectionVariables.set(
      "approvedBatch",
      JSON.parse(pm.collectionVariables.get("payload.treasurer")).batchSha256,
    );
}

function linesTest() {
  pm.response.to.have.status(200);
  const lines = pm.response.json().lines;
  const paid = lines.filter((l) => l.state === "PAID");
  const parked = lines.filter((l) => l.state === "UNCLAIMED");
  pm.test("every PAID line went on the PayPal rail; one line is parked UNCLAIMED (Rhea, M-031)", () => {
    pm.expect(paid.length).to.be.above(0);
    pm.expect(paid.every((l) => l.rail === "PAYPAL")).to.equal(true);
    pm.expect(parked.map((l) => l.memberNo)).to.eql(["M-031"]);
  });
  pm.test("money is conserved per line: premium + bonus − deductions + credits = net", () => {
    for (const l of lines) {
      const d = l.deductions.reduce((n, x) => n + x.amountCents, 0);
      pm.expect(l.premiumCents + l.bonusCents - d + l.creditsCents, l.memberNo).to.equal(l.netCents);
    }
  });
  pm.collectionVariables.set("parkedLineId", parked[0]?.id ?? "");
  pm.collectionVariables.set("paidCount", String(paid.length));
  pm.collectionVariables.set("lineCount", String(lines.length));
}

function payCashTest() {
  pm.test("200: the parked item is cancelled and the line moves to cash", () => {
    pm.response.to.have.status(200);
    pm.expect(pm.response.json().cancelled).to.equal(true);
    pm.expect(pm.response.json().line).to.include({ memberNo: "M-031", state: "OFF_RAIL_DUE" });
  });
}

function settledRunTest() {
  const view = pm.response.json();
  pm.test("the batch that posted is the batch both officers signed (I4)", () => {
    pm.expect(view.run.batchSha256).to.equal(pm.collectionVariables.get("approvedBatch"));
    pm.expect(view.run.senderBatchId).to.be.a("string");
  });
  pm.collectionVariables.set("senderBatchId", view.run.senderBatchId);
}

/** Proof metrics: polls until every PAID member is PayPal-verified (its simulator-signed webhook stored). */
function metricsTest() {
  const m = pm.response.code === 200 ? pm.response.json() : null;
  const want = Number(pm.collectionVariables.get("paidCount"));
  const replay = pm.collectionVariables.get("railMode") !== "live";
  const done = !!m && (replay || m.paid.paypalVerified.members === want);
  const key = "poll:metrics";
  if (!pm.collectionVariables.get(key)) pm.collectionVariables.set(key, String(Date.now() + 60000));
  if (!done && Date.now() < Number(pm.collectionVariables.get(key))) {
    pm.execution.setNextRequest(pm.info.requestName);
    setTimeout(() => {}, 1000);
  } else {
    pm.collectionVariables.unset(key);
    const total = Number(pm.collectionVariables.get("lineCount"));
    pm.test("Proof explains every line, and the rails add up to the members", () => {
      pm.expect(m.lines).to.include({ total, explained: total, display: `${total} of ${total}` });
      pm.expect(m.rails.paypalMembers + m.rails.cashMembers).to.equal(total);
      pm.expect(m.runState).to.equal("SETTLED");
    });
    pm.test("holds caught and the money kept for members are shown as computed (display = cents)", () => {
      pm.expect(m.holds.caught).to.be.above(0);
      const c = m.holds.keptForMembers.cents;
      const usd = `US$${Math.floor(c / 100).toLocaleString("en-US")}.${String(c % 100).padStart(2, "0")}`;
      pm.expect(m.holds.keptForMembers.display).to.equal(usd);
    });
    pm.test(
      replay
        ? "replayed payout: no member reads PayPal-verified (a replay never reads as paid by PayPal)"
        : "every PAID member is PayPal-verified by a simulator-signed webhook",
      () => {
        pm.expect(m.paid.paypalVerified.members).to.equal(replay ? 0 : want);
        pm.expect(m.provenance).to.equal(pm.collectionVariables.get("paypalProvenance"));
      },
    );
  }
}

function verificationTest() {
  const r = pm.response.code === 200 ? pm.response.json() : null;
  const replay = pm.collectionVariables.get("railMode") !== "live";
  const want = replay ? "replay" : "sample";
  const done = !!r && r.verification.status === want && r.verification.checkpoint.ok;
  const key = "poll:verification";
  if (!pm.collectionVariables.get(key)) pm.collectionVariables.set(key, String(Date.now() + 30000));
  if (!done && Date.now() < Number(pm.collectionVariables.get(key))) {
    pm.execution.setNextRequest(pm.info.requestName);
    setTimeout(() => {}, 1000);
  } else {
    pm.collectionVariables.unset(key);
    const v = r.verification;
    pm.test(`fs-api's own verification reads "${want}" (demo keys are samples, never "verified")`, () => {
      pm.expect(v.status).to.equal(want);
      pm.expect(r.demoMode).to.equal(true);
      pm.expect(v.ok).to.equal(false);
    });
    pm.test("the chain, the checkpoint and all six plates hold", () => {
      pm.expect(v.chain.ok).to.equal(true);
      pm.expect(v.checkpoint.ok).to.equal(true);
      pm.expect(Object.keys(v.plates).sort()).to.eql(
        ["computed", "paid", "payoutItems", "ratified", "read", "twoKeys"].sort(),
      );
      pm.expect(Object.entries(v.plates).filter(([, p]) => !p.ok)).to.eql([]);
    });
    pm.test("the sample keys are exactly the two demo keys this run registered", () => {
      pm.expect(v.sampleKeys.slice().sort()).to.eql(
        [pm.collectionVariables.get("keyId.treasurer"), pm.collectionVariables.get("keyId.chair")].sort(),
      );
    });
    pm.test("PayPal's anchors name this run's batch", () => {
      pm.expect(v.anchors.senderBatchId).to.equal(pm.collectionVariables.get("senderBatchId"));
      pm.expect(r.provenance).to.equal(pm.collectionVariables.get("paypalProvenance"));
    });
    pm.collectionVariables.set("proofSlug", pm.collectionVariables.get("runSlug"));
  }
}

function resetPre() {
  pm.collectionVariables.set("resetAt", String(Date.now()));
}

function resetTest() {
  const ms = Date.now() - Number(pm.collectionVariables.get("resetAt"));
  pm.test(`Reset answers 200 within 10 s (${ms} ms)`, () => {
    pm.response.to.have.status(200);
    pm.expect(pm.response.json()).to.include({
      reset: true,
      sessionId: pm.collectionVariables.get("sessionId"),
    });
    pm.expect(ms).to.be.at.most(10000);
  });
}

function staleTokenTest() {
  pm.test("the ended workspace's console token is refused", () => {
    pm.expect([401, 403, 404, 410]).to.include(pm.response.code);
  });
}

// ---------------------------------------------------------------------------------------------- Proof verify

function keysTest() {
  pm.response.to.have.status(200);
  const k = pm.response.json();
  pm.test("the published keys name the ledger key and both officers", () => {
    pm.expect(k.ledger.length).to.be.above(0);
    pm.expect(k.officers.map((o) => o.role).sort()).to.include.members(["chair", "treasurer"]);
  });
  pm.collectionVariables.set(
    "ledgerKeys",
    JSON.stringify(
      Object.fromEntries(k.ledger.filter((x) => !x.revokedAt).map((x) => [x.keyId, x.publicKeyHex])),
    ),
  );
}

function proofDownloadTest() {
  pm.test("200: the public Proof bundle downloads as a file, public tier", () => {
    pm.response.to.have.status(200);
    pm.expect(pm.response.headers.get("Content-Disposition")).to.match(
      /attachment; filename="FS-.+\.proof\.json"/,
    );
    pm.expect(pm.response.headers.get("X-FS-Proof-Tier")).to.equal("public");
  });
  const body = pm.response.json();
  const b = body.bundle;
  const keys = JSON.parse(pm.collectionVariables.get("ledgerKeys"));
  const r = fair.verifyProof(b, keys);
  console.log(`Proof verify: ${JSON.stringify(r)}`);
  pm.test(`every line re-hashes to its lineSha256 (${r.lines.total} lines) and balances`, () => {
    pm.expect(r.lines.total).to.equal(Number(pm.collectionVariables.get("lineCount")));
    pm.expect(r.lines.badLines).to.eql([]);
    pm.expect(r.lines.unbalanced).to.eql([]);
  });
  pm.test("both approvals sign the recomputed lines root and the batch, and both signatures verify", () => {
    pm.expect(r.approvals.map((a) => a.role).sort()).to.eql(["chair", "treasurer"]);
    for (const a of r.approvals)
      pm.expect(a, a.role).to.include({ linesRootMatches: true, batchMatches: true, signatureOk: true });
    pm.expect(r.approvals.map((a) => a.keyId).sort()).to.eql(
      [pm.collectionVariables.get("keyId.treasurer"), pm.collectionVariables.get("keyId.chair")].sort(),
    );
  });
  pm.test(
    "the batch is what was signed: its items add up to the signed total and to the PayPal lines (I3)",
    () => {
      pm.expect(r.batch.itemCount).to.equal(r.batch.signedItemCount);
      pm.expect(r.batch.itemsCents).to.equal(r.batch.signedTotalCents);
      pm.expect(r.batch.paypalNetCents).to.equal(r.batch.signedTotalCents);
    },
  );
  pm.test(
    "the ledger's hash chain recomputes from genesis, and the checkpoint over its head verifies",
    () => {
      pm.expect(r.chain.ok, `broken at ${r.chain.brokenAtSeq}`).to.equal(true);
      pm.expect(r.checkpoint).to.eql({ keyPublished: true, headMatches: true, signatureOk: true });
    },
  );
  pm.test("PayPal's ids in the bundle are the simulator's; receivers are withheld in the public tier", () => {
    for (const i of b.batch.items) {
      pm.expect(i.payoutItemId).to.match(/^SIM/);
      pm.expect(i.receiver).to.equal("withheld");
    }
    pm.expect(body.provenance).to.equal(pm.collectionVariables.get("paypalProvenance"));
  });
  // A copy with one cent moved: its line hash, and so the signed lines root, no longer match.
  const altered = JSON.parse(JSON.stringify(b));
  altered.lines[0].canonical.netCents += 1;
  altered.lines[0].netCents += 1;
  const ra = fair.verifyProof(altered, keys);
  pm.test("an altered copy (one cent on one line) fails: its line hash and both signed roots break", () => {
    pm.expect(ra.lines.badLines).to.eql([b.lines[0].memberNo]);
  });
  // The same copy with that line re-hashed: the line passes, but the lines root both officers signed breaks.
  altered.lines[0].lineSha256 = fair.sha256Hex(fair.jcs(altered.lines[0].canonical));
  const rr = fair.verifyProof(altered, keys);
  pm.test("re-hashing the altered line does not help: neither signed lines root matches any more", () => {
    pm.expect(rr.lines.badLines).to.eql([]);
    pm.expect(rr.approvals.map((a) => a.linesRootMatches)).to.eql([false, false]);
  });
  const { checkpoint: _cp, ...rest } = b;
  pm.collectionVariables.set("bundleJcs", fair.jcs(rest));
}

function proofPageTest() {
  pm.response.to.have.status(200);
  const b = pm.response.json().bundle;
  const { checkpoint, ...rest } = b;
  pm.test(
    "the Proof page serves the same bundle as the download (the checkpoint is signed afresh per read)",
    () => {
      pm.expect(fair.jcs(rest)).to.equal(pm.collectionVariables.get("bundleJcs"));
    },
  );
  pm.test(
    "this read's own checkpoint covers the same head and verifies under the published ledger key",
    () => {
      const r = fair.verifyProof(b, JSON.parse(pm.collectionVariables.get("ledgerKeys")));
      pm.expect(r.checkpoint).to.eql({ keyPublished: true, headMatches: true, signatureOk: true });
      pm.expect(checkpoint.entryHash).to.equal(r.chain.head);
    },
  );
  pm.collectionVariables.unset("bundleJcs");
}

// ---------------------------------------------------------------------------------------------- failure paths

function simPre() {
  if (!pm.variables.get("simBaseUrl")) {
    console.log("skipped: no simBaseUrl (run.mjs starts the standalone simulator for this path)");
    pm.execution.skipRequest();
  }
}

function simTokenTest() {
  pm.test("200: the simulator's OAuth token (fictional fs-judge app, simulator only)", () => {
    pm.response.to.have.status(200);
    pm.expect(pm.response.json().access_token).to.be.a("string");
  });
  pm.collectionVariables.set("simToken", pm.response.json().access_token);
}

function simBalanceTest() {
  pm.response.to.have.status(200);
  const usd = pm.response.json().balances.find((b) => b.currency === "USD");
  pm.test("the simulated business account has a USD balance", () => {
    pm.expect(usd, "USD").to.be.an("object");
  });
  if (ARGS.compare) {
    pm.test("nothing was held: the available balance is unchanged after the refused POST", () => {
      pm.expect(usd.available_balance.value).to.equal(pm.collectionVariables.get("simAvailable"));
    });
  } else {
    pm.collectionVariables.set("simAvailable", usd.available_balance.value);
  }
}

function errpyo005Pre() {
  if (!pm.variables.get("simBaseUrl")) {
    console.log("skipped: no simBaseUrl (run.mjs starts the standalone simulator for this path)");
    pm.execution.skipRequest();
  } else {
    pm.collectionVariables.set("simBatchId", `pm-errpyo005-${Date.now()}`);
  }
}

function errpyo005Test() {
  const b = pm.response.json();
  pm.test("422 INSUFFICIENT_FUNDS: PayPal's ERRPYO005 test value is refused synchronously", () => {
    pm.response.to.have.status(422);
    pm.expect(b.name).to.equal("INSUFFICIENT_FUNDS");
  });
  pm.test("the debug id is the simulator's (sim-…), in the body and the paypal-debug-id header", () => {
    pm.expect(b.debug_id).to.match(/^sim-[0-9a-f]{12}$/);
    pm.expect(pm.response.headers.get("paypal-debug-id")).to.equal(b.debug_id);
  });
}

function tamperTest() {
  pm.test("200: change_payout armed before key 2, labelled simulated, no PayPal or model call", () => {
    pm.response.to.have.status(200);
    pm.expect(pm.response.json()).to.include({
      kind: "change_payout",
      armed: true,
      simulated: true,
      paypalCalls: 0,
      modelCalls: 0,
    });
    pm.expect(pm.response.json().label).to.match(/^Simulated tamper:/);
  });
}

function sentBackTest() {
  const view = pm.response.code === 200 ? pm.response.json() : null;
  const voided = !!view && view.approvals.length >= 2 && view.approvals.every((a) => a.voidedAt !== null);
  const done = !!view && view.run.state === "IN_REVIEW" && voided;
  const key = "poll:sentBack";
  if (!pm.collectionVariables.get(key)) pm.collectionVariables.set(key, String(Date.now() + 60000));
  if (!done && Date.now() < Number(pm.collectionVariables.get(key))) {
    pm.execution.setNextRequest(pm.info.requestName);
    setTimeout(() => {}, 500);
  } else {
    pm.collectionVariables.unset(key);
    pm.test(
      "I4: after both keys the POST re-hashed the batch, refused, and sent the run back to review",
      () => {
        pm.expect(view.run.state).to.equal("IN_REVIEW");
      },
    );
    pm.test("both approvals are void", () => {
      pm.expect(view.approvals.map((a) => [a.role, a.voidedAt !== null]).sort()).to.eql([
        ["chair", true],
        ["treasurer", true],
      ]);
    });
    pm.test("nothing was paid or sent, and no line was left changed: every line is READY again", () => {
      pm.expect(view.lines).to.eql({ READY: Number(pm.collectionVariables.get("lineCount")) });
    });
  }
}

function disarmedTest() {
  pm.test("the tamper is spent: nothing is armed any more", () => {
    pm.response.to.have.status(200);
    pm.expect(pm.response.json().tamper.changePayoutArmed).to.equal(false);
  });
}

function overviewTest() {
  pm.response.to.have.status(200);
  const w = pm.response.json().webhooks;
  const ids = w.recent.map((e) => e.paypalEventId);
  pm.test("the simulator's signed deliveries are stored once per event id, verified, labelled", () => {
    pm.expect(ids.length).to.be.above(0);
    pm.expect(new Set(ids).size).to.equal(ids.length);
    for (const e of w.recent) {
      pm.expect(e.verified).to.equal("self");
      pm.expect(e.provenance).to.equal("simulated_rail");
    }
    pm.expect(w.duplicates).to.be.a("number");
  });
  if (ARGS.after) {
    const stored = w.recent.find((e) => e.paypalEventId === pm.collectionVariables.get("whEventId"));
    pm.test("the re-posted copies changed nothing: the stored event is still there once, same status", () => {
      pm.expect(stored, "stored event").to.be.an("object");
      pm.expect(stored.status).to.equal(pm.collectionVariables.get("whStatus"));
      pm.expect(ids.filter((x) => x === stored.paypalEventId)).to.have.length(1);
    });
  } else {
    pm.collectionVariables.set("whEventId", w.recent[0].paypalEventId);
    pm.collectionVariables.set("whEventType", w.recent[0].eventType);
    pm.collectionVariables.set("whStatus", w.recent[0].status);
  }
}

function webhookCopyPre() {
  if (!pm.collectionVariables.get("whTransmission")) {
    pm.collectionVariables.set("whTransmission", pm.variables.replaceIn("{{$guid}}"));
    pm.collectionVariables.set("whTime", new Date().toISOString().replace(/\.\d+Z$/, "Z"));
  }
  pm.collectionVariables.set(
    "whBody",
    JSON.stringify({
      id: pm.collectionVariables.get("whEventId"),
      event_version: "1.0",
      create_time: pm.collectionVariables.get("whTime"),
      resource_type: "invoices",
      event_type: pm.collectionVariables.get("whEventType"),
      summary: "A copy of a stored delivery, re-posted by the Postman collection without PayPal's signature",
      resource: {},
    }),
  );
}

function webhookCopyTest() {
  pm.test(`400: ${ARGS.what} is refused before anything is stored or applied`, () => {
    pm.response.to.have.status(400);
  });
}

function pairingTest() {
  const b = pm.response.json();
  pm.test("201: a single-use pairing, 10 minutes, its token only in the URL fragment", () => {
    pm.response.to.have.status(201);
    pm.expect(b.url).to.match(/\/app\/pair#t=fsp_[A-Za-z0-9_-]{43}$/);
    pm.expect(b.code6).to.match(/^\d{6}$/);
    const ttl = Date.parse(b.expiresAt) - Date.now();
    pm.expect(ttl).to.be.within(0, 10 * 60 * 1000 + 5000);
  });
  pm.collectionVariables.set("pairToken", b.url.split("#t=")[1]);
  pm.collectionVariables.set("pairCode", b.code6);
}

function claimTest() {
  pm.test("200: the first claim gets a phone credential for the persona", () => {
    pm.response.to.have.status(200);
    pm.expect(pm.response.json()).to.include({ role: "board", persona: "ernesto" });
    pm.expect(pm.response.json().workspaceId).to.equal(pm.collectionVariables.get("workspaceId"));
  });
}

function claimRefusedTest() {
  pm.test(`410 PAIRING_TOKEN_INVALID: ${ARGS.what}`, () => {
    pm.response.to.have.status(410);
    pm.expect(pm.response.json().code).to.equal("PAIRING_TOKEN_INVALID");
  });
}

function neverIssuedPre() {
  const C = require("crypto-js");
  const token = `fsp_${C.lib.WordArray.random(32).toString(C.enc.Base64url).replace(/=+$/, "")}`;
  pm.collectionVariables.set("strayToken", token);
}

// ---------------------------------------------------------------------------------------------- items

const json = { key: "Content-Type", value: "application/json" };
const AUTH = {
  console: { key: "Authorization", value: "Bearer {{consoleToken}}" },
  chair: { key: "Authorization", value: "Bearer {{chairToken}}" },
  cookie: { key: "Cookie", value: "fs_js={{judgeCookie}}" },
};

function event(listen, lines) {
  return { listen, script: { type: "text/javascript", exec: lines } };
}

/** One request. `pre`/`test`: [fn, args?]. */
function req(name, o) {
  const headers = [
    ...(o.auth ? [AUTH[o.auth]] : []),
    ...(o.body !== undefined ? [json] : []),
    ...(o.headers ?? []),
  ];
  const request = {
    method: o.method ?? "GET",
    header: headers,
    url: `{{${o.base ?? "baseUrl"}}}${o.path}`,
    ...(o.description ? { description: o.description } : {}),
  };
  if (o.body !== undefined) {
    request.body = { mode: "raw", raw: typeof o.body === "string" ? o.body : JSON.stringify(o.body) };
  }
  if (o.form) {
    request.body = {
      mode: "urlencoded",
      urlencoded: Object.entries(o.form).map(([key, value]) => ({ key, value })),
    };
  }
  if (o.basicAuth) {
    request.auth = {
      type: "basic",
      basic: [
        { key: "username", value: o.basicAuth[0], type: "string" },
        { key: "password", value: o.basicAuth[1], type: "string" },
      ],
    };
  }
  const events = [];
  if (o.pre) events.push(event("prerequest", script(...o.pre)));
  if (o.test) events.push(event("test", script(...o.test)));
  return { name, ...(events.length ? { event: events } : {}), request };
}

const folder = (name, description, item) => ({ name, description, item });
const run = "/v1/runs/{{runSlug}}";
const waitRun = (name, args) => req(name, { path: run, auth: "console", test: [waitRunTest, args] });
/** States the reading can end in instead of review: stop polling there (the assertion then fails). */
const STOP_READING = ["NEEDS_ACTION", "DENIED"];

/** Read, holds and the hand-entered field: the treasurer's review, to a run with nothing blocking. */
function review(n) {
  return [
    waitRun(`${n}.06 Read: wait for IN_REVIEW (the seed's labelled stand-in reading)`, {
      states: ["IN_REVIEW"],
      stopAt: STOP_READING,
      ms: 120000,
      holds: { open: 4, blocking: 3 },
      lines: { HELD: 4, READY: 60 },
    }),
    req(`${n}.07 Read: slip 0462`, {
      path: "/v1/seasons/{{seasonCode}}/slips/0462",
      auth: "console",
      test: [slipTest],
    }),
    req(`${n}.08 Read: enter 0462's smudged gross by hand`, {
      method: "POST",
      path: "/v1/fields/{{fieldId}}/enter",
      auth: "console",
      headers: [{ key: "Idempotency-Key", value: "{{idem.enter}}" }],
      body: { value: "64.80" },
      pre: [enterPre],
      test: [enterTest, { value: "64.80" }],
    }),
    ...(n === "1"
      ? [
          req(`${n}.09 Idempotency: same key, same body replays`, {
            method: "POST",
            path: "/v1/fields/{{fieldId}}/enter",
            auth: "console",
            headers: [{ key: "Idempotency-Key", value: "{{idem.enter}}" }],
            body: { value: "64.80" },
            test: [enterReplayTest],
          }),
          req(`${n}.10 Idempotency: same key, different body is refused`, {
            method: "POST",
            path: "/v1/fields/{{fieldId}}/enter",
            auth: "console",
            headers: [{ key: "Idempotency-Key", value: "{{idem.enter}}" }],
            body: { value: "64.90" },
            test: [enterMismatchTest],
          }),
        ]
      : []),
    req(`${n}.11 Holds: list`, { path: `${run}/holds`, auth: "console", test: [holdsTest] }),
    req(`${n}.12 Holds: H1 duplicate slip, count once`, {
      method: "POST",
      path: "/v1/holds/{{hold.H1}}/resolve",
      auth: "console",
      body: { resolution: "COUNT_ONCE" },
      test: [resolveTest, { label: "H1" }],
    }),
    req(`${n}.13 Holds: H2 register the plot`, {
      method: "POST",
      path: "/v1/holds/{{hold.H2}}/resolve",
      auth: "console",
      body: { resolution: "REGISTER_PLOT", plot: { plotNo: "P-053-B", areaHa: "0.60", trees: 330 } },
      test: [resolveTest, { label: "H2" }],
    }),
    req(`${n}.14 Holds: H3 return as credit`, {
      method: "POST",
      path: "/v1/holds/{{hold.H3}}/resolve",
      auth: "console",
      body: { resolution: "RETURN_AS_CREDIT" },
      test: [resolveTest, { label: "H3" }],
    }),
    waitRun(`${n}.15 Holds: wait until nothing blocks`, {
      states: ["IN_REVIEW"],
      holdsClear: true,
      ms: 15000,
      holds: { open: 0, blocking: 0 },
      lines: { READY: 64 },
    }),
  ];
}

/** The Chair's frame, both demo keys, both payloads, both signatures. */
function bothKeys(n, after) {
  return [
    req(`${n}.17 Approvals: the Chair's frame token`, {
      method: "POST",
      path: "/v1/judge/sessions/{{sessionId}}/frames",
      auth: "cookie",
      body: { persona: "board:ernesto" },
      test: [frameTest],
    }),
    req(`${n}.18 Approvals: register the treasurer's demo key`, {
      method: "POST",
      path: "/v1/judge/keys",
      auth: "console",
      body: "{{keyBody}}",
      pre: [registerKeyPre, { role: "treasurer", approverId: "treasurer:analyn" }],
      test: [registerKeyTest, { role: "treasurer", approverId: "treasurer:analyn" }],
    }),
    req(`${n}.19 Approvals: register the Chair's demo key`, {
      method: "POST",
      path: "/v1/judge/keys",
      auth: "chair",
      body: "{{keyBody}}",
      pre: [registerKeyPre, { role: "chair", approverId: "board:ernesto" }],
      test: [registerKeyTest, { role: "chair", approverId: "board:ernesto" }],
    }),
    req(`${n}.20 Approvals: the treasurer's payload`, {
      path: `${run}/approval-payload?role=treasurer`,
      auth: "console",
      test: [payloadTest, { role: "treasurer" }],
    }),
    req(`${n}.21 Approvals: key 1, the treasurer signs`, {
      method: "POST",
      path: `${run}/approvals`,
      auth: "console",
      body: "{{approvalBody}}",
      pre: [approvePre, { role: "treasurer" }],
      test: [approveTest, { role: "treasurer", runState: "AWAITING_BOARD" }],
    }),
    req(`${n}.22 Approvals: the Chair's payload`, {
      path: `${run}/approval-payload?role=chair`,
      auth: "chair",
      test: [payloadTest, { role: "chair" }],
    }),
    req(`${n}.23 Approvals: key 2, the Chair signs`, {
      method: "POST",
      path: `${run}/approvals`,
      auth: "chair",
      body: "{{approvalBody}}",
      pre: [approvePre, { role: "chair" }],
      test: [approveTest, { role: "chair", runState: "APPROVED" }],
    }),
    ...after,
  ];
}

const sessionView = (name) =>
  req(name, { path: "/v1/judge/session", auth: "console", test: [sessionViewTest] });

function pressAndFund(n, again) {
  return [
    req(`${n}.01 Session: ${again ? "second press, same judge cookie" : "first press"}`, {
      method: "POST",
      path: "/v1/judge/sessions",
      auth: again ? "cookie" : undefined,
      body: {},
      pre: [sessionPressPre],
      test: [sessionPressTest, { again }],
    }),
    sessionView(`${n}.02 Session: the rail, its label and the quota decision`),
    waitRun(`${n}.03 Invoice: wait for INVOICED`, { states: ["INVOICED"], ms: 60000, invoiced: true }),
    req(`${n}.04 Fund: Mark paid`, {
      method: "POST",
      path: `${run}/mark-paid`,
      auth: "console",
      headers: [{ key: "Idempotency-Key", value: "{{idem.markPaid}}" }],
      body: {},
      pre: [markPaidPre],
      test: [markPaidTest],
    }),
  ];
}

const SETUP = folder(
  "0 Setup",
  "The local keyless stack answers, its OpenAPI document (the schemas every response is checked against) and the public lane.",
  [
    req("0.1 Health", {
      path: "/healthz",
      test: [
        () => {
          pm.test("200 ok on the simulated rail", () => {
            pm.response.to.have.status(200);
            pm.expect(pm.response.json()).to.include({ status: "ok", rail: "simulated" });
          });
        },
      ],
    }),
    req("0.2 OpenAPI document", {
      path: "/v1/openapi.json",
      test: [
        () => {
          pm.response.to.have.status(200);
          const doc = pm.response.json();
          pm.test("OpenAPI 3.1, generated from the contracts, rail labelled in its description", () => {
            pm.expect(doc.openapi).to.equal("3.1.0");
            pm.expect(doc.info.description).to.include("PayPal rail on this server: **simulated**");
            pm.expect(Object.keys(doc.paths).length).to.be.above(40);
          });
          pm.collectionVariables.set("openapi", pm.response.text());
          pm.collectionVariables.set(
            "simulatedLabel",
            "Simulated PayPal sandbox (contract-tested against PayPal's OpenAPI specs)",
          );
          fairCache.doc = null;
        },
      ],
    }),
    req("0.3 Judge lane (public, What's real)", {
      path: "/v1/judge/lane",
      test: [
        () => {
          pm.response.to.have.status(200);
          console.log(`lane quota: ${JSON.stringify(pm.response.json().rail?.quota ?? null)}`);
        },
      ],
    }),
  ],
);

const LOOP = folder(
  "1 The judge's 60-second loop",
  "Session, invoice, fund, read, holds, both approvals, payout, Proof, reset: the console's and the Chair frame's calls, scripted. The two officers sign with throwaway Ed25519 demo keys made in this run (lib.cjs).",
  [
    ...pressAndFund("1", false),
    req("1.05 Fund: Mark paid again, same Idempotency-Key", {
      method: "POST",
      path: `${run}/mark-paid`,
      auth: "console",
      headers: [{ key: "Idempotency-Key", value: "{{idem.markPaid}}" }],
      body: {},
      pre: [markPaidReplayPre],
      test: [markPaidReplayTest],
    }),
    ...review("1"),
    ...bothKeys("1", [
      waitRun("1.24 Payout: wait for the POST", {
        states: ["POSTING", "POSTED", "SETTLING", "NEEDS_FOLLOW_UP", "SETTLED"],
        ms: 60000,
        within: 60000,
        withinLabel: "the payout POST",
      }),
      waitRun("1.25 Payout: wait for NEEDS_FOLLOW_UP (one item parked)", {
        states: ["NEEDS_FOLLOW_UP"],
        ms: 180000,
      }),
      req("1.26 Payout: the lines", { path: `${run}/lines`, auth: "console", test: [linesTest] }),
      req("1.27 Payout: pay Rhea's parked line in cash", {
        method: "POST",
        path: "/v1/lines/{{parkedLineId}}/pay-cash",
        auth: "console",
        body: {},
        test: [payCashTest],
      }),
      waitRun("1.28 Payout: wait for SETTLED", {
        states: ["SETTLED"],
        ms: 60000,
        lines: { PAID: 7, OFF_RAIL_DUE: 57 },
      }),
      req("1.28b Payout: the posted batch is the signed batch", {
        path: run,
        auth: "console",
        test: [settledRunTest],
      }),
      req("1.29 Proof: metrics", { path: "/v1/proof/{{runSlug}}/metrics", test: [metricsTest] }),
      req("1.30 Proof: fs-api's verification", {
        path: "/v1/proof/{{runSlug}}/verification",
        test: [verificationTest],
      }),
      req("1.31 Reset: end the session", {
        method: "POST",
        path: "/v1/judge/sessions/{{sessionId}}/reset",
        auth: "cookie",
        body: {},
        pre: [resetPre],
        test: [resetTest],
      }),
      req("1.32 Reset: the old console token is refused", {
        path: run,
        auth: "console",
        test: [staleTokenTest],
      }),
    ]),
  ],
);

const PROOF = folder(
  "2 Proof verify",
  "The settled run's public Proof bundle, recomputed in the collection with nothing but the published keys: line hashes, the lines root, both Ed25519 approvals, the batch against the signed payload, the hash chain and the signed checkpoint. Then a one-cent altered copy must fail.",
  [
    req("2.1 Published keys (/.well-known)", { path: "/.well-known/fairsplit-keys.json", test: [keysTest] }),
    req("2.2 Proof bundle download, verified here", {
      path: "/v1/proof/{{proofSlug}}.json",
      test: [proofDownloadTest],
    }),
    req("2.3 Proof page bundle equals the download", {
      path: "/v1/proof/{{proofSlug}}",
      test: [proofPageTest],
    }),
  ],
);

const SIM_AUTH = ["{{simClientId}}", "{{simClientSecret}}"];

const FAILURES = folder(
  "3 Labelled failure paths",
  "PayPal's insufficient-funds test value, the tamper refusal after both keys (I4), a re-posted webhook delivery, and a reused pairing token. Every one is labelled simulated.",
  [
    folder(
      "3a Insufficient funds (ERRPYO005)",
      "fs-api has no route that sends PayPal's ERRPYO005 test value (the console dropped that control), so this path calls the contract-faithful simulator directly: the standalone tools/paypal-sim.ts that run.mjs starts on loopback, with the registry's fictional fs-judge app. Skipped when simBaseUrl is empty.",
      [
        req("3a.01 Simulator: OAuth token", {
          method: "POST",
          base: "simBaseUrl",
          path: "/v1/oauth2/token",
          form: { grant_type: "client_credentials" },
          basicAuth: SIM_AUTH,
          pre: [simPre],
          test: [simTokenTest],
        }),
        req("3a.02 Simulator: balance before", {
          base: "simBaseUrl",
          path: "/v1/reporting/balances?currency_code=USD",
          headers: [{ key: "Authorization", value: "Bearer {{simToken}}" }],
          pre: [simPre],
          test: [simBalanceTest, { compare: false }],
        }),
        req("3a.03 Simulator: a payout with ERRPYO005 is refused", {
          method: "POST",
          base: "simBaseUrl",
          path: "/v1/payments/payouts",
          headers: [{ key: "Authorization", value: "Bearer {{simToken}}" }],
          body: {
            sender_batch_header: { sender_batch_id: "{{simBatchId}}", email_subject: "Simulated test value" },
            items: [
              {
                recipient_type: "EMAIL",
                amount: { value: "1.00", currency: "USD" },
                receiver: "consolacion.bacus@example.org",
                note: "ERRPYO005",
                sender_item_id: "pm-errpyo005",
              },
            ],
          },
          pre: [errpyo005Pre],
          test: [errpyo005Test],
        }),
        req("3a.04 Simulator: balance unchanged", {
          base: "simBaseUrl",
          path: "/v1/reporting/balances?currency_code=USD",
          headers: [{ key: "Authorization", value: "Bearer {{simToken}}" }],
          pre: [simPre],
          test: [simBalanceTest, { compare: true }],
        }),
      ],
    ),
    folder(
      "3b Tamper refused after both keys (I4)",
      "A second press on the same judge cookie, the review again, then change_payout armed before key 2: both keys sign, the POST re-hashes the batch from the database, refuses, sends nothing and voids both approvals.",
      [
        ...pressAndFund("3b", true),
        ...review("3b"),
        req("3b.16 Tamper: arm change_payout before key 2", {
          method: "POST",
          path: "/v1/judge/sessions/{{sessionId}}/tamper",
          auth: "cookie",
          body: { kind: "change_payout" },
          test: [tamperTest],
        }),
        ...bothKeys("3b", [
          req("3b.24 Tamper: wait for the refusal and the send-back", {
            path: run,
            auth: "console",
            test: [sentBackTest],
          }),
          req("3b.25 Tamper: nothing is armed any more", {
            path: "/v1/judge/session",
            auth: "console",
            test: [disarmedTest],
          }),
        ]),
      ],
    ),
    folder(
      "3c Duplicate webhook delivery",
      "The in-process simulator delivers every event twice (new transmission ids); fs-api stores each event once. Here a stored event is posted again as a copy without PayPal's signature, twice with one transmission id: both are refused and the stored event is unchanged.",
      [
        req("3c.01 Webhooks: stored deliveries (/ops, this workspace)", {
          path: "/v1/ops/overview",
          auth: "console",
          test: [overviewTest, { after: false }],
        }),
        req("3c.02 Webhooks: post a copy of a stored event", {
          method: "POST",
          path: "/webhooks/paypal",
          headers: [
            { key: "PAYPAL-TRANSMISSION-ID", value: "{{whTransmission}}" },
            { key: "PAYPAL-TRANSMISSION-TIME", value: "{{whTime}}" },
            { key: "PAYPAL-TRANSMISSION-SIG", value: "Q29weSB3aXRob3V0IFBheVBhbCdzIHNpZ25hdHVyZQ==" },
            { key: "PAYPAL-CERT-URL", value: "{{baseUrl}}/paypal-sim/sim/certs/not-a-certificate.pem" },
            { key: "PAYPAL-AUTH-ALGO", value: "SHA256withRSA" },
          ],
          body: "{{whBody}}",
          pre: [webhookCopyPre],
          test: [webhookCopyTest, { what: "an unsigned copy of a stored event" }],
        }),
        req("3c.03 Webhooks: the same copy again (same transmission id)", {
          method: "POST",
          path: "/webhooks/paypal",
          headers: [
            { key: "PAYPAL-TRANSMISSION-ID", value: "{{whTransmission}}" },
            { key: "PAYPAL-TRANSMISSION-TIME", value: "{{whTime}}" },
            { key: "PAYPAL-TRANSMISSION-SIG", value: "Q29weSB3aXRob3V0IFBheVBhbCdzIHNpZ25hdHVyZQ==" },
            { key: "PAYPAL-CERT-URL", value: "{{baseUrl}}/paypal-sim/sim/certs/not-a-certificate.pem" },
            { key: "PAYPAL-AUTH-ALGO", value: "SHA256withRSA" },
          ],
          body: "{{whBody}}",
          pre: [webhookCopyPre],
          test: [webhookCopyTest, { what: "the repeated copy" }],
        }),
        req("3c.04 Webhooks: the stored event is unchanged", {
          path: "/v1/ops/overview",
          auth: "console",
          test: [overviewTest, { after: true }],
        }),
      ],
    ),
    folder(
      "3d Pairing token reused",
      "A single-use pairing for the Chair's phone: the first claim works, the same token again, its six-digit code again and a token never issued are all refused with 410. (Expiry is the same 410 after 10 minutes; the collection does not wait for it.)",
      [
        req("3d.01 Pairing: make one for the Chair's phone", {
          method: "POST",
          path: "/v1/pairing",
          auth: "console",
          body: { persona: "ernesto", role: "board" },
          test: [pairingTest],
        }),
        req("3d.02 Pairing: claim it", {
          method: "POST",
          path: "/v1/pairing/claim",
          body: '{"token":"{{pairToken}}"}',
          test: [claimTest],
        }),
        req("3d.03 Pairing: claim the same token again", {
          method: "POST",
          path: "/v1/pairing/claim",
          body: '{"token":"{{pairToken}}"}',
          test: [claimRefusedTest, { what: "a used token" }],
        }),
        req("3d.04 Pairing: claim its code again", {
          method: "POST",
          path: "/v1/pairing/claim",
          body: '{"code6":"{{pairCode}}"}',
          test: [claimRefusedTest, { what: "a used code" }],
        }),
        req("3d.05 Pairing: a token never issued", {
          method: "POST",
          path: "/v1/pairing/claim",
          body: '{"token":"{{strayToken}}"}',
          pre: [neverIssuedPre],
          test: [claimRefusedTest, { what: "a token this server never issued" }],
        }),
        req("3d.06 Reset: end the second session", {
          method: "POST",
          path: "/v1/judge/sessions/{{sessionId}}/reset",
          auth: "cookie",
          body: {},
          pre: [resetPre],
          test: [resetTest],
        }),
      ],
    ),
  ],
);

export function buildCollection() {
  const lib = readFileSync(LIB_PATH, "utf8").replace(/\r\n/g, "\n").trimEnd().split("\n");
  return {
    info: {
      name: "Fair Split API: judge loop, Proof verify, labelled failures (local keyless stack)",
      description:
        "Runs against a LOCAL keyless fs-api only (PP_MODE=simulator: every PayPal value is the labelled simulator's; the reading is the seed's labelled stand-in). Not for a hosted demo. Run it with `node postman/run.mjs --base-url <origin>`; see postman/README.md. Generated by postman/build.mjs: edit that, then rebuild.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    event: [event("prerequest", [...lib, ...script(collectionPre)]), event("test", script(collectionTest))],
    item: [SETUP, LOOP, PROOF, FAILURES],
  };
}

export function serialise(collection) {
  return `${JSON.stringify(collection, null, 2)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = serialise(buildCollection());
  if (process.argv.includes("--check")) {
    const current = readFileSync(COLLECTION_PATH, "utf8").replace(/\r\n/g, "\n");
    if (JSON.stringify(JSON.parse(current)) !== JSON.stringify(JSON.parse(text))) {
      console.error("postman/fair-split.postman_collection.json is stale: run `node postman/build.mjs`");
      process.exit(1);
    }
    console.log("postman collection is up to date");
  } else {
    writeFileSync(COLLECTION_PATH, text);
    console.log(`wrote ${COLLECTION_PATH}`);
  }
}
