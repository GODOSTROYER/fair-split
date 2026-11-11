// W-TR-07 Approve (S1.7, design §6 C7; UI gate rounds 4 and 5): the one 12-column grid, top-aligned 32 px under the
// title row ("Approve 2026-A", the keys signed as its one chip, the run id and the screen's one provenance phrase).
// Columns 1–7 hold one tight composition: the seal grown from the batch hash (180 px, 220 from a 1,600 px
// window), and beside it "PayPal batch · 8 payouts" with its one micro-tag, the amount, and the two named signers
// ("Two officers sign this batch", each with one line in words, never a key id); then the money bar, at 1,920 the
// eight PayPal recipients under it (round 5: no dead band), and the fees and every id behind "IDs". Columns 8–12 hold
// the decision in one card that hugs its content: four checks, then one way to sign while no key has signed (the slab,
// hugging its label, with its caption and its one link to the other way under it), and only after key 1 the Chair's
// co-sign block. Ernesto's row says his state once ("Waiting", or "Reviewing" while he is on the batch). Hold Space
// (or the pointer) for 1.6 s until it clicks and reads "Release to sign",
// then let go inside, and this browser signs the canonical batch with its own key (MM-5, key 1; S2.7: arm on hold,
// act on release). The Chair's key arrives as
// an `approval.signed` event; the outer rings engrave, the seal lands and the batch turns to ink. The signature
// happens only after the payload the API built is re-checked here: its JCS bytes, its batch hash and its lines
// root must be exactly what the screen shows and recomputed, or nothing is signed (I4). The amounts and the lines
// root come from the run's own lines, read with the payload (never the seed's: a judge workspace's line hashes
// cover its own mark IDs). Until both have loaded the slab is unavailable and says why: a person signs only a
// batch the seal and the dialog have shown.

