/**
 * I4 end to end on the phone, without a device: the console's batch can change at any moment of the Chair's
 * signature (during the hold, with the dialog open, while a stale payload is replaced, while a payload is fetched,
 * under the fingerprint prompt), and the phone must never sign or send anything but the batch he opened. The phone
 * below is composed from the same pure pieces as `CosignProvider` and `useSign`.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ApiResult, ApprovalSubmission, CosignRequestDTO } from "../../_shims/api-client";
import type { ApprovalPayload } from "../../_shims/contracts";
import { batchDigest, linesDigest as digestLines } from "../../_shims/domain";
import { namedLines, people, runId, season } from "../../_shims/seed";
import {
  approvalBytes,
  checkApprovalPayload,
  cosign,
  createDemoVault,
  type ExpectedBatch,
  type KeySignOutcome,
  verifyApproval,
} from "../../lib/signing";
import { buildDemoCosign } from "../../services/demo-fixtures";
import {
  type CosignSnapshot,
  commitRefusal,
  EMPTY_MEMORY,
  type FreshPayload,
  payloadPlan,
  prefetchFor,
  type RequestMemory,
  rememberPayload,
  rememberRequest,
  requestStatus,
} from "./cosign-model";
import {
  commitSignature,
  type FlowEvent,
  type FlowPhase,
  flowReducer,
  refusalFailure,
  signPhase,
  slabLive,
} from "./sign-flow";

const NOW = new Date("2026-10-29T10:20:00+08:00");
const rnd = (n: number) => new Uint8Array(randomBytes(n));

/** One cent moved between two payouts: a valid batch with its own hash, but not the one the Chair opened. */
function movedCent(dto: CosignRequestDTO): CosignRequestDTO {
  const items = dto.items.map((it, i) =>
    i === 0
      ? { ...it, amountCents: it.amountCents - 1 }
      : i === 1
        ? { ...it, amountCents: it.amountCents + 1 }
        : it,
  );
  return { ...dto, items, batchSha256: batchDigest(dto, items) };
}

/** The same payouts, but a cash line moved by a cent: only the lines digest differs. */
function movedCashLine(dto: CosignRequestDTO): CosignRequestDTO {
  const lines = namedLines.map((l) => (l.rail === "CASH" ? { ...l, netCents: l.netCents + 1 } : l));
  return { ...dto, linesDigest: digestLines(runId, lines) };
}

/** The console: the batch it offers now, and an approval payload for whatever that batch is. */
function consoleSide() {
  let dto = buildDemoCosign({ now: NOW, treasurerSigned: true });
  let nonce = 0;
  const issued: ApprovalPayload[] = [];
  return {
    get dto() {
      return dto;
    },
    change(next: (d: CosignRequestDTO) => CosignRequestDTO) {
      dto = next(dto);
    },
    payload(exp = new Date(NOW.getTime() + 10 * 60_000)): ApprovalPayload {
      const p: ApprovalPayload = {
        v: 1,
        runId: dto.runId,
        seasonId: season.id,
        rateCardSha256: dto.rateCardSha256,
        batchSha256: dto.batchSha256,
        linesDigest: dto.linesDigest,
        itemCount: dto.itemCount,
        totalCents: dto.totalCents,
        currency: "USD",
        role: "CHAIR",
        approverId: people.chair.approverId,
        nonce: `n_${String(++nonce).padStart(10, "0")}`,
        exp: exp.toISOString(),
      };
      issued.push(p);
      return p;
    },
    issued,
  };
}

