import { decide } from "@fairsplit/domain";
import { getSnapshot } from "@fairsplit/seed";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RESUME_QUOTA_WAIT_MS, resumeWaitMs, settlementOf } from "./live-step.js";
import {
  dailyLivePostCap,
  daysLeft,
  decideRail,
  isQuotaReplay,
  JUDGE_QUOTA,
  type JudgeStep,
  type QuotaFacts,
} from "./quota.js";
import { PRESENCE, PresenceTracker } from "./runtime.js";
import { EXTRA_RECIPIENT, OVERCHARGE_CENTS, tamperedDraft } from "./tamper.js";

const NOW = new Date("2026-11-03T10:15:00.000Z");

function facts(o: Partial<QuotaFacts> = {}): QuotaFacts {
  return {
    killPaypalLive: false,
    simulatorStub: false,
    circuitOpenUntil: null,
    balance: { cents: JUDGE_QUOTA.simulatorOpeningCents, source: "reading", at: NOW, spentCents: 0 },
    posts24h: 0,
    postsThisHour: 0,
    sessionPosts24h: 0,
    publicPosts24h: 0,
    coded: false,
    ...o,
  };
}

describe("the daily live-post formula", () => {
  it("is min(40, floor((balance − US$10,000) / (US$345 × days left to 15 Dec)))", () => {
    expect(daysLeft("2026-11-03")).toBe(42);
    // US$100,000: floor(90,000 / (345 × 42)) = 6
    expect(dailyLivePostCap(10_000_000, "2026-11-03")).toBe(6);
    // about 14 a day in December (plan): US$100,000 on 1 Dec is floor(90,000 / (345 × 14)) = 18; on 10 Dec, 40
    expect(dailyLivePostCap(10_000_000, "2026-12-01")).toBe(18);
    expect(dailyLivePostCap(10_000_000, "2026-12-10")).toBe(40);
    expect(dailyLivePostCap(1_000_000, "2026-11-03")).toBe(0);
    expect(dailyLivePostCap(500_000, "2026-11-03")).toBe(0);
    expect(daysLeft("2026-12-20")).toBe(1); // after judging ends, never divide by zero or less
  });

  it("property: the cap is an integer in 0..40 and never falls as the balance rises", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50_000_000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 0, max: 60 }),
        (balance, more, dayOffset) => {
          const day = new Date(Date.UTC(2026, 9, 27 + dayOffset)).toISOString().slice(0, 10);
          const cap = dailyLivePostCap(balance, day);
          expect(Number.isInteger(cap)).toBe(true);
          expect(cap).toBeGreaterThanOrEqual(0);
          expect(cap).toBeLessThanOrEqual(40);
          expect(dailyLivePostCap(balance + more, day)).toBeGreaterThanOrEqual(cap);
        },
      ),
    );
  });
});

