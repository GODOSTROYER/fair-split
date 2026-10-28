/**
 * M-BD-02's controller: the slab's hold states drive the pure flow (`sign-flow.ts`); a release inside goes through
 * `commitSignature`, which asks the provider's gate first (is this still the batch the Chair opened?), fetches a
 * fresh payload for that batch, asks the gate again, then the one presence step and the signature, registers a new
 * key, and posts the approval. The accepted signature starts MM-5's phone half (`signed-2`, then `sealed` at +720 ms
 * with the seal's plunk, then `inked` at +960 ms); every failure springs the slab back with nothing signed.
 *
 * The key is the one made under this pairing (`pairingId`): the vault never signs with an earlier pairing's key, and
 * each pairing registers its own. Nothing is signed without a paired session (never under a stand-in persona), and a
 * signature started under one pairing stops, with nothing sent, once the phone is paired again or unpaired.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { format } from "../../_shims/domain";
import {
  type BiometricClass,
  type CosignFailure,
  type CosignResult,
  cosign,
  createKeyRegistry,
  deviceKeyKindOf,
  type KeyMeta,
} from "../../lib/signing";
import { feedback } from "../../platform/feedback";
import { keyVault } from "../../platform/key-vault";
import { pairingId } from "../../services/session";
import { useApp } from "../../state/app";
import { announce } from "../../ui/a11y";
import type { HoldState } from "../../ui/hold";
import { useMoment } from "../../ui/moment";
import { TIMELINE } from "../../ui/motion";
import { useCosign } from "./cosign-context";
import type { BoardKey } from "./messages";
import {
  commitSignature,
  failureCue,
  flowReducer,
  pairingRefusal,
  refusalFailure,
  SIGN_MOMENT_PHASE,
  signPhase,
  slabLive,
} from "./sign-flow";
import { useT } from "./use-t";

/**
 * Keys whose public half this app session has already handed to the server, per pairing (registration is
 * idempotent; a key is never assumed registered under a pairing that did not register it).
 */
const registered = createKeyRegistry();

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
  const { api, session, online, currentSession } = useApp();
  const tr = useT();
  const [flow, dispatch] = useReducer(flowReducer, "idle");
  /** Remounts the slab so it springs back to rest after a failed signature. */
  const [attempt, setAttempt] = useState(0);
  const [key, setKey] = useState<KeyMeta | null>(null);
  /** The key ID the next signature will use when no key is in hand (`fs-ernesto-a2` after a new key). */
  const [upcoming, setUpcoming] = useState<string | null>(null);
  const [presence, setPresence] = useState<BiometricClass | null | undefined>(undefined);
  const persona = session?.persona ?? null;
  const pairing = session ? pairingId(session) : null;
  const joined = signPhase(c.status, c.key1, flow);
  // A phone with no screen lock is told before the hold, not after it (`presence` is null once probed).
  const phase = joined === "ready" && presence === null ? "no-lock" : joined;
  const momentTarget = SIGN_MOMENT_PHASE[phase];
  const mm5 = useMoment("MM-5", momentTarget);
  const { set: setMoment, phase: momentPhase } = mm5;

  const readKey = useCallback(async () => {
    if (!persona || !pairing) return { current: null, next: null };
    const [current, next] = await Promise.all([
      keyVault.current(pairing),
      keyVault.upcomingKeyId(persona, pairing),
    ]);
    return { current, next };
  }, [persona, pairing]);

  useEffect(() => {
    let alive = true;
    void readKey().then((k) => {
      if (!alive) return;
      setKey(k.current);
      setUpcoming(k.next);
    });
    void keyVault.presence().then((p) => alive && setPresence(p));
    return () => {
      alive = false;
    };
  }, [readKey]);

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

  // The request stopped being signable mid-hold or with the dialog open (the batch changed, it expired, it closed):
  // the sheet remounts the slab flush, so the hold the flow remembers ends too, and nothing is armed any more.
  const live = slabLive(phase);
  useEffect(() => {
    if (!live && (flow === "holding" || flow === "armed" || flow === "confirm")) {
      dispatch({ type: "hold", state: "rest" });
    }
  }, [live, flow]);

  const onHoldState = useCallback((state: HoldState) => dispatch({ type: "hold", state }), []);

  const fail = useCallback(
    (state: CosignFailure) => {
      // A refused hash clacks (MM-5 mismatch) and the request is fetched again; nothing was signed.
      const cue = failureCue(state);
      if (cue) feedback.play(cue);
      if (state === "mismatch") void c.reload();
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
    // Signed only under a paired session's own pairing, never under a stand-in persona.
    if (!dto || !persona || !pairing) return fail("error");
    const amount = format.usd(dto.totalCents);
    // The pairing as it is at each step, read from the shell (not this render): paired again, nothing leaves.
    const pairedNow = () => {
      const s = currentSession();
      return s ? pairingId(s) : null;
    };
    let r: CosignResult;
    try {
      r = await commitSignature({
        // I4 at the instant of the release: the gate reads the latest batch, not the one this slab was drawn with,
        // and the pairing the signature started under.
        refusal: () => pairingRefusal(pairing, pairedNow) ?? refusalFailure(c.commitRefusal()),
        payload: c.freshPayload,
        sign: (approval, expected, recheck) =>
          cosign(approval, expected, {
            now: () => new Date(),
            online: () => online,
            recheck,
            sign: (message) =>
              keyVault.sign({
                persona,
                pairing,
                message,
                prompt: tr("M-BD-02.prompt", { season: dto.seasonCode }),
                detail: tr("M-BD-02.promptDetail", { n: dto.itemCount, amount }),
                cancelLabel: tr("common.cancel"),
              }),
            isRegistered: (id) => registered.has(pairing, id),
            register: async (k) => {
              const res = await api.registerDeviceKey({
                keyId: k.keyId,
                publicKey: k.publicKeyHex,
                kind: deviceKeyKindOf(keyVault.kind),
                biometricClass: k.biometricClass,
              });
              if (res.ok) registered.add(pairing, k.keyId);
              return res;
            },
            submit: (body) => api.postApproval(c.runSlug, body),
          }),
      });
    } catch {
      // A key store or a network layer that throws is a failed attempt like any other: nothing was sent.
      return fail("error");
    }
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
  }, [api, c, currentSession, fail, mm5, online, persona, pairing, tr]);

  /** After a fix outside the app (a screen lock set) or a refused batch: back to a slab that can be held. */
  const retry = useCallback(() => {
    dispatch({ type: "reset" });
    setAttempt((a) => a + 1);
    void keyVault.presence().then(setPresence);
  }, []);

  /**
   * Fingerprints changed and the bound key is gone: forget it. The next signature makes the next key
   * (`fs-ernesto-a2`), which is registered as a new key, so the old ID keeps verifying what it signed.
   */
  const newKey = useCallback(async () => {
    await keyVault.forget();
    const k = await readKey();
    setKey(k.current);
    setUpcoming(k.next);
    retry();
  }, [readKey, retry]);

  return { c, phase, flow, mm5, attempt, key, upcoming, presence, onHoldState, commit, retry, newKey };
}