/** The phone: `CosignProvider`'s memory and gate, and `useSign`'s commit, from the same pure pieces. */
function phoneSide(srv: ReturnType<typeof consoleSide>) {
  let m: RequestMemory = EMPTY_MEMORY;
  const snapshot = (): CosignSnapshot => ({
    ...m,
    loading: false,
    loadError: null,
    online: true,
    now: NOW.getTime(),
    sentBack: false,
    chairSigned: false,
  });
  const fetchPayload = async (expected: ExpectedBatch): Promise<FreshPayload> => {
    const checked = checkApprovalPayload(srv.payload(), expected, NOW);
    m = rememberPayload(m, expected, checked);
    if (!checked.ok) return { ok: false, reason: checked.problem === "expired" ? "error" : "mismatch" };
    return { ok: true, payload: checked.payload, expected };
  };
  const vault = createDemoVault(rnd, () => NOW);
  const key = vi.fn(
    (message: Uint8Array): Promise<KeySignOutcome> =>
      vault.sign({ persona: "board:ernesto", message, prompt: "p", cancelLabel: "c", sessionTag: "t" }),
  );
  const submit = vi.fn(
    async (_b: ApprovalSubmission): Promise<ApiResult<{ accepted: true }>> => ({
      ok: true,
      value: { accepted: true },
    }),
  );
  const register = vi.fn(async (): Promise<ApiResult<{ ok: true }>> => ({ ok: true, value: { ok: true } }));
  const phone = {
    key,
    submit,
    register,
    snapshot,
    status: () => requestStatus(snapshot()),
    /** A fetch of the request: the first one opens it; SSE events fetch it again; `adopt` is "Review again". */
    async load(adopt = false) {
      m = rememberRequest(m, srv.dto, adopt);
      const expected = prefetchFor(m);
      if (expected) await fetchPayload(expected);
    },
    /** The payload in hand is replaced by one that expires in 90 s (the next step must fetch a fresh one). */
    holdStalePayload() {
      m = { ...m, payload: srv.payload(new Date(NOW.getTime() + 90_000)), payloadOk: true };
    },
    refusal: () => refusalFailure(commitRefusal(snapshot())),
    async freshPayload(): Promise<FreshPayload> {
      const plan = payloadPlan(m, NOW);
      if (plan.kind === "refuse") return { ok: false, reason: "mismatch" };
      if (plan.kind === "cached") return { ok: true, payload: plan.payload, expected: plan.expected };
      return fetchPayload(plan.expected);
    },
    /** The release inside (or the dialog's confirm). `during` runs while the payload is in flight. */
    commit(opts: { during?: () => Promise<void>; underPrompt?: () => Promise<void> } = {}) {
      return commitSignature({
        refusal: phone.refusal,
        payload: async () => {
          const fresh = await phone.freshPayload();
          await opts.during?.();
          return fresh;
        },
        sign: (payload, expected, recheck) =>
          cosign(payload, expected, {
            now: () => NOW,
            online: () => true,
            recheck,
            sign: async (message) => {
              const r = await key(message);
              await opts.underPrompt?.();
              return r;
            },
            isRegistered: () => false,
            register,
            submit,
          }),
      });
    },
  };
  return phone;
}

const hold = (state: "holding" | "armed" | "confirm"): FlowEvent => ({ type: "hold", state });
const run = (events: FlowEvent[]) => events.reduce<FlowPhase>(flowReducer, "idle");