describe("live or replay", () => {
  it("inv.i8.labels: a pacing replay names the simulated PayPal sandbox", () => {
    const decision = decideRail(
      facts({ circuitOpenUntil: new Date(NOW.getTime() + 60_000) }),
      NOW,
      "fund",
      "simulated",
    );
    expect(decision.label).toContain("simulated PayPal sandbox is pacing us");
  });

  it("is live when every guard allows it, with the rail's own words (I8)", () => {
    expect(decideRail(facts(), NOW, "session", "sandbox")).toMatchObject({
      mode: "live",
      reason: null,
      label: "Live in PayPal's sandbox",
    });
    expect(decideRail(facts(), NOW, "session", "simulated").label).toMatch(/^Simulated PayPal sandbox/);
  });

  it("replays, labelled, for each guard in turn (never a refusal)", () => {
    const cases: [Partial<QuotaFacts>, string][] = [
      [{ killPaypalLive: true }, "kill_switch"],
      [{ simulatorStub: true }, "simulator_not_running"],
      [{ circuitOpenUntil: new Date(NOW.getTime() + 60_000) }, "circuit_open"],
      [{ balance: { cents: null, source: "unknown", at: null, spentCents: 0 } }, "balance_unknown"],
      [{ balance: { cents: 999_999, source: "reading", at: NOW, spentCents: 0 } }, "balance_low"],
      [{ posts24h: 6 }, "daily_cap"],
      [{ postsThisHour: 3 }, "hourly_cap"],
      [{ sessionPosts24h: 3 }, "session_cap"],
      [{ publicPosts24h: 2 }, "public_share"],
    ];
    for (const [f, reason] of cases) {
      const d = decideRail(facts(f), NOW, "post", "sandbox");
      expect(d, reason).toMatchObject({ mode: "replay", reason });
      expect(d.label).toMatch(/^Replay: /);
    }
    // a judge code lifts only the public share
    expect(decideRail(facts({ publicPosts24h: 2, coded: true }), NOW, "post", "sandbox").mode).toBe("live");
    // a closed circuit is no reason
    expect(
      decideRail(facts({ circuitOpenUntil: new Date(NOW.getTime() - 1) }), NOW, "post", "sandbox").mode,
    ).toBe("live");
  });

  it("quota guards bind the steps of a live run, not a cancel or a resend of one already posted", () => {
    const over = facts({ posts24h: 99, postsThisHour: 99, sessionPosts24h: 99 });
    for (const step of ["cancel", "resend"] as const)
      expect(decideRail(over, NOW, step, "sandbox").mode).toBe("live");
    for (const step of ["session", "invoice", "fund", "post"] as const) {
      expect(decideRail(over, NOW, step, "sandbox").mode).toBe("replay");
    }
    expect(decideRail(facts({ killPaypalLive: true }), NOW, "cancel", "sandbox").mode).toBe("replay");
  });

  it("property (monotone): more posts, a lower or unknown balance, or a switch turned on never turns a replay live", () => {
    const steps: JudgeStep[] = ["session", "invoice", "fund", "post", "cancel", "resend"];
    fc.assert(
      fc.property(
        fc.record({
          posts24h: fc.nat(50),
          postsThisHour: fc.nat(5),
          sessionPosts24h: fc.nat(5),
          publicPosts24h: fc.nat(20),
          cents: fc.option(fc.integer({ min: 0, max: 20_000_000 }), { nil: null }),
          kill: fc.boolean(),
          stub: fc.boolean(),
          coded: fc.boolean(),
        }),
        fc.record({
          posts: fc.nat(5),
          less: fc.nat(5_000_000),
          forget: fc.boolean(),
          kill: fc.boolean(),
          stub: fc.boolean(),
        }),
        fc.constantFrom(...steps),
        (a, worse, step) => {
          const base = facts({
            posts24h: a.posts24h,
            postsThisHour: a.postsThisHour,
            sessionPosts24h: a.sessionPosts24h,
            publicPosts24h: a.publicPosts24h,
            balance:
              a.cents === null
                ? { cents: null, source: "unknown", at: null, spentCents: 0 }
                : { cents: a.cents, source: "reading", at: NOW, spentCents: 0 },
            killPaypalLive: a.kill,
            simulatorStub: a.stub,
            coded: a.coded,
          });
          // losing the reading (unknown) is the worst a balance can get
          const cents = base.balance.cents === null || worse.forget ? null : base.balance.cents - worse.less;
          const harder: QuotaFacts = {
            ...base,
            posts24h: base.posts24h + worse.posts,
            postsThisHour: base.postsThisHour + worse.posts,
            sessionPosts24h: base.sessionPosts24h + worse.posts,
            publicPosts24h: base.publicPosts24h + worse.posts,
            balance:
              cents === null
                ? { cents: null, source: "unknown", at: null, spentCents: 0 }
                : { ...base.balance, cents },
            killPaypalLive: base.killPaypalLive || worse.kill,
            simulatorStub: base.simulatorStub || worse.stub,
          };
          if (decideRail(base, NOW, step, "sandbox").mode === "replay") {
            expect(decideRail(harder, NOW, step, "sandbox").mode).toBe("replay");
          }
        },
      ),
    );
  });

  it("a run holding a reservation is past the quota reasons, never past a switch, the simulator or the circuit", () => {
    const quota: Partial<QuotaFacts>[] = [
      { balance: { cents: null, source: "unknown", at: null, spentCents: 0 } },
      { balance: { cents: 1, source: "reading", at: NOW, spentCents: 0 } },
      { posts24h: 99 },
      { postsThisHour: 3 },
      { sessionPosts24h: 3 },
      { publicPosts24h: 99 },
    ];
    for (const f of quota) expect(isQuotaReplay(decideRail(facts(f), NOW, "post", "sandbox"))).toBe(true);
    const switches: Partial<QuotaFacts>[] = [
      { killPaypalLive: true },
      { simulatorStub: true },
      { circuitOpenUntil: new Date(NOW.getTime() + 1) },
    ];
    for (const f of switches) {
      expect(isQuotaReplay(decideRail(facts(f), NOW, "post", "sandbox"))).toBe(false);
    }
    expect(isQuotaReplay(decideRail(facts(), NOW, "post", "sandbox"))).toBe(false);
  });
});

