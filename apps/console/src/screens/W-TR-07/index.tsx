// W-TR-07 Approve (S1.7, design §6 C7): one centred 640 px column with no cards. The seal grown from the batch
// hash, the batch in pencil, why it is safe, and the one d3 jade slab on the console: hold Space (or the
// pointer) for 1.6 s until it clicks and reads "Release to sign", then let go inside, and this browser signs the
// canonical batch with its own key (MM-5, key 1; S2.7: arm on hold, act on release). The Chair's key arrives as
// an `approval.signed` event; the outer rings engrave, the seal lands and the batch turns to ink. The signature
// happens only after the payload the API built is re-checked here: its JCS bytes, its batch hash and its lines
// root must be exactly what the screen shows and recomputed, or nothing is signed (I4). Until the payload has
// loaded the slab is unavailable and says why: a person signs only a batch the seal and the dialog have shown.

import { webRoutes } from "@fairsplit/contracts";
import { TIMING } from "@fairsplit/motion";
import { AmountDisplay, Glyph, type HoldChange, InkStamp, Print, RailBar, Slab } from "@fairsplit/ui-web";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { PrintBed } from "../../chrome/PrintBed.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { isApiClientError } from "../../data/errors.js";
import { useAdapter, useCommand, useCommandQuery, useJudgeSession } from "../../data/hooks.js";
import { queryKeys } from "../../data/query.js";
import { blockingHolds, livePresence, type RunView } from "../../data/run-view.js";
import { utf8 } from "../../features/approve/jcs.js";
import {
  type BrowserKey,
  registerDemoKey,
  type SigningKey,
  sessionKey,
} from "../../features/approve/keys.js";
import {
  approveState,
  batchAmountState,
  batchFacts,
  batchHashOf,
  blockingReasons,
  canSign,
  chairRule,
  feeFacts,
  holdNumber,
  isPosted,
  isUnanswered,
  keyKind,
  type LocalApproval,
  linesDigest,
  liveApprovals,
  NO_LOCAL,
  type PaypalRetry,
  payloadMatches,
  paypalRetryOf,
  RESEND_WAIT_MS,
  restingPhase,
  SEND_ATTEMPTS,
  type ShownBatch,
  safeFacts,
  sealKeys,
  senderBatchIdFor,
  signedLinesDigest,
} from "../../features/approve/model.js";
import { BatchLedger, ConfirmBody, CosignCard, KeySlot, SealBlock } from "../../features/approve/parts.js";
import { APPROVE, en } from "../../features/split/shared/copy.js";
import { officer, stampFor } from "../../features/split/shared/people.js";
import { useLiveEvents, useRunData } from "../../features/split/shared/run-data.js";
import { useMomentScript, usePhaseSync } from "../../features/split/shared/script.js";
import { format } from "../../lib/format.js";
import { useMoment } from "../../lib/moment.js";
import { provenanceFooter } from "../../lib/provenance.js";
import type { ScreenState } from "../../lib/screens.js";
import { useOptionalStage, usePrefocus } from "../../stage/context.js";
import type { RunScreenProps } from "../contract.js";
import "../../features/split/shared/runs.css";
import "../../features/approve/approve.css";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function Screen({ runSlug }: RunScreenProps) {
  const data = useRunData(runSlug);
  const { snapshot, view } = data;
  const router = useRouter();
  const stage = useOptionalStage();
  const adapter = useAdapter();
  const client = useQueryClient();
  const { session } = useJudgeSession();
  const [local, setLocal] = useState<LocalApproval>(NO_LOCAL);
  const [signing, setSigning] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [holding, setHolding] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [slabKey, setSlabKey] = useState(0);
  const [key, setKey] = useState<SigningKey | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const holdingRef = useRef(false);
  const changes = useRef(0);
  const slabRef = useRef<HTMLDivElement>(null);

  // The run's own state decides whether this browser may ask for the batch to sign at all.
  const paypalRetry: PaypalRetry | null = view ? paypalRetryOf(view) : null;
  const baseState = view ? approveState(view, local, paypalRetry) : null;
  const payloadQuery = useCommandQuery(
    "approvalPayload",
    { params: { runSlug }, query: { role: "treasurer" } },
    {
      enabled: data.live && baseState !== null && canSign(baseState),
      staleTime: 5 * 60_000,
      retry: false,
    },
  );
  const payload = payloadQuery.data?.payload ?? null;
  // The payload carries the lines root both keys sign (IC-02); it must be the one this browser recomputes from the
  // lines on screen, or the screen reads mismatch and nothing signs.
  const digest = useMemo(() => (snapshot && view ? linesDigest(snapshot, view) : null), [snapshot, view]);
  const payloadLines = signedLinesDigest(payload);
  const linesDisagree = payloadLines !== null && payloadLines !== digest;
  const state =
    view && linesDisagree ? approveState(view, { ...local, mismatch: true }, paypalRetry) : baseState;
  const signable = state !== null && canSign(state);
  // A signature needs the batch the seal and the dialog show: until the payload is here, nothing can be held.
  const armed = signable && payload !== null;

  const moment = useMoment("MM-5", { focal: true });
  const script = useMomentScript(moment);
  const live = useLiveEvents(data.live ? runSlug : null, (event) => {
    if (event.type === "approval.signed") {
      script.run(
        event.payload.role === "treasurer" ? "signed-1" : "signed-2",
        { eventId: event.id, kind: "signature" },
        { focal: true },
      );
    } else if (event.type === "approval.declined") {
      script.run("declined", { eventId: event.id, kind: "sse" });
    } else if (event.type === "hold.resolved") {
      // The last hold that blocks approval: the slab rises (MM-5 "rise"). A hold that only reserves its line
      // (H3) never blocked anything, so deciding it raises nothing.
      const after = client.getQueryData<RunView>(queryKeys.run(runSlug));
      const unblocking = after?.holds[event.payload.holdId]?.gate === "BLOCKS_APPROVAL";
      if (
        after &&
        unblocking &&
        (after.state === "IN_REVIEW" || after.state === "COMPUTED") &&
        blockingHolds(after).length === 0
      ) {
        script.run("rise", { eventId: event.id, kind: "sse" });
      }
    }
  });

  // A signature in flight owns the phase until its event lands; otherwise the phase rests where the state is.
  useEffect(() => {
    if (submitted && view && (liveApprovals(view).treasurer || !signable)) setSubmitted(false);
  }, [submitted, view, signable]);

  // A send that failed while its first copy was still landing: once the treasurer's signature arrives, the
  // failure is stale, so its notice goes.
  const treasurerSigned = view ? liveApprovals(view).treasurer !== null : false;
  useEffect(() => {
    if (treasurerSigned) setFailure(null);
  }, [treasurerSigned]);

  // A decline voids the signatures: the slab that went flush for key 1 stands up again, ready to sign anew.
  const signedKeys = view ? sealKeys(view) : 0;
  const keysBefore = useRef(signedKeys);
  useEffect(() => {
    if (signedKeys < keysBefore.current) setSlabKey((k) => k + 1);
    keysBefore.current = signedKeys;
  }, [signedKeys]);
  const resting = state ? restingPhase(state) : null;
  usePhaseSync(moment, holding || signing || submitted ? null : resting, script.busy);

  // Presence lasts 25 s (S3.7): re-read it when the label would expire.
  const presence = view
    ? livePresence(view, now).find((p) => /ernesto|chair|board/.test(p.persona))
    : undefined;
  useEffect(() => {
    if (!presence) return;
    const left = Date.parse(presence.expiresAt) - Date.now();
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, left) + 50);
    return () => clearTimeout(timer);
  }, [presence]);

  usePrefocus(slabRef, "W-TR-07", armed && !signing);

  // Key 1 is the judge session's demo key (C-13): made in this browser and registered for the session's workspace
  // as the treasurer, so its ID is fs-api's `fs-analyn-demo-{6}`, never the treasurer's own `fs-analyn-w1`.
  const treasurer = snapshot?.officers.find((o) => o.role === "TREASURER");
  const approverId = treasurer?.persona ?? "treasurer:analyn";
  const workspaceId = session?.workspaceId ?? null;
  const keyScope = `${session?.sessionId ?? runSlug}:${approverId}`;
  const register = useCallback(
    (made: BrowserKey) => {
      if (!workspaceId) return Promise.reject(new Error("A demo key needs a judge session."));
      return registerDemoKey(adapter.api, made, { workspaceId, approverId });
    },
    [adapter, workspaceId, approverId],
  );

  // Make and register the key before the hold ends, so a signature never waits on either. A failure here is
  // said on the press, when the same step runs again.
  useEffect(() => {
    if (!data.live || !signable || !workspaceId) return;
    let alive = true;
    sessionKey(keyScope, register).then(
      (k) => {
        if (alive) setKey(k);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [data.live, signable, workspaceId, keyScope, register]);

  const batch = useMemo(
    () => (snapshot && view ? batchFacts(snapshot, view, payload) : null),
    [snapshot, view, payload],
  );
  const batchSha256 = view ? batchHashOf(view, payload) : null;
  const submit = useCommand("submitApproval");

  const approve = useCallback(async () => {
    if (!view || !snapshot) return;
    holdingRef.current = false;
    setHolding(false);
    const shown: ShownBatch = { batchSha256: batchHashOf(view, payload), linesDigest: digest };
    if (payload === null || shown.batchSha256 === null) {
      // I4: no batch was on screen to sign (its payload had not loaded), so nothing is signed. Re-arm the slab.
      setSlabKey((k) => k + 1);
      return;
    }
    setSigning(true);
    setFailure(null);
    try {
      // A fresh payload (a new nonce, 30 minutes to live), checked against the batch on screen before signing.
      const fresh = await adapter.call("approvalPayload", {
        params: { runSlug },
        query: { role: "treasurer" },
      });
      if (!payloadMatches(fresh.payload, fresh.jcs, shown)) {
        setLocal({ ...NO_LOCAL, mismatch: true });
        script.run("mismatch", { eventId: `mismatch:${fresh.payload.nonce}`, kind: "http" });
        return;
      }
      const signer = await sessionKey(keyScope, register);
      setKey(signer);
      const signature = await signer.sign(utf8(fresh.jcs));
      // One signed approval, one key: a send the server never answered goes again under the same key, so the
      // API applies it once however many sends arrive. A definitive answer (a 4xx, a 501) is shown at once.
      const idempotencyKey = `approval-${fresh.payload.nonce}`;
      for (let send = 1; ; send++) {
        try {
          await submit.mutateAsync({
            params: { runSlug },
            body: { role: "treasurer", keyId: signer.keyId, signature, payload: fresh.payload },
            idempotencyKey,
          });
          setLocal(NO_LOCAL);
          setSubmitted(true);
          return;
        } catch (error) {
          if (send >= SEND_ATTEMPTS || !isUnanswered(error)) throw error;
          setLocal({ ...NO_LOCAL, resending: send + 1 });
          await wait(RESEND_WAIT_MS[Math.min(send - 1, RESEND_WAIT_MS.length - 1)] ?? 0);
        }
      }
    } catch (error) {
      if (isApiClientError(error, "DIGEST_MISMATCH")) {
        setLocal({ ...NO_LOCAL, mismatch: true });
        script.run("mismatch", { eventId: `mismatch:${error.requestId ?? Date.now()}`, kind: "http" });
      } else if (isApiClientError(error, "APPROVAL_EXPIRED")) {
        setLocal({ ...NO_LOCAL, expired: true });
        script.run("expired", { eventId: `expired:${error.requestId ?? Date.now()}`, kind: "http" });
      } else {
        setLocal(NO_LOCAL);
        setFailure(error);
      }
      setSlabKey((k) => k + 1);
    } finally {
      setSigning(false);
    }
  }, [adapter, digest, keyScope, payload, register, runSlug, script, snapshot, submit, view]);

  const refetchPayload = payloadQuery.refetch;
  const reload = useCallback(() => {
    setLocal(NO_LOCAL);
    setFailure(null);
    setSlabKey((k) => k + 1);
    void refetchPayload();
  }, [refetchPayload]);
  const reloadPayload = useCallback(() => void refetchPayload(), [refetchPayload]);

  // The hold is the slab's (ui-web, S2.7: arm on hold, act on release inside), and it reports each change; the
  // screen writes MM-5's phases from them. hold-1 as the hold starts, armed-1 at 1,600 ms ("Release to sign",
  // nothing signed yet), released-early or disarmed when it ends without a release inside, confirm-1 when Enter,
  // a screen reader or the link opens the dialog. The release (or the dialog's Sign) commits: `approve`.
  const onHoldChange = useCallback(
    (change: HoldChange) => {
      const press = () => ({ eventId: `${change}-${++changes.current}`, kind: "press" as const });
      switch (change) {
        case "holding":
          if (!armed || signing) return;
          holdingRef.current = true;
          setHolding(true);
          script.cancel();
          moment.enter("hold-1");
          return;
        case "armed":
          if (holdingRef.current) moment.enter("armed-1");
          return;
        case "released-early":
        case "disarmed":
          if (!holdingRef.current) return;
          holdingRef.current = false;
          setHolding(false);
          script.run(change === "disarmed" ? "disarm-1" : "released-early", press());
          return;
        case "dialog":
          // The dialog route stands in for the hold: the phase stays confirm-1 until it signs or closes.
          holdingRef.current = true;
          setHolding(true);
          script.cancel();
          script.run("confirm-1", press());
          return;
        case "dismissed":
          holdingRef.current = false;
          setHolding(false);
          return;
      }
    },
    [armed, moment, script, signing],
  );

  const pairing = useCommand("createPairing");

  const title = (
    <header className="fsr-screen__head">
      <h1 id="W-TR-07-title" className="fs-t-title-1">
        {en("W-TR-07.title")}
      </h1>
      <p className="fsr-screen__slug fs-t-hash">{runSlug}</p>
    </header>
  );

  if (data.error && !view) {
    return (
      <ScreenRoot
        id="W-TR-07"
        state="error"
        className="fsr-screen fsr-approve-screen"
        labelledBy="W-TR-07-title"
      >
        {title}
        <CommandNotice error={data.error} testId="W-TR-07.error" onRetry={data.retry} />
      </ScreenRoot>
    );
  }
  if (!snapshot || !view || !state || !batch) {
    return (
      <ScreenRoot
        id="W-TR-07"
        state="loading"
        className="fsr-screen fsr-approve-screen"
        labelledBy="W-TR-07-title"
      >
        {title}
        <div className="fsr-approve fsr-approve--beds" aria-hidden data-testid="W-TR-07.loading">
          <PrintBed shape="seal" width={200} height={200} />
          <PrintBed shape="block" width={320} height={72} />
          <PrintBed shape="line" count={3} />
          <PrintBed shape="slab" width={560} height={64} />
        </div>
        <p className="fs-sr" role="status">
          {APPROVE.loading}
        </p>
      </ScreenRoot>
    );
  }

  const keys = sealKeys(view);
  const signedApprovals = liveApprovals(view);
  const treasurerApproval = signedApprovals.treasurer;
  const chairApproval = signedApprovals.chair;
  const engrave =
    live.isLive(chairApproval?.eventId ?? null) || live.isLive(treasurerApproval?.eventId ?? null);
  const amountState = batchAmountState(view);
  const total = batch.totalCents;
  const amount = { display: format.money(total), spoken: format.amountSpoken(total, "en") };
  const label = en("W-TR-07.approve", { count: batch.itemCount });
  const cashDay = format.dateShort(snapshot.run.cashDay);
  const fees = feeFacts(snapshot);
  const safe = safeFacts(snapshot, view);
  const chair = chairRule(snapshot, total);
  const reasons = blockingReasons(snapshot, view);
  const firstReason = reasons[0];
  const signedNow = keys > 0;
  const rows = batch.recipients.map((r) => ({ ...r, amount: format.money(r.cents) }));
  const batchId = senderBatchIdFor(snapshot, view.runSlug);

  // A payload that failed to load says so once, beside the slab; one that is still loading only disarms it.
  const payloadError = signable && payload === null ? payloadQuery.error : null;

  let unavailable: string | undefined;
  let onReason: (() => void) | undefined;
  if (state === "blocked") {
    unavailable = reasons.length > 0 ? APPROVE.blockedHolds(reasons.length) : APPROVE.blockedReading;
    if (firstReason) onReason = () => router.history.push(firstReason.href);
  } else if (state === "mismatch" || state === "expired") {
    unavailable = state === "mismatch" ? APPROVE.mismatchAction : APPROVE.expiredAction;
    onReason = reload;
  } else if (signable && payload === null) {
    unavailable = payloadError ? APPROVE.payloadFailed : APPROVE.payloadLoading;
    if (payloadError) onReason = reloadPayload;
  }

  // The key's kind comes from its ID's shape (C-13): a judge's demo key never reads as an officer's own key.
  const keyLabelOf = (id: string, holder: "treasurer" | "chair") => {
    switch (keyKind(id)) {
      case "seeded":
        return APPROVE.keySeeded;
      case "demo":
        return holder === "treasurer" ? en("W-TR-07.key.demo") : APPROVE.keyDemoChair;
      case "web":
        return APPROVE.keyBrowser;
      default:
        return APPROVE.keyDevice;
    }
  };
  const treasurerKeyId = treasurerApproval?.keyId ?? key?.keyId ?? null;
  // Until fs-api has registered this browser's key the slot names the kind of key that will sign, not an ID.
  const treasurerKeyLine = treasurerKeyId
    ? APPROVE.keyLine(treasurerKeyId, keyLabelOf(treasurerKeyId, "treasurer"))
    : en("W-TR-07.key.demo");
  const treasurerNote =
    !treasurerApproval || keyKind(treasurerApproval.keyId) === "demo"
      ? key?.kind === "webcrypto"
        ? APPROVE.keyWebCrypto
        : key?.kind === "demo"
          ? APPROVE.keyNoble
          : undefined
      : undefined;
  const treasurerStamp = treasurerApproval
    ? stampFor(snapshot, "treasurer:analyn", treasurerApproval.at)
    : null;
  const chairStamp = chairApproval ? stampFor(snapshot, "board:ernesto", chairApproval.at) : null;

  const presenceText = presence
    ? presence.holdId
      ? APPROVE.presence(holdNumber(view.holds[presence.holdId]?.label ?? presence.holdId))
      : APPROVE.presenceApproval
    : APPROVE.waitingChair;

  const screenState: ScreenState<"W-TR-07"> = state;
  const inJudgeMode = data.live && stage !== null;

  return (
    <ScreenRoot
      id="W-TR-07"
      state={screenState}
      className="fsr-screen fsr-approve-screen"
      labelledBy="W-TR-07-title"
    >
      {title}
      <section
        {...moment.rootProps}
        className="fsr-approve"
        data-motion={moment.mode}
        data-keys={keys}
        aria-label={label}
        data-testid="W-TR-07.column"
      >
        <StatusBanner
          state={state}
          declined={
            view.approvals.declined
              ? {
                  reason: view.approvals.declined.reason,
                  by: officer(snapshot, view.approvals.declined.by) ?? officer(snapshot, "board:ernesto"),
                  stamp: stampFor(snapshot, view.approvals.declined.by, view.lastEventAt),
                }
              : null
          }
          paypalRetry={paypalRetry}
          onReload={reload}
        />
        {local.resending !== null && (
          <p className="fsr-banner" role="status" data-testid="W-TR-07.resending">
            <Glyph name="ms:restart-alt" size={18} />
            {APPROVE.resending(local.resending, SEND_ATTEMPTS)}
          </p>
        )}

        <SealBlock batchSha256={batchSha256} keys={keys} engrave={engrave} />

        <div
          className="fsr-approve__amount"
          data-amount-state={amountState}
          data-animate={script.busy ? "" : undefined}
        >
          <AmountDisplay
            amount={amount}
            pencil={amountState === "pencil"}
            hollow={amountState === "hollow"}
            testId="W-TR-07.amount"
          />
          <p className="fsr-approve__amount-note fs-t-caption">
            {provenanceFooter({ kind: "engine", rateCardSha256: snapshot.rateCard.sha256 })}
          </p>
        </div>

        <figure className="fsr-approve__rails">
          <RailBar
            paypalShare={batch.netCents > 0 ? total / batch.netCents : 0}
            paypalText={en("W-TR-07.payouts", { count: batch.itemCount })}
            cashText={en("W-TR-07.cash", {
              count: batch.cashCount,
              amount: format.money(batch.cashCents),
              date: cashDay,
            })}
            cashWord={en("cash.word")}
            testId="W-TR-07.rail"
          />
          <figcaption className="fsr-approve__fees fs-t-caption" data-testid="W-TR-07.fees">
            {en("W-TR-07.fees", { ...fees })} <span className="fsr-muted">{APPROVE.feesLabel}.</span>
          </figcaption>
        </figure>

        {batch.final ? (
          <Print
            value={en("W-TR-07.safe", {
              holds: safe.holds,
              byHand: safe.byHand,
              shrink: safe.shrink,
              limit: safe.limit,
              explained: safe.explained,
              lines: safe.lines,
              date: safe.date,
            })}
            provenance="engine"
            state={amountState === "pencil" ? "pencil" : "ink"}
            typeRole="body"
            as="p"
            className="fsr-approve__safe"
            testId="W-TR-07.safe"
          />
        ) : (
          <BlockedList reasons={reasons} />
        )}

        <div ref={slabRef} className="fsr-approve__slab">
          <Slab
            key={slabKey}
            label={label}
            srLabel={APPROVE.srApprove(label, amount.spoken)}
            depth="d3"
            tone="jade"
            hold={TIMING.holdConsole}
            size="l"
            width={560}
            glyph="seal"
            confirm={{
              title: APPROVE.confirmTitle(batch.itemCount),
              body: (
                <ConfirmBody
                  amount={amount.display}
                  count={batch.itemCount}
                  recipients={rows}
                  batchSha256={batchSha256}
                />
              ),
            }}
            {...(unavailable !== undefined ? { unavailableReason: unavailable } : {})}
            {...(onReason ? { onReasonClick: onReason } : {})}
            bolted={state === "killed"}
            {...(signedNow ? { frame: { state: "committed" as const, travel: 8, fill: 1 } } : {})}
            hint={!signedNow}
            testId="W-TR-07.approve"
            onHoldChange={onHoldChange}
            onCommit={approve}
          />
          {state === "killed" && (
            <p className="fsr-approve__killed fs-t-label" data-testid="W-TR-07.killed">
              <Glyph name="bolt" size={16} />
              {APPROVE.killed}
            </p>
          )}
        </div>

        {payloadError && (
          <CommandNotice
            error={payloadError}
            testId="W-TR-07.payload.error"
            onRetry={reloadPayload}
            retryLabel={APPROVE.payloadRetry}
          />
        )}
        {failure !== null && <CommandNotice error={failure} testId="W-TR-07.error" onRetry={reload} />}

        <ul className="fsr-keys" aria-label="Keys" data-testid="W-TR-07.keys">
          <KeySlot
            name={en("W-TR-07.key.treasurer")}
            keyLine={treasurerKeyLine}
            {...(treasurerNote ? { keyNote: treasurerNote } : {})}
            status={
              treasurerApproval && treasurerStamp
                ? en("W-TR-07.key.signed", { time: treasurerStamp.at })
                : signing
                  ? APPROVE.signing
                  : APPROVE.waitingKey
            }
            signed={treasurerApproval !== null}
            stamp={treasurerStamp}
            testId="W-TR-07.key.treasurer"
          />
          {chair.required && (
            <KeySlot
              name={en("W-TR-07.key.chair")}
              why={APPROVE.chairWhy(chair.threshold)}
              {...(chairApproval
                ? {
                    keyLine: APPROVE.keyLine(chairApproval.keyId, keyLabelOf(chairApproval.keyId, "chair")),
                  }
                : {})}
              status={
                chairApproval && chairStamp
                  ? en("W-TR-07.key.signed", { time: chairStamp.at })
                  : treasurerApproval
                    ? APPROVE.waitingChair
                    : APPROVE.waitingKey
              }
              signed={chairApproval !== null}
              stamp={chairStamp}
              testId="W-TR-07.key.chair"
            />
          )}
        </ul>

        {state === "key1" && (
          <p
            className="fsr-presence fs-t-label"
            data-in={moment.phase === "waiting-2" ? "" : undefined}
            data-testid="W-TR-07.presence"
          >
            <Glyph name="ms:visibility" size={18} />
            {presenceText}
          </p>
        )}

        {(state === "approved" || state === "posting" || state === "retrying") && (
          <div className="fsr-approve__done" data-testid="W-TR-07.approved">
            <p className="fs-t-title-2">{APPROVE.approved}</p>
            {state === "posting" && (
              <Print
                value={APPROVE.posting(batchId)}
                provenance="engine"
                state="pencil"
                typeRole="body"
                as="p"
                testId="W-TR-07.posting"
              />
            )}
            {isPosted(view) && <p className="fs-t-body fsr-approve__posted">{APPROVE.posted}</p>}
            {(isPosted(view) || state === "posting" || state === "retrying") && (
              <AppLink
                href={webRoutes.fanout(view.runSlug)}
                className="fs-link fs-t-label"
                data-testid="W-TR-07.fanout"
              >
                {APPROVE.postedLink}
              </AppLink>
            )}
          </div>
        )}

        {inJudgeMode && (state === "key1" || state === "ready" || state === "declined") && chair.required && (
          <CosignCard
            code={pairing.data ?? null}
            busy={pairing.isPending}
            onMake={() => pairing.mutate({ body: { persona: "ernesto", role: "board" } })}
            {...(stage ? { onChairFrame: () => stage.raisePhone("chair") } : {})}
            error={
              pairing.error ? <CommandNotice error={pairing.error} testId="W-TR-07.cosign.error" /> : null
            }
          />
        )}

        <section className="fsr-approve__ledger" aria-labelledby="W-TR-07-ledger">
          <h2 id="W-TR-07-ledger" className="fs-t-label">
            {APPROVE.ledgerTitle}
          </h2>
          <p className="fs-t-caption fsr-muted">{APPROVE.ledgerNote}</p>
          <BatchLedger
            senderBatchId={batchId}
            batchSha256={batchSha256}
            signedLinesDigest={linesDisagree ? null : payloadLines}
            lines={batch.lines}
            cashLines={batch.cashCount}
            rateCardSha256={snapshot.rateCard.sha256}
          />
        </section>
      </section>
    </ScreenRoot>
  );
}

function BlockedList({
  reasons,
}: {
  readonly reasons: readonly {
    readonly hold: { readonly label: string; readonly kind: string; readonly holdId: string };
    readonly href: string;
  }[];
}) {
  if (reasons.length === 0) {
    return (
      <p className="fsr-approve__blocked fs-t-body" data-testid="W-TR-07.blockedList">
        {APPROVE.blockedReading}
      </p>
    );
  }
  return (
    <div className="fsr-approve__blocked" data-testid="W-TR-07.blockedList">
      <p className="fs-t-caption">{APPROVE.blockedWaiting}</p>
      <ul>
        {reasons.map((r) => {
          const kind = en(`hold.kind.${r.hold.kind as "DUPLICATE_SLIP"}`);
          // A label that is its kind's own word ("Mass balance") is said once (as the ribbon does).
          const sameWord = kind.toLowerCase() === r.hold.label.toLowerCase();
          return (
            <li key={r.hold.holdId}>
              <span className="fsr-approve__blocked-mark" aria-hidden />
              <AppLink href={r.href} className="fs-link fs-t-label">
                {r.hold.label}
              </AppLink>
              {!sameWord && <span className="fs-t-caption fsr-muted">{kind}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface StatusBannerProps {
  readonly state: ReturnType<typeof approveState>;
  readonly declined: {
    readonly reason: string;
    readonly by: ReturnType<typeof officer>;
    readonly stamp: ReturnType<typeof stampFor>;
  } | null;
  readonly paypalRetry: PaypalRetry | null;
  readonly onReload: () => void;
}

/** The one sentence a state must say first. Red only when PayPal is the actor; a decline is the Chair's ink. */
function StatusBanner({ state, declined, paypalRetry, onReload }: StatusBannerProps) {
  switch (state) {
    case "denied":
      return (
        <p className="fsr-banner" data-tone="red" role="alert" data-testid="W-TR-07.denied">
          <Glyph name="rail" size={18} />
          {APPROVE.denied}
        </p>
      );
    case "declined":
      return (
        <div className="fsr-banner fsr-banner--ink" role="status" data-testid="W-TR-07.declined">
          {declined?.stamp && <InkStamp stamp={declined.stamp} />}
          <p className="fsr-banner__text">
            <span className="fs-t-label">{APPROVE.declined(declined?.by?.shortName ?? "The Chair")}: </span>
            <span className="fsr-banner__quote">{declined?.reason}</span>
            <span className="fs-t-caption fsr-muted"> {APPROVE.declinedNext}</span>
          </p>
        </div>
      );
    case "mismatch":
      return (
        <p className="fsr-banner" data-tone="canary" role="alert" data-testid="W-TR-07.mismatch">
          <Glyph name="seal" size={18} />
          {APPROVE.mismatch}{" "}
          <button type="button" className="fs-link fs-t-label" onClick={onReload}>
            {APPROVE.mismatchAction}
          </button>
        </p>
      );
    case "expired":
      return (
        <p className="fsr-banner" role="status" data-testid="W-TR-07.expired">
          <Glyph name="ms:schedule" size={18} />
          {APPROVE.expired}{" "}
          <button type="button" className="fs-link fs-t-label" onClick={onReload}>
            {APPROVE.expiredAction}
          </button>
        </p>
      );
    case "retrying":
      // PayPal's Payouts POST, retried by the server under the same request ID (S1.7): PayPal is the actor, but
      // nothing failed yet, so it stays ink.
      return paypalRetry ? (
        <p className="fsr-banner" role="status" data-testid="W-TR-07.retrying">
          <Glyph name="ms:restart-alt" size={18} />
          {APPROVE.paypalRetrying(paypalRetry.attempt, paypalRetry.of)}
        </p>
      ) : null;
    default:
      return null;
  }
}