describe("I4 at the instant of signing", () => {
  it("signs the batch he opened when nothing changes", async () => {
    const srv = consoleSide();
    const phone = phoneSide(srv);
    await phone.load();
    const r = await phone.commit();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.submission.payload.batchSha256).toBe(srv.dto.batchSha256);
    expect(verifyApproval(r.submission, r.key.publicKeyHex)).toBe(true);
  });

  it("inv.i4.changed-while-armed: a batch that changes during the hold is never signed", async () => {
    const srv = consoleSide();
    const phone = phoneSide(srv);
    await phone.load();
    const armed = run([hold("holding"), hold("armed")]);
    expect(signPhase(phone.status(), true, armed)).toBe("armed");

    srv.change(movedCent);
    await phone.load(); // the SSE event that the batch changed
    // The sheet stops offering the slab at once …
    expect(signPhase(phone.status(), true, armed)).toBe("mismatch");
    expect(slabLive(signPhase(phone.status(), true, armed))).toBe(false);
    // … and a release that still arrives (the shared slab acts on an armed release) signs nothing.
    const fetched = srv.issued.length;
    const r = await phone.commit();
    expect(r).toMatchObject({ ok: false, state: "mismatch" });
    expect(phone.key).not.toHaveBeenCalled();
    expect(phone.submit).not.toHaveBeenCalled();
    expect(srv.issued).toHaveLength(fetched); // not even a payload for the new batch was asked for
  });

  it("inv.i4.changed-with-dialog-open: confirming the dialog after the batch changed signs nothing", async () => {
    const srv = consoleSide();
    const phone = phoneSide(srv);
    await phone.load();
    const dialog = run([hold("confirm")]);
    srv.change(movedCent);
    await phone.load();
    // The dialog's amount and recipients would now be the new batch: the sheet closes it (slab flush) …
    expect(slabLive(signPhase(phone.status(), true, dialog))).toBe(false);
    // … and its confirm, if it still fires, is refused before the fingerprint.
    expect(flowReducer(dialog, { type: "commit" })).toBe("biometric");
    const r = await phone.commit();
    expect(r).toMatchObject({ ok: false, state: "mismatch" });
    expect(phone.key).not.toHaveBeenCalled();
    expect(phone.submit).not.toHaveBeenCalled();
  });

  it("inv.i4.changed-after-stale-payload: a replaced payload is checked against the opened batch, never the new one", async () => {
    const srv = consoleSide();
    const phone = phoneSide(srv);
    await phone.load();
    phone.holdStalePayload(); // under two minutes left: the next step fetches a fresh payload
    srv.change(movedCent); // the console changed, and the phone has not heard yet
    const r = await phone.commit();
    expect(r).toMatchObject({ ok: false, state: "mismatch" });
    expect(srv.issued.at(-1)?.batchSha256).toBe(srv.dto.batchSha256); // the fresh payload was the new batch …
    expect(phone.key).not.toHaveBeenCalled(); // … and it never reached the key
    expect(phone.status()).toBe("changed"); // the sheet now says so: "Nothing was signed"
  });

  it("inv.i4.changed-after-stale-payload: once the phone has heard, it does not even fetch", async () => {
    const srv = consoleSide();
    const phone = phoneSide(srv);
    await phone.load();
    phone.holdStalePayload();
    srv.change(movedCent);
    await phone.load();
    const fetched = srv.issued.length;
    expect(await phone.freshPayload()).toEqual({ ok: false, reason: "mismatch" });
    expect(await phone.commit()).toMatchObject({ ok: false, state: "mismatch" });
    expect(srv.issued).toHaveLength(fetched);
    expect(phone.key).not.toHaveBeenCalled();
  });

  it("inv.i4.changed-while-fetching: a batch that changes while the payload is in flight is refused", async () => {
    const srv = consoleSide();
    const phone = phoneSide(srv);
    await phone.load();
    phone.holdStalePayload();
    const r = await phone.commit({
      during: async () => {
        srv.change(movedCent);
        await phone.load();
      },
    });
    expect(r).toMatchObject({ ok: false, state: "mismatch", detail: "changed" });
    expect(phone.key).not.toHaveBeenCalled();
  });

  it("inv.i4.changed-under-the-fingerprint: a signature made while the batch changed is dropped, never sent", async () => {
    const srv = consoleSide();
    const phone = phoneSide(srv);
    await phone.load();
    const r = await phone.commit({
      underPrompt: async () => {
        srv.change(movedCent);
        await phone.load();
      },
    });
    expect(r).toMatchObject({ ok: false, state: "mismatch", detail: "recheck" });
    expect(phone.key).toHaveBeenCalledOnce();
    expect(phone.register).not.toHaveBeenCalled();
    expect(phone.submit).not.toHaveBeenCalled();
  });

  it("inv.i4.lines-changed: other member lines under the same payouts are a changed batch", async () => {
    const srv = consoleSide();
    const phone = phoneSide(srv);
    await phone.load();
    srv.change(movedCashLine);
    await phone.load();
    expect(phone.status()).toBe("changed");
    expect(await phone.commit()).toMatchObject({ ok: false, state: "mismatch" });
    expect(phone.key).not.toHaveBeenCalled();
  });

  it("signs the new batch only after he reviews it again, and the signature binds the new hash", async () => {
    const srv = consoleSide();
    const phone = phoneSide(srv);
    await phone.load();
    const opened = srv.dto.batchSha256;
    srv.change(movedCent);
    await phone.load();
    expect(phone.status()).toBe("changed");
    await phone.load(true); // "Review again"
    expect(phone.status()).toBe("request");
    const r = await phone.commit();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.submission.payload.batchSha256).toBe(srv.dto.batchSha256);
    expect(r.submission.payload.batchSha256).not.toBe(opened);
    const signed = phone.key.mock.calls[0]?.[0];
    expect(signed).toEqual(approvalBytes(r.submission.payload));
  });
});