describe("settling a live post from PayoutsService's outcome", () => {
  const base = { senderBatchId: "2026A-7f3a91c2-r470001" };
  const created = { ...base, payoutBatchId: "B1", batchStatus: "PENDING", batchSha256: "a".repeat(64) };
  const extra = { requestId: "r", debugId: null, attempts: 1, verifiedBy: null };

  it("posted when PayPal created or already holds the batch; denied on a synchronous 4xx; free when nothing was sent", () => {
    expect(settlementOf({ kind: "created", ...created, ...extra })).toBe("posted");
    expect(settlementOf({ kind: "adopted", ...created, ...extra })).toBe("posted");
    // PayPal says the batch exists but it does not re-hash: money may have moved, so the slot stays spent
    expect(settlementOf({ kind: "refused", code: "ADOPT_FAILED", reason: "x", ...base })).toBe("posted");
    expect(
      settlementOf({
        kind: "rejected",
        ...base,
        status: 422,
        name: "INSUFFICIENT_FUNDS",
        message: "x",
        debugId: null,
      }),
    ).toBe("denied");
    for (const code of ["DIGEST_MISMATCH", "APPROVALS_MISSING", "KILL_SWITCH_ON", "SANDBOX_GUARD"] as const) {
      expect(settlementOf({ kind: "refused", code, reason: "x", ...base }), code).toBe("not_posted");
    }
  });

  it("stays open (the retry resumes the same batch) when unresolved, circuit-paced, or never answered", () => {
    expect(settlementOf({ kind: "refused", code: "CIRCUIT_OPEN", reason: "x", ...base })).toBeNull();
    // the limiter's window: only ever after the rows are written (the service's POST loop), so the slot stays held
    expect(settlementOf({ kind: "refused", code: "QUEUED", reason: "x", ...base })).toBeNull();
    expect(
      settlementOf({
        kind: "unresolved",
        ...base,
        attempts: 4,
        lastStatus: 503,
        debugId: null,
        reason: "RETRIES_EXHAUSTED",
      }),
    ).toBeNull();
    expect(settlementOf(undefined)).toBeNull();
  });
});

describe("how long a resumed post waits (a written batch is never replayed)", () => {
  it("the circuit's six minutes, the next clock hour for the hourly cap, a quarter hour for the other quotas", () => {
    expect(resumeWaitMs("circuit_open", NOW)).toBe(6 * 60_000);
    // 10:15 → 11:00, plus a second
    expect(resumeWaitMs("hourly_cap", NOW)).toBe(45 * 60_000 + 1_000);
    for (const r of ["daily_cap", "session_cap", "public_share", "balance_unknown", "balance_low"] as const) {
      expect(resumeWaitMs(r, NOW), r).toBe(RESUME_QUOTA_WAIT_MS);
    }
    for (const r of ["kill_switch", "simulator_not_running", "lane_full"] as const) {
      expect(resumeWaitMs(r, NOW), r).toBe(60_000);
    }
  });
});

