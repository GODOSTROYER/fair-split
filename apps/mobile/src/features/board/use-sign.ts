/**
 * M-BD-02's controller: the slab's hold states drive the pure flow (`sign-flow.ts`); a release inside fetches a fresh
 * payload, checks it against the batch the phone computed, asks for the one presence step and signs, registers a
 * new key, and posts the approval. The accepted signature starts MM-5's phone half (`signed-2`, then `sealed` at
 * +720 ms with the seal's plunk, then `inked` at +960 ms); every failure springs the slab back with nothing signed.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { format } from "../../_shims/domain";
import { type BiometricClass, type CosignFailure, cosign, type KeyMeta } from "../../lib/signing";
import { feedback } from "../../platform/feedback";
import { keyVault } from "../../platform/key-vault";
import { useApp } from "../../state/app";
import { announce } from "../../ui/a11y";
import type { HoldState } from "../../ui/hold";
import { useMoment } from "../../ui/moment";
import { TIMELINE } from "../../ui/motion";
import { useCosign } from "./cosign-context";
import type { BoardKey } from "./messages";
import { flowReducer, SIGN_MOMENT_PHASE, signPhase } from "./sign-flow";
import { useT } from "./use-t";

/** Keys whose public half this app session has already handed to the server (registration is idempotent). */
const registered = new Set<string>();

const FAILURE_COPY: Readonly<Record<CosignFailure, BoardKey>> = {
  offline: "M-BD-01.offline",
  mismatch: "M-BD-02.mismatch",
  stale: "M-BD-02.stale",
  cancelled: "M-BD-02.cancelled",
  "no-lock": "M-BD-02.noLock",
  invalidated: "M-BD-02.invalidated",
  "locked-out": "M-BD-02.lockedOut",
  error: "M-BD-02.error",
};

export function useSign() {
  const c = useCosign();
  const { api, session, online } = useApp();
  const tr = useT();
  const [flow, dispatch] = useReducer(flowReducer, "idle");
  /** Remounts the slab so it springs back to rest after a failed signature. */
  const [attempt, setAttempt] = useState(0);
  const [key, setKey] = useState<KeyMeta | null>(null);
  const [presence, setPresence] = useState<BiometricClass | null | undefined>(undefined);
  const joined = signPhase(c.status, c.key1, flow);
  // A phone with no screen lock is told before the hold, not after it (`presence` is null once probed).
  const phase = joined === "ready" && presence === null ? "no-lock" : joined;
  const momentTarget = SIGN_MOMENT_PHASE[phase];
  const mm5 = useMoment("MM-5", momentTarget);
  const { set: setMoment, phase: momentPhase } = mm5;

  useEffect(() => {
    let alive = true;
    void keyVault.current().then((m) => alive && setKey(m));
    void keyVault.presence().then((p) => alive && setPresence(p));
    return () => {
      alive = false;
    };
  }, []);

  // Phases follow the flow; `signed-2` alone is started by the signature itself (a real event id). The first phase
  // is announced too, so the judge stage knows the Chair's sheet is open (IC-12 `fs.moment`).
  const announced = useRef(false);
  useEffect(() => {
    if (phase === "signed") return;
    if (momentPhase !== momentTarget || !announced.current) {
      announced.current = true;
      setMoment(momentTarget);
    }
  }, [phase, momentTarget, momentPhase, setMoment]);

  // Back online: a dropped signature is never resent, but the slab may be held again.
  useEffect(() => {
    if (online && flow === "offline") {
      dispatch({ type: "reset" });
      setAttempt((a) => a + 1);
    }
  }, [online, flow]);

  const onHoldState = useCallback((state: HoldState) => dispatch({ type: "hold", state }), []);

  const fail = useCallback(
    (state: CosignFailure) => {
      if (state === "mismatch") {
        feedback.play("seal.mismatch");
        void c.reload();
      }
      if (state === "stale") c.dropPayload();
      dispatch({ type: "result", ok: false, state });
      setAttempt((a) => a + 1);
      announce(tr(FAILURE_COPY[state]));
    },
    [c, tr],
  );

  const commit = useCallback(async () => {
    dispatch({ type: "commit" });
    const dto = c.dto;
    if (!dto) return fail("error");
    const fresh = await c.freshPayload();
    if (!fresh.ok) return fail(fresh.reason);
    const amount = format.usd(dto.totalCents);
    const r = await cosign(fresh.payload, fresh.expected, {
      now: () => new Date(),
      online: () => online,
      sign: (message) =>
        keyVault.sign({
          persona: session?.persona ?? "board:ernesto",
          message,
          prompt: tr("M-BD-02.prompt", { season: dto.seasonCode }),
          detail: tr("M-BD-02.promptDetail", { n: dto.itemCount, amount }),
          cancelLabel: tr("common.cancel"),
          sessionTag: session ? `${session.workspaceId}:${session.pairedAt}` : undefined,
        }),
      isRegistered: (id) => registered.has(id),
      register: async (k) => {
        const res = await api.registerDeviceKey({
          keyId: k.keyId,
          publicKey: k.publicKeyHex,
          kind: keyVault.kind === "demo" ? "web_demo" : "app",
          biometricClass: k.biometricClass,
        });
        if (res.ok) registered.add(k.keyId);
        return res;
      },
      submit: (body) => api.postApproval(c.runSlug, body),
    });
    if (!r.ok) return fail(r.state);
    setKey(r.key);
    dispatch({ type: "result", ok: true });
    mm5.start(r.submission.signature, "signed-2");
    c.markSigned();
    mm5.timers.at(TIMELINE["MM-5"].sealedAfterMs, () => {
      dispatch({ type: "sealed" });
      feedback.play("seal.complete");
    });
    mm5.timers.at(TIMELINE["MM-5"].inkedAfterMs, () => dispatch({ type: "inked" }));
    announce(tr("M-BD-02.signed", { key: r.key.keyId }));
  }, [api, c, fail, mm5, online, session, tr]);

  /** After a fix outside the app (a screen lock set) or a refused batch: back to a slab that can be held. */
  const retry = useCallback(() => {
    dispatch({ type: "reset" });
    setAttempt((a) => a + 1);
    void keyVault.presence().then(setPresence);
  }, []);

  /** Fingerprints changed and the bound key is gone: forget it; the next signature makes and registers a new one. */
  const newKey = useCallback(async () => {
    await keyVault.forget();
    setKey(null);
    retry();
  }, [retry]);

  return { c, phase, flow, mm5, attempt, key, presence, onHoldState, commit, retry, newKey };
}