import { webRoutes } from "@fairsplit/contracts";
import { TIMING } from "@fairsplit/motion";
import {
  AmountDisplay,
  Chip,
  type ChipTone,
  Glyph,
  type GlyphName,
  type HoldChange,
  MicroTag,
  Slab,
  StateDot,
} from "@fairsplit/ui-web";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { PROVENANCE, railTag } from "../../chrome/copy.js";
import { RunRouteGate } from "../../chrome/Fallbacks.js";
import { PrintBed } from "../../chrome/PrintBed.js";
import { Cell, ScreenHead } from "../../chrome/ScreenGrid.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { Stamp } from "../../chrome/Stamp.js";
import { isApiClientError } from "../../data/errors.js";
import { useAdapter, useCommand, useJudgeSession, usePaypalRail } from "../../data/hooks.js";
import { payoutReplayed } from "../../data/payout-replay.js";
import { queryKeys } from "../../data/query.js";
import { blockingHolds, livePresence, type RunView } from "../../data/run-view.js";
import { readBatchToSign } from "../../features/approve/batch-read.js";
import {
  type BrowserKey,
  registerDemoKey,
  type SigningKey,
  sessionKey,
} from "../../features/approve/keys.js";
import { MoneyBar } from "../../features/approve/MoneyBar.js";
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
  linesVersion,
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
  voidedByChange,
} from "../../features/approve/model.js";
import {
  BatchLedger,
  CheckList,
  type CheckRow,
  ConfirmBody,
  CosignCard,
  KeySlot,
  type LedgerKey,
  type PayeeRow,
  Payees,
  SealBlock,
  Signers,
  useSealSize,
} from "../../features/approve/parts.js";
import { APPROVE, en } from "../../features/split/shared/copy.js";
import { officer, stampFor } from "../../features/split/shared/people.js";
import { cashDayForRun, useLiveEvents, useRunData } from "../../features/split/shared/run-data.js";
import { useMomentScript, usePhaseSync } from "../../features/split/shared/script.js";
import { runLabel } from "../../lib/display.js";
import { focusIsLost, registerScreenControl } from "../../lib/focus.js";
import { format } from "../../lib/format.js";
import { utf8 } from "../../lib/jcs.js";
import { useMoment } from "../../lib/moment.js";
import { chairCaption, ruleTitle } from "../../lib/plain.js";
import { provenanceFooter } from "../../lib/provenance.js";
import type { ScreenState } from "../../lib/screens.js";
import { useNextStep, useOptionalStage, usePrefocus } from "../../stage/context.js";
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
  const rail = usePaypalRail() ?? "simulator";
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
  const sealRef = useRef<HTMLDivElement>(null);

  // The run's own state decides whether this browser may ask for the batch to sign at all.
  const paypalRetry: PaypalRetry | null = view ? paypalRetryOf(view) : null;
  const baseState = view ? approveState(view, local, paypalRetry) : null;
  // The payload and the run's own lines, read together, and again whenever a decision changes the lines. The last
  // pair stays on screen while the next one loads (and once signing has begun), but only a fresh pair arms.
  const version = view ? linesVersion(view) : null;
  const batchQuery = useQuery({
    queryKey: ["approve-batch", runSlug, version] as const,
    queryFn: ({ signal }) => readBatchToSign(adapter, runSlug, signal),
    enabled: data.live && baseState !== null && canSign(baseState),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const payload = batchQuery.data?.payload ?? null;
  const served = batchQuery.data?.lines ?? null;
  // The payload carries the lines root both keys sign (IC-02); it must be the one this browser recomputes from the
  // lines on screen, or the screen reads mismatch and nothing signs.
  const digest = useMemo(() => linesDigest(served), [served]);
  const payloadLines = signedLinesDigest(payload);
  const linesDisagree = payloadLines !== null && payloadLines !== digest;
  const state =
    view && linesDisagree ? approveState(view, { ...local, mismatch: true }, paypalRetry) : baseState;
  const signable = state !== null && canSign(state);
  // A signature needs the batch the seal and the dialog show: until the payload and the lines are here (and are
  // the current ones), nothing can be held.
  const armed = signable && payload !== null && digest !== null && !batchQuery.isPlaceholderData;

  const moment = useMoment("MM-5", { focal: true });
  const script = useMomentScript(moment);
  const live = useLiveEvents(data.live ? runSlug : null, (event) => {
    if (event.type === "approval.signed") {
      sealRef.current?.scrollIntoView({
        block: "nearest",
        behavior: moment.mode === "reduced" ? "instant" : "smooth",
      });
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
  // The slab goes once a key signs (round 3: no status box, "Waiting" lives in Ernesto's row). Focus that went with
  // it moves on to the step's next control in the same commit, without scrolling: the seal stays the thing in view.
  // Only when a key just landed and focus was lost; a control the person chose keeps it.
  const focusKeys = useRef(signedKeys);
  useLayoutEffect(() => {
    const before = focusKeys.current;
    focusKeys.current = signedKeys;
    if (signedKeys <= before || !focusIsLost()) return;
    const next =
      document.querySelector<HTMLElement>(
        signedKeys === 1 ? '[data-testid="W-JG-01.runPill.next"]' : '[data-testid="W-TR-07.fanout"]',
      ) ?? sealRef.current?.querySelector<HTMLElement>('[data-testid="W-TR-07.sealBlock"]');
    next?.focus({ preventScroll: true });
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
  // Once both keys are in and the story has moved on, the completed seal is this screen's main control: a focus
  // that returns here (the Chair's phone lowering after key 2) lands on the seal and reveals it, not a control below.
  const stepHere = useNextStep()?.screen === "W-TR-07";
  useEffect(() => {
    if (signedKeys !== 2 || stepHere) return;
    return registerScreenControl(
      () => sealRef.current?.querySelector<HTMLElement>('[data-testid="W-TR-07.sealBlock"]') ?? null,
    );
  }, [signedKeys, stepHere]);

  // Key 1 is the judge session's demo key (C-13): made in this browser and registered for the session's workspace
  // as the treasurer, so its ID is fs-api's `fs-analyn-demo-{6}`, never the treasurer's own `fs-analyn-w1`.
  const treasurer = snapshot?.officers.find((o) => o.role === "TREASURER");
  const approverId = treasurer?.persona ?? "treasurer:analyn";
  const workspaceId = session?.workspaceId ?? null;
  const keyScope = `${workspaceId ?? runSlug}:${approverId}`;
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
    () => (snapshot && view ? batchFacts(snapshot, view, payload, served) : null),
    [snapshot, view, payload, served],
  );
  const batchSha256 = view ? batchHashOf(view, payload) : null;
  const submit = useCommand("submitApproval");

  const approve = useCallback(async () => {
    if (!view || !snapshot) return;
    holdingRef.current = false;
    setHolding(false);
    const shown: ShownBatch = { batchSha256: batchHashOf(view, payload), linesDigest: digest };
    if (payload === null || shown.batchSha256 === null || shown.linesDigest === null) {
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

  const refetchPayload = batchQuery.refetch;
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
  const sealSize = useSealSize();

  // The title row (round 5): "Approve 2026-A", the state as one chip, the run id and the one provenance phrase.
  const runId = runLabel(runSlug);
  const head = (status?: ReactNode) => (
    <ScreenHead
      title={en("W-TR-07.title")}
      suffix={runId.season || undefined}
      status={status}
      titleId="W-TR-07-title"
      // One run id everywhere (round 5): "2026-A · r37", as Season, Reading room and Split review read it.
      meta={runId.text}
      provenance={PROVENANCE.seededSlips}
      testId="W-TR-07.head"
    />
  );
  const title = head();

  if (data.access !== "allowed") return <RunRouteGate data={data} />;
  if (data.error && !view) {
    return (
      <ScreenRoot id="W-TR-07" state="error" grid className="fsr-approve-screen" labelledBy="W-TR-07-title">
        {title}
        <CommandNotice error={data.error} testId="W-TR-07.error" onRetry={data.retry} />
      </ScreenRoot>
    );
  }
  if (!snapshot || !view || !state || !batch) {
    // The print beds stand where the batch and the decision will, at their final sizes.
    return (
      <ScreenRoot id="W-TR-07" state="loading" grid className="fsr-approve-screen" labelledBy="W-TR-07-title">
        {title}
        <div className="fsc-screen fsr-approve" aria-hidden data-testid="W-TR-07.loading">
          <Cell span={7} spanMd={7} className="fsr-approve__beds">
            <PrintBed shape="seal" width={sealSize} height={sealSize} />
            <div className="fsc-stack" data-gap="tight">
              <PrintBed shape="block" width={320} height={72} />
              <PrintBed shape="line" count={3} />
            </div>
          </Cell>
          <Cell span={5} spanMd={5} className="fsr-approve__decide">
            <PrintBed shape="line" count={4} />
            <PrintBed shape="slab" width={240} height={48} />
          </Cell>
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
  const cashDay = format.dateShort(cashDayForRun(snapshot, view));
  const fees = feeFacts(snapshot);
  const safe = safeFacts(snapshot, view);
  const chair = chairRule(snapshot, total);
  const reasons = blockingReasons(snapshot, view);
  const firstReason = reasons[0];
  const signedNow = keys > 0;
  const rows = batch.recipients.map((r) => ({ ...r, amount: format.money(r.cents) }));
  const batchId = senderBatchIdFor(snapshot, view.runSlug);

  // A batch to sign that failed to load says so once, beside the slab; one still loading only disarms it.
  const payloadError = signable && !armed ? batchQuery.error : null;

  let unavailable: string | undefined;
  let onReason: (() => void) | undefined;
  if (state === "blocked") {
    unavailable = reasons.length > 0 ? APPROVE.blockedHolds(reasons.length) : APPROVE.blockedReading;
    if (firstReason) onReason = () => router.history.push(firstReason.href);
  } else if (state === "mismatch" || state === "expired") {
    unavailable = state === "mismatch" ? APPROVE.mismatchAction : APPROVE.expiredAction;
    onReason = reload;
  } else if (signable && !armed) {
    unavailable = payloadError ? APPROVE.payloadFailed : APPROVE.payloadLoading;
    if (payloadError) onReason = reloadPayload;
  }

  // The key's kind comes from its ID's shape (C-13): a judge's demo key never reads as an officer's own key. Round 5:
  // no ids for people. Each signer's line says in words where the key lives ("Key on this browser", "Sample key");
  // the ids wait behind "IDs" with the hashes.
  const captionOf = (id: string, demo: string): string => {
    switch (keyKind(id)) {
      case "seeded":
        return APPROVE.keyCaption.sample;
      case "demo":
        return demo;
      case "web":
        return APPROVE.keyCaption.web;
      default:
        return APPROVE.keyCaption.device;
    }
  };
  const treasurerKeyId = treasurerApproval?.keyId ?? key?.keyId ?? null;
  // Until fs-api has registered this browser's key the row names the key that will sign: this browser's.
  const treasurerCaption = treasurerKeyId
    ? captionOf(treasurerKeyId, APPROVE.keyCaption.demo)
    : APPROVE.keyCaption.demo;
  // The Chair's line says what his key is for until he signs ("Co-signs batches over US$300", its rule in the title),
  // then where his key lived.
  const chairLine = chairApproval
    ? { caption: captionOf(chairApproval.keyId, APPROVE.keyCaption.chairDemo) }
    : { caption: chairCaption(chair.overCents), captionTitle: ruleTitle(chair.ruleId) };
  // How this browser's key was made, on hover beside its caption and its id.
  const treasurerNote =
    !treasurerApproval || keyKind(treasurerApproval.keyId) === "demo"
      ? key?.kind === "webcrypto"
        ? APPROVE.keyWebCrypto
        : key?.kind === "demo"
          ? APPROVE.keyNoble
          : undefined
      : undefined;
  // The signers' key ids, behind "IDs" with the hashes (round 5).
  const ledgerKeys: LedgerKey[] = [
    ...(treasurerKeyId
      ? [
          {
            label: APPROVE.keyIdLabel.treasurer,
            id: treasurerKeyId,
            ...(treasurerNote ? { title: treasurerNote } : {}),
            testId: "W-TR-07.keyId.treasurer",
          },
        ]
      : []),
    ...(chairApproval
      ? [
          {
            label: APPROVE.keyIdLabel.chair,
            id: chairApproval.keyId,
            ...(keyKind(chairApproval.keyId) === "demo" ? { title: APPROVE.keyDemoChair } : {}),
            testId: "W-TR-07.keyId.chair",
          },
        ]
      : []),
  ];
  const voidedAt = voidedByChange(view);
  const voidedTime = voidedAt ? format.time(voidedAt).slice(0, 5) : null;
  const treasurerStamp = treasurerApproval
    ? stampFor(snapshot, "treasurer:analyn", treasurerApproval.at)
    : voidedAt
      ? stampFor(snapshot, "treasurer:analyn", voidedAt)
      : null;
  const chairStamp = chairApproval
    ? stampFor(snapshot, "board:ernesto", chairApproval.at)
    : voidedAt
      ? stampFor(snapshot, "board:ernesto", voidedAt)
      : null;
  // Ernesto's presence, only while key 1 waits on him: his row says it in place of "Waiting" (round 4: his state
  // is said once, in his row), with the whole sentence as its title.
  const presenceHold = presence?.holdId
    ? holdNumber(view.holds[presence.holdId]?.label ?? presence.holdId)
    : null;
  const presenceStatus =
    state === "key1" && presence && !chairApproval
      ? {
          word: presenceHold ? APPROVE.reviewingHold(presenceHold) : APPROVE.reviewing,
          title: presenceHold ? APPROVE.presence(presenceHold) : APPROVE.presenceApproval,
        }
      : null;

  // Four checks above the slab (spec §3.9): a ✓ in ink for a checked fact, a marigold dot for one still open.
  const checks: CheckRow[] = [
    {
      key: "holds",
      label: APPROVE.checkHolds,
      value: [`${safe.holds}/${safe.holdsTotal}`, safe.byHand > 0 ? APPROVE.byHand(safe.byHand) : null]
        .filter(Boolean)
        .join(" · "),
      done: safe.holds === safe.holdsTotal,
    },
    {
      key: "shrink",
      label: APPROVE.checkShrink,
      value: `${safe.shrink} ${safe.inside ? "≤" : ">"} ${safe.limit}`,
      done: safe.inside,
    },
    {
      key: "lines",
      label: APPROVE.checkLines,
      value: `${safe.explained}/${safe.lines}`,
      done: safe.explained === safe.lines,
    },
    { key: "card", label: APPROVE.checkRateCard, value: APPROVE.since(safe.date), done: true },
  ];

  // Who the batch pays (round 5), the largest first as on the Run's fan: each hollow until the simulated PayPal
  // confirms it (a replay never reads as paid).
  const replayed = payoutReplayed(view);
  const payees: PayeeRow[] = [...batch.recipients]
    .sort((a, b) => b.cents - a.cents)
    .map((r) => {
      const line = replayed ? undefined : view.lines[r.memberNo]?.state;
      const dot =
        line === "PAID" ? "paid" : line === "UNCLAIMED" || line === "PAYPAL_HELD" ? "held" : "pending";
      return {
        memberNo: r.memberNo,
        name: r.name,
        amount: format.money(r.cents),
        state: dot,
        ...(dot === "pending" ? {} : { stateWord: APPROVE.payeeWord[dot] }),
      };
    });
  // The PayPal segment stays planned (a steel dashed outline) until the simulated PayPal confirmed every payout.
  const paypalTone = payees.length > 0 && payees.every((p) => p.state === "paid") ? "confirmed" : "planned";
  const chip = stateChip(state, keys, reasons.length);

  const screenState: ScreenState<"W-TR-07"> = state;
  const inJudgeMode = data.live && stage !== null;
  const done = state === "approved" || state === "posting" || state === "retrying";

  return (
    <ScreenRoot
      id="W-TR-07"
      state={screenState}
      grid
      className="fsr-approve-screen"
      labelledBy="W-TR-07-title"
    >
      {head(
        <Chip
          tone={chip.tone}
          glyph={chip.glyph}
          testId={chip.count ? "W-TR-07.keysCount" : "W-TR-07.stateChip"}
        >
          {chip.text}
        </Chip>,
      )}
      {/* The moment's root spans the row and lays its own two cells on the same twelve columns. */}
      <section
        {...moment.rootProps}
        className="fsc-screen fsr-approve"
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
        {voidedTime && (
          <p className="fsr-banner fsr-banner--ink" role="status" data-testid="W-TR-07.voided">
            {APPROVE.voided(voidedTime)}
          </p>
        )}

        {/* The batch (columns 1–7): one composition of the seal grown from its hash, the amount PayPal is asked
            to move and the two people who sign it; then the bar of where the rest goes, and the details a person
            opens to compare by eye. */}
        <Cell span={7} spanMd={7} className="fsr-approve__batch">
          <div className="fsr-approve__hero">
            <div ref={sealRef} className="fsr-approve__seal-wrap">
              <SealBlock batchSha256={batchSha256} keys={keys} engrave={engrave} size={sealSize} />
            </div>

            <div className="fsr-approve__side">
              <div
                className="fsr-approve__amount"
                data-amount-state={amountState}
                data-animate={script.busy ? "" : undefined}
              >
                <p className="fsr-approve__hero-label">
                  <span className="fs-t-label">{APPROVE.heroLabel(batch.itemCount)}</span>
                  <MicroTag label={railTag(rail)} testId="W-TR-07.tag" />
                </p>
                <AmountDisplay
                  amount={amount}
                  pencil={amountState === "pencil"}
                  hollow={amountState === "hollow"}
                  testId="W-TR-07.amount"
                />
              </div>

              <Signers
                officers={chair.required ? 2 : 1}
                rows={
                  <>
                    <KeySlot
                      name={APPROVE.keyName.treasurer}
                      caption={treasurerCaption}
                      {...(treasurerNote ? { captionTitle: treasurerNote } : {})}
                      status={
                        treasurerApproval && treasurerStamp
                          ? en("W-TR-07.key.signed", { time: treasurerStamp.at })
                          : voidedTime
                            ? APPROVE.voidedKey(voidedTime)
                            : signing
                              ? APPROVE.signing
                              : APPROVE.waitingKey
                      }
                      voided={voidedAt !== null}
                      signed={treasurerApproval !== null}
                      stamp={treasurerStamp}
                      testId="W-TR-07.key.treasurer"
                    />
                    {chair.required && (
                      <KeySlot
                        name={APPROVE.keyName.chair}
                        {...chairLine}
                        status={
                          chairApproval && chairStamp
                            ? en("W-TR-07.key.signed", { time: chairStamp.at })
                            : voidedTime
                              ? APPROVE.voidedKey(voidedTime)
                              : (presenceStatus?.word ?? APPROVE.waitingKey)
                        }
                        {...(presenceStatus ? { statusTitle: presenceStatus.title } : {})}
                        voided={voidedAt !== null}
                        signed={chairApproval !== null}
                        stamp={chairStamp}
                        testId="W-TR-07.key.chair"
                      />
                    )}
                  </>
                }
              />
            </div>
          </div>
        </Cell>

        {/* Where the money goes (round 5, no dead bands): the bar, and at 1,920 the eight PayPal recipients under it,
            as a second grid row across all twelve columns once the batch and the decision card stand side by side (the
            screen packs the card back beside the batch, .fsr-approve's dense flow); on the laptops it stays under the
            batch (seven columns). The reading order stays the batch, its money, then the decision. */}
        <Cell span={12} spanMd={7} className="fsr-approve__money">
          <MoneyBar
            testId="W-TR-07.rail"
            label={APPROVE.railLabel}
            segments={[
              {
                key: "paypal",
                tone: paypalTone,
                cents: total,
                label: APPROVE.legendPaypal,
                count: batch.itemCount,
                amount: amount.display,
              },
              {
                key: "cash",
                tone: "cash",
                cents: batch.cashCents,
                label: APPROVE.legendCash,
                count: batch.cashCount,
                note: cashDay,
                amount: format.money(batch.cashCents),
              },
            ]}
          />

          {/* The second row at 1,920 (round 5): who the PayPal segment pays, two columns across. */}
          {batch.final && payees.length > 0 && (
            <Payees rows={payees} label={APPROVE.payeesLabel(payees.length)} testId="W-TR-07.payees" />
          )}

          <details className="fsr-approve__details">
            <summary className="fsr-approve__summary fs-t-label">
              <Glyph name="ms:expand-more" size={16} />
              {APPROVE.detailsSummary(fees.sandboxTotal)}
            </summary>
            <div className="fsr-approve__details-body">
              <p className="fsr-approve__fees fs-t-caption" data-testid="W-TR-07.fees">
                {en("W-TR-07.fees", { ...fees })} <span className="fsr-muted">{APPROVE.feesLabel}.</span>
              </p>
              <section className="fsr-approve__ledger" aria-labelledby="W-TR-07-ledger">
                <h2 id="W-TR-07-ledger" className="fs-t-label">
                  {APPROVE.signTitle}
                </h2>
                <BatchLedger
                  senderBatchId={batchId}
                  batchSha256={batchSha256}
                  signedLinesDigest={linesDisagree ? null : payloadLines}
                  lines={batch.lines}
                  cashLines={batch.cashCount}
                  rateCardSha256={snapshot.rateCard.sha256}
                  keys={ledgerKeys}
                />
              </section>
              <p className="fsr-approve__provenance fs-t-caption">
                {provenanceFooter({ kind: "engine", rateCardSha256: snapshot.rateCard.sha256 })}
              </p>
            </div>
          </details>
        </Cell>

        {/* The decision (columns 8–12), one card that hugs its content: the checks, one way to sign while no key
            has signed, and only after key 1 the Chair's co-sign block. */}
        <Cell span={5} spanMd={5} className="fsr-approve__decide">
          {batch.final ? (
            <CheckList rows={checks} testId="W-TR-07.safe" />
          ) : (
            <BlockedList reasons={reasons} />
          )}

          {(!signedNow || state === "killed") && (
            <div ref={slabRef} className="fsr-approve__slab">
              <Slab
                key={slabKey}
                label={label}
                srLabel={APPROVE.srApprove(label, amount.spoken)}
                depth="d3"
                tone="jade"
                hold={TIMING.holdConsole}
                size="l"
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
                hint={!signedNow}
                testId="W-TR-07.approve"
                onHoldChange={onHoldChange}
                onCommit={approve}
              />
            </div>
          )}
          {state === "killed" && (
            <p className="fsr-approve__killed fs-t-label" data-testid="W-TR-07.killed">
              <Glyph name="ms:pause" size={16} />
              {APPROVE.killed}
            </p>
          )}

          {done && (
            <div className="fsr-approve__done" data-testid="W-TR-07.approved">
              <span className="fs-sr">{APPROVE.approved}</span>
              {state === "posting" && (
                <p className="fsr-approve__posting fs-t-caption" data-testid="W-TR-07.posting">
                  {APPROVE.posting(batchId)}
                </p>
              )}
              {/* Round 5: no glyph; the amount's micro-tag and the bar's indicator already say the rail. */}
              {isPosted(view) && (
                <p className="fsr-approve__posted fs-t-label" title={railTag(rail)}>
                  {APPROVE.posted}
                </p>
              )}
            </div>
          )}

          {keys === 2 && (
            <AppLink
              href={webRoutes.fanout(view.runSlug)}
              className="fs-flat"
              data-size="l"
              data-testid="W-TR-07.fanout"
            >
              {APPROVE.watchPayouts}
            </AppLink>
          )}

          {payloadError && (
            <CommandNotice
              error={payloadError}
              testId="W-TR-07.payload.error"
              onRetry={reloadPayload}
              retryLabel={APPROVE.payloadRetry}
            />
          )}
          {submit.queuedMs !== null && (
            <p role="status" className="fs-t-caption" data-testid="W-TR-07.queued">
              You're next, about {Math.ceil(submit.queuedMs / 1000)} s
            </p>
          )}
          {failure !== null && <CommandNotice error={failure} testId="W-TR-07.error" onRetry={reload} />}

          {/* The Chair's ways to co-sign, only once key 1 is in: before it, the slab is the one way to sign. */}
          {inJudgeMode && state === "key1" && chair.required && (
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
        </Cell>
      </section>
    </ScreenRoot>
  );
}

interface StateChipView {
  readonly tone: ChipTone;
  readonly glyph: GlyphName;
  readonly text: string;
  /** The chip is the keys count ("1/2 signed"): its test hook is the count's. */
  readonly count: boolean;
}

/**
 * Approve's state on its title row (round 5), said once: how many keys signed, or what stops the signing (holds open,
 * the slips still being read, PayPal's no, a pause, the Chair sending it back).
 */
function stateChip(
  state: ReturnType<typeof approveState>,
  keys: 0 | 1 | 2,
  holdsOpen: number,
): StateChipView {
  switch (state) {
    case "blocked":
      return holdsOpen > 0
        ? { tone: "canary", glyph: "ms:pause", text: APPROVE.chip.holds(holdsOpen), count: false }
        : { tone: "flight", glyph: "logbook", text: APPROVE.chip.reading, count: false };
    case "denied":
      return { tone: "red", glyph: "rail", text: APPROVE.chip.denied, count: false };
    case "killed":
      return { tone: "neutral", glyph: "ms:pause", text: APPROVE.chip.paused, count: false };
    case "declined":
      return { tone: "neutral", glyph: "ms:arrow-back", text: APPROVE.chip.sentBack, count: false };
    default:
      return { tone: "neutral", glyph: "seal", text: APPROVE.signedCount(keys), count: true };
  }
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
              <StateDot kind="held" className="fsr-approve__blocked-mark" />
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
          {declined?.stamp && <Stamp stamp={declined.stamp} />}
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