describe("presence throttle", () => {
  it("one event per 5 s per persona; a change waits for the gap; the same view refreshes before it expires", () => {
    const p = new PresenceTracker();
    const k = "ws|board:ernesto|";
    expect(p.shouldEmit(k, "M-BD-01", null, 0)).toBe(true);
    expect(p.shouldEmit(k, "M-BD-02", null, 1_000)).toBe(false); // inside 5 s
    expect(p.shouldEmit(k, "M-BD-02", null, 5_000)).toBe(true);
    expect(p.shouldEmit(k, "M-BD-02", null, 15_000)).toBe(false); // unchanged and fresh
    expect(p.shouldEmit(k, "M-BD-02", null, 5_000 + PRESENCE.refreshAfterMs)).toBe(true); // refreshed inside 25 s
    expect(PRESENCE.refreshAfterMs).toBeLessThan(PRESENCE.ttlMs);
    expect(p.shouldEmit("other|board:ernesto|", "M-BD-01", null, 1)).toBe(true); // per workspace
    p.forgetWorkspace("ws");
    expect(p.shouldEmit(k, "M-BD-02", null, 25_001)).toBe(true);
  });

  it("property: never two events for one persona less than 5 s apart", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ dt: fc.nat(8_000), view: fc.constantFrom("a", "b", "c") }), { maxLength: 80 }),
        (beats) => {
          const p = new PresenceTracker();
          let now = 0;
          let last = Number.NEGATIVE_INFINITY;
          for (const b of beats) {
            now += b.dt;
            if (p.shouldEmit("k", b.view, null, now)) {
              expect(now - last).toBeGreaterThanOrEqual(PRESENCE.minGapMs);
              last = now;
            }
          }
        },
      ),
    );
  });
});

describe("Try to break it: the tampered drafts (pure)", () => {
  const s = getSnapshot();
  const canonical = {
    currency_code: "USD" as const,
    invoice_number: "FS-2026A-r470001",
    reference: `rc:${s.rateCard.sha16}`,
    note: s.run.invoice.note,
    invoicer_email_address: "co-op@example.com",
    primary_recipients: [
      { billing_info: { business_name: s.payer.name, email_address: "brand@example.com" } },
    ] as [{ billing_info: { business_name: string; email_address: string } }],
    items: s.run.quote.items.map((i) => ({
      name: i.name,
      quantity: "1" as const,
      unit_amount: { currency_code: "USD" as const, value: (i.unitAmountCents / 100).toFixed(2) },
      unit_of_measure: "AMOUNT" as const,
    })),
  };

  it("amount adds exactly US$1,000.00 to the premium line and nothing else", () => {
    const d = tamperedDraft(canonical, "amount") as typeof canonical;
    const premium = s.run.quote.items[0]?.unitAmountCents ?? 0;
    expect(d.items[0]?.unit_amount.value).toBe(((premium + OVERCHARGE_CENTS) / 100).toFixed(2));
    expect({ ...d, items: d.items.slice(1) }).toEqual({ ...canonical, items: canonical.items.slice(1) });
    expect(canonical.items[0]?.unit_amount.value).toBe((premium / 100).toFixed(2)); // a copy, never the original
  });

  it("offsetting adds shipping and an equal discount; recipient adds a copy recipient", () => {
    const off = tamperedDraft(canonical, "offsetting") as Record<string, unknown> & {
      items: Record<string, unknown>[];
    };
    expect(off.shipping_cost).toBe("50.00");
    expect(off.items[0]?.discount).toEqual({ amount: { currency_code: "USD", value: "50.00" } });
    const rec = tamperedDraft(canonical, "recipient") as Record<string, unknown>;
    expect(rec.additional_recipients).toEqual([EXTRA_RECIPIENT]);
  });

  it("inv.i1.lattice: the real lattice denies each tamper even in the one phase that allows drafting", () => {
    const ctx = {
      flags: { killPayouts: false, killPaypalLive: false, killAiLive: false },
      ppEnv: "sandbox",
      toolkitSandbox: true,
      runState: "QUOTED" as const,
      invoiceExists: false,
      holds: [],
      budget: { spentMicros: 0, capMicros: 250_000, iteration: 0, maxIterations: 8 },
      expected: {
        quote: s.run.quote,
        invoiceNumber: canonical.invoice_number,
        reference: canonical.reference,
        memo: canonical.note,
        businessEmail: canonical.invoicer_email_address,
        payer: { email: "brand@example.com", businessName: s.payer.name },
        brandAllowlist: ["brand@example.com"],
        invoiceId: null,
        invoiceDate: null,
      },
      today: "2026-11-03",
    };
    // the untouched canonical draft passes the content policies
    expect(decide({ name: "create_invoice", args: canonical }, ctx).verdict).toBe("ALLOW");
    for (const kind of ["amount", "offsetting", "recipient"] as const) {
      const d = decide({ name: "create_invoice", args: tamperedDraft(canonical, kind) }, ctx);
      expect(d.verdict, kind).toBe("DENY");
      expect(d.decidedBy, kind).not.toContain("phaseGate");
    }
  });
});
