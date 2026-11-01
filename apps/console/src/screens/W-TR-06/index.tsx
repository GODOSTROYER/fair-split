// W-TR-06 Hold drawer (S1.7, design §6 C6): one hold, two voices, the evidence and one decision, beside the
// split while `?hold=` is set. H1 is MM-3, "The pink copy": the two copies of slip 0457 glide in, converge and
// light their matching fields; "Count it once" is a d2 press, and when the engine's `hold.resolved` arrives the
// needle swings from 2.05% to 1.62% and the grid behind gains its cents in a wave. H2 registers a plot, H3
// returns a fine no rule allows; both resolve as flush ink stamps, with no moment. A hold is never an error.

import { type ResolveHoldRequest, webRoutes } from "@fairsplit/contracts";
import { Glyph, HoldCard, type HoldView, Print } from "@fairsplit/ui-web";
import { useRouter } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { PrintBed } from "../../chrome/PrintBed.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { StageDrawer } from "../../chrome/StageDrawer.js";
import { Stamp } from "../../chrome/Stamp.js";
import { useCommand } from "../../data/hooks.js";
import { livePresence, type RunHold, type RunView } from "../../data/run-view.js";
import { NoRuleEvidence, TwinCompare, YieldEvidence } from "../../features/holds/Evidence.js";
import {
  cardState,
  duplicateFacts,
  factsFor,
  findHold,
  memberOf,
  nextAfter,
  noRuleFacts,
  position,
  resultLine,
  seededHold,
  slipCopies,
  twinRows,
  voices,
  yieldFacts,
} from "../../features/holds/model.js";
import { basisEventId, isOpenHold, massBalanceView, splitBasis } from "../../features/split/model.js";
import { Dial, dialLabel } from "../../features/split/SplitHeader.js";
import { en, HOLDS } from "../../features/split/shared/copy.js";
import { stampFor } from "../../features/split/shared/people.js";
import { useLiveEvents, useRunData } from "../../features/split/shared/run-data.js";
import { useMomentScript, usePhaseSync } from "../../features/split/shared/script.js";
import { useMoment } from "../../lib/moment.js";
import { provenanceFooter } from "../../lib/provenance.js";
import type { ScreenState } from "../../lib/screens.js";
import type { HoldDrawerProps } from "../contract.js";
import "../../features/split/shared/runs.css";
import "../../features/split/split.css";
import "../../features/holds/holds.css";

type Mm3Resting = "ready" | "pressed" | "resolved";

export function Screen({ runSlug, holdId }: HoldDrawerProps) {
  const data = useRunData(runSlug);
  const { snapshot, view } = data;
  const router = useRouter();
  const instance = useId();
  const close = useCallback(() => router.history.push(webRoutes.split(runSlug)), [router, runSlug]);
  const hold = view ? findHold(view, holdId) : undefined;
  const resolve = useCommand("resolveHold");
  const [slabKey, setSlabKey] = useState(0);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const pressedHere = useRef<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const isDuplicate = hold?.kind === "DUPLICATE_SLIP";
  const moment = useMoment("MM-3", { focal: true });
  const script = useMomentScript(moment);
  const live = useLiveEvents(data.live ? runSlug : null, (event) => {
    if (event.type !== "hold.resolved" || !hold || event.payload.holdId !== hold.holdId) return;
    if (hold.kind === "DUPLICATE_SLIP" && event.payload.resolution === "COUNT_ONCE") {
      // The decision's event: the needle swings, the grid waves, the card goes flush (MM-3 "count-once").
      script.run(
        "count-once",
        { eventId: event.id, kind: "sse" },
        { focal: true, skipFeedback: pressedHere.current === hold.holdId ? ["slab.d2.commit"] : [] },
      );
    }
  });

  // H1 opened: the photos glide in, converge and light their matching fields (MM-3 "open"). Opening is the
  // person's own act, so it is its evidence; a decided H1 shows its fields in place instead.
  const holdOpen = hold ? isOpenHold(hold) : false;
  useEffect(() => {
    if (hold?.kind !== "DUPLICATE_SLIP" || !holdOpen || openedFor === hold.holdId) return;
    setOpenedFor(hold.holdId);
    script.run("open", { eventId: `open:${hold.holdId}:${instance}`, kind: "press" }, { focal: true });
  }, [hold, holdOpen, openedFor, script, instance]);

  // A press is in flight from here until its event lands (or the API says something else).
  const answered = resolve.data?.hold;
  const inFlight = hold !== undefined && resolve.variables?.params?.holdId === hold.holdId;
  const resolving =
    inFlight && (resolve.isPending || (resolve.isSuccess && holdOpen && answered?.state !== "ASKED_CHAIR"));
  const askedChair = inFlight && resolve.isSuccess && answered?.state === "ASKED_CHAIR";

  const presence = view
    ? livePresence(view, now).find(
        (p) => hold && p.holdId === hold.holdId && /ernesto|chair|board/.test(p.persona),
      )
    : undefined;
  useEffect(() => {
    if (!presence) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, Date.parse(presence.expiresAt) - Date.now()) + 50,
    );
    return () => clearTimeout(timer);
  }, [presence]);

  const resting: Mm3Resting | null =
    !hold || !isDuplicate
      ? null
      : resolving
        ? "pressed"
        : hold.state === "RESOLVED" || hold.state === "EXCLUDED"
          ? "resolved"
          : openedFor === hold.holdId
            ? "ready"
            : null;
  usePhaseSync(moment, resting, script.busy);

  const decide = useCallback(
    (body: ResolveHoldRequest) => {
      if (!hold) return;
      pressedHere.current = hold.holdId;
      if (hold.kind === "DUPLICATE_SLIP" && body.resolution === "COUNT_ONCE") {
        script.cancel();
        moment.enter("pressed");
      }
      resolve.mutate(
        { params: { holdId: hold.holdId }, body },
        {
          onError: () => {
            pressedHere.current = null;
            setSlabKey((k) => k + 1);
          },
        },
      );
    },
    [hold, moment, resolve, script],
  );

  const onReason = (e: FormEvent) => {
    e.preventDefault();
    const text = reason.trim();
    if (text.length < 3) return;
    setReasonOpen(false);
    decide({ resolution: "TWO_DELIVERIES", reason: text });
  };

  const seeded = snapshot && hold ? seededHold(snapshot, hold) : undefined;
  const pos = view && hold ? position(view, hold) : null;
  const drawerLabel = hold ? `Hold ${hold.label}` : `Hold ${holdId}`;
  const meta = pos
    ? HOLDS.meta(pos.index, pos.total)
    : seeded?.serials[0]
      ? HOLDS.slipMeta(seeded.serials[0])
      : null;

  const body = (() => {
    if (data.error && !view) {
      return (
        <ScreenRoot id="W-TR-06" state="error" className="fsr-hold-screen" labelledBy="W-TR-06-title">
          <h2 id="W-TR-06-title" className="fs-sr">
            {drawerLabel}
          </h2>
          <CommandNotice error={data.error} testId="W-TR-06.error" onRetry={data.retry} />
        </ScreenRoot>
      );
    }
    if (!snapshot || !view) {
      return (
        <ScreenRoot id="W-TR-06" state="loading" className="fsr-hold-screen" labelledBy="W-TR-06-title">
          <h2 id="W-TR-06-title" className="fs-sr">
            {drawerLabel}
          </h2>
          <div className="fsr-hold__beds" aria-hidden data-testid="W-TR-06.loading">
            <PrintBed shape="line" count={3} />
            <PrintBed shape="photo" height={200} />
            <PrintBed shape="slab" />
          </div>
        </ScreenRoot>
      );
    }
    if (!hold) {
      return (
        <ScreenRoot id="W-TR-06" state="error" className="fsr-hold-screen" labelledBy="W-TR-06-title">
          <div className="fsr-empty" data-testid="W-TR-06.notFound">
            <h2 id="W-TR-06-title" className="fs-t-title-2">
              {HOLDS.notFound}
            </h2>
            <p className="fsr-muted">{HOLDS.notFoundHelp}</p>
            <AppLink href={webRoutes.split(runSlug)} className="fs-link fs-t-label">
              {HOLDS.back}
            </AppLink>
          </div>
        </ScreenRoot>
      );
    }
    const flags = { resolving, conflict: presence !== undefined };
    const state = askedChair ? "asked-chair" : cardState(hold, flags);
    const screenState: ScreenState<"W-TR-06"> = state;
    const next = !holdOpen ? nextAfter(snapshot, view, hold) : null;
    if (hold.kind === "LOW_CONFIDENCE") {
      return <ByHandCard snapshot={snapshot} view={view} hold={hold} state={screenState} next={next} />;
    }
    if (hold.kind === "MASS_BALANCE") {
      return (
        <MassBalanceCard
          snapshot={snapshot}
          view={view}
          hold={hold}
          state={screenState}
          swing={live.isLive(basisEventId(view))}
        />
      );
    }
    const v = voices(snapshot, view, hold);
    const card: HoldView = {
      id: hold.label,
      kind: hold.kind,
      title: v.title,
      engineLine: v.engineLine,
      ...(v.claudeLine ? { claudeLine: v.claudeLine } : {}),
      ...(holdOpen && v.effect ? { effect: v.effect } : {}),
      state,
    };
    const stamp = stampFor(snapshot, hold.resolvedBy, hold.resolvedAt);
    const result = resultLine(snapshot, view, hold, hold.resolution);
    const member = memberOf(snapshot, hold.memberNo);
    const facts = factsFor(snapshot, view, hold);
    const phase = moment.phase === "closed" && resting !== null ? resting : moment.phase;

    let evidence: ReactNode = null;
    let actions: Parameters<typeof HoldCard>[0]["actions"];
    if (hold.kind === "DUPLICATE_SLIP") {
      const d = duplicateFacts(facts, seeded);
      const [a, b] = slipCopies(snapshot, d.serial);
      const dial = massBalanceView(snapshot, view);
      evidence = (
        <>
          {a && b && (
            <TwinCompare
              a={a}
              b={b}
              rows={twinRows(a, b)}
              phase={phase}
              animate={script.busy}
              mode={moment.mode}
            />
          )}
          <div className="fsr-hold__dial" data-testid="W-TR-06.dialBlock">
            <Dial
              dial={dial}
              swing={live.isLive(basisEventId(view, splitBasis(view)))}
              size={112}
              testId="W-TR-06.dial"
            />
            <p className="fs-t-caption">
              <span className="fsr-muted">{HOLDS.shrinkNow}: </span>
              <span data-testid="W-TR-06.dial.status" data-status={dial.status}>
                {dial.status === "PENDING"
                  ? dialLabel(dial)
                  : `${dial.display}, ${dialLabel(dial).toLowerCase()}`}
              </span>
            </p>
          </div>
        </>
      );
      actions = [
        {
          kind: "slab",
          label: en("W-TR-06.H1.action"),
          srLabel: HOLDS.srCountOnce(d.moved, d.others),
          testId: "W-TR-06.countOnce",
          onCommit: () => decide({ resolution: "COUNT_ONCE" }),
        },
        {
          kind: "flat",
          label: en("W-TR-06.H1.flat"),
          note: en("W-TR-06.H1.flatNote"),
          testId: "W-TR-06.twoDeliveries",
          onSelect: () => setReasonOpen(true),
        },
      ];
    } else if (hold.kind === "IMPLAUSIBLE_YIELD") {
      const y = yieldFacts(snapshot, hold, member);
      const plot = y.pendingPlot;
      evidence = (
        <YieldEvidence
          facts={y}
          plots={member?.plots ?? []}
          registered={hold.state === "RESOLVED" && hold.resolution === "REGISTER_PLOT"}
        />
      );
      actions = [
        {
          kind: "slab",
          label: en("W-TR-06.H2.action"),
          srLabel: HOLDS.srRegister(plot?.plotNo ?? ""),
          testId: "W-TR-06.registerPlot",
          onCommit: () => {
            if (!plot) return;
            decide({
              resolution: "REGISTER_PLOT",
              plot: { plotNo: plot.plotNo, areaHa: plot.areaHa, trees: plot.trees },
            });
          },
        },
      ];
    } else if (hold.kind === "NO_RULE") {
      const n = noRuleFacts(snapshot, hold, facts);
      evidence = <NoRuleEvidence slip={slipCopies(snapshot, n.serial)[0]} facts={n} />;
      actions = [
        {
          kind: "slab",
          label: en("W-TR-06.H3.action", { multa: n.written }),
          srLabel: HOLDS.srReturn(n.credit),
          testId: "W-TR-06.returnCredit",
          onCommit: () => decide({ resolution: "RETURN_AS_CREDIT" }),
        },
      ];
    } else {
      actions = [
        {
          kind: "slab",
          label: en("hold.state.OPEN"),
          srLabel: en("hold.state.OPEN"),
          testId: "W-TR-06.decide",
          onCommit: () => undefined,
        },
      ];
    }

    const cardNode = (
      <HoldCard
        key={slabKey}
        hold={card}
        gate={hold.gate}
        actions={actions}
        {...(stamp ? { resolution: stamp } : {})}
        evidence={evidence}
        testId="W-TR-06.card"
        className="fsr-hold"
      />
    );
    const showResult =
      result &&
      (!isDuplicate || hold.resolution !== "COUNT_ONCE" || phase === "wave" || phase === "resolved");

    return (
      <ScreenRoot
        id="W-TR-06"
        state={screenState}
        className="fsr-hold-screen"
        labelledBy="W-TR-06.card-title"
      >
        {isDuplicate ? (
          <div {...moment.rootProps} className="fsr-mm3" data-motion={moment.mode}>
            {cardNode}
          </div>
        ) : (
          cardNode
        )}
        {reasonOpen && holdOpen && (
          <form className="fsr-reason" onSubmit={onReason} data-testid="W-TR-06.reason">
            <p className="fs-t-label">{HOLDS.twoDeliveriesTitle}</p>
            <label className="fsr-field">
              <span className="fs-t-caption">{HOLDS.reasonLabel}</span>
              <textarea
                className="fsr-input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={3}
                required
                aria-describedby="W-TR-06-reason-hint"
                data-testid="W-TR-06.reason.text"
              />
            </label>
            <p id="W-TR-06-reason-hint" className="fs-t-caption fsr-muted">
              {HOLDS.twoDeliveriesHint}
            </p>
            <div className="fsr-reason__actions">
              <button
                type="submit"
                className="fs-flat"
                data-testid="W-TR-06.reason.submit"
                disabled={reason.trim().length < 3}
              >
                {HOLDS.reasonSubmit}
              </button>
              <button type="button" className="fs-link fs-t-label" onClick={() => setReasonOpen(false)}>
                {HOLDS.reasonCancel}
              </button>
            </div>
          </form>
        )}
        {showResult && (
          <Print
            value={result}
            provenance="engine"
            state="ink"
            typeRole="label"
            as="p"
            reveal={script.busy}
            footer={provenanceFooter({ kind: "engine", rateCardSha256: snapshot.rateCard.sha256 })}
            className="fsr-hold__result"
            testId="W-TR-06.result"
          />
        )}
        {resolve.error && inFlight && <CommandNotice error={resolve.error} testId="W-TR-06.error" />}
        {next && <NextLink next={next} />}
      </ScreenRoot>
    );
  })();

  return (
    <StageDrawer label={drawerLabel} meta={meta} onClose={close} testId="W-TR-06.drawer">
      {body}
    </StageDrawer>
  );
}

function NextLink({
  next,
}: {
  readonly next: { readonly href: string; readonly words: string; readonly kind: string };
}) {
  return (
    <p className="fsr-next" data-kind={next.kind === "approve" ? "approve" : "hold"}>
      <span className="fsr-next__mark" aria-hidden />
      <AppLink href={next.href} className="fs-link fs-t-label" data-testid="W-TR-06.next" data-focus-after="">
        {next.words}
      </AppLink>
    </p>
  );
}

interface SideCardProps {
  readonly snapshot: NonNullable<ReturnType<typeof useRunData>["snapshot"]>;
  readonly view: RunView;
  readonly hold: RunHold;
  readonly state: ScreenState<"W-TR-06">;
}

/** Slip 0462: decided on W-TR-04, one field at a time; this card says why and links there. */
function ByHandCard({
  snapshot,
  view,
  hold,
  state,
  next,
}: SideCardProps & { readonly next: ReturnType<typeof nextAfter> }) {
  const seeded = seededHold(snapshot, hold);
  const serial = seeded?.serials[0] ?? "";
  const field = Object.values(view.fields).find((f) => f.serial === serial);
  const stamp = stampFor(
    snapshot,
    hold.resolvedBy ?? field?.enteredBy ?? null,
    hold.resolvedAt ?? field?.at ?? null,
  );
  const decided = !isOpenHold(hold);
  return (
    <ScreenRoot id="W-TR-06" state={state} className="fsr-hold-screen" labelledBy="W-TR-06-title">
      <article
        className="fs-hold fsr-hold"
        data-state={decided ? "resolved" : "open"}
        data-gate={hold.gate}
        data-testid="W-TR-06.card"
      >
        <header className="fs-hold__head">
          <span className="fs-hold__kind">
            <Glyph
              name={decided ? "logbook" : "logbook-fill"}
              size={20}
              label={en("hold.kind.LOW_CONFIDENCE")}
            />
          </span>
          <h2 id="W-TR-06-title" className="fs-hold__title fs-t-title-2">
            {HOLDS.byHandTitle(serial)}
          </h2>
        </header>
        <p className="fs-hold__gate" data-gate={hold.gate}>
          <Glyph name="hanging-scale" size={16} />
          <span className="fs-t-label">{en(`hold.gate.${hold.gate}`)}</span>
        </p>
        <dl className="fs-hold__voices">
          <div className="fs-hold__voice" data-voice="engine">
            <dt className="fs-t-caption">{en("hold.engine")}</dt>
            <dd className="fs-t-body">{seeded?.engineLine}</dd>
          </div>
        </dl>
        <footer className="fs-hold__actions">
          {decided ? (
            <p className="fs-hold__resolution" data-testid="W-TR-06.card.resolution">
              {stamp && <Stamp stamp={stamp} />}
              <span className="fs-t-label">{HOLDS.byHandDone(serial)}</span>
            </p>
          ) : (
            <AppLink
              href={webRoutes.byHand(snapshot.season.label, serial)}
              className="fs-flat"
              data-testid="W-TR-06.byHand"
            >
              <Glyph name="logbook" size={18} />
              {HOLDS.byHandLink(serial)}
            </AppLink>
          )}
        </footer>
      </article>
      {next && <NextLink next={next} />}
    </ScreenRoot>
  );
}

/** The season-level check: the dial, and where it is decided (it clears when the duplicate is counted once). */
function MassBalanceCard({
  snapshot,
  view,
  hold,
  state,
  swing,
}: SideCardProps & { readonly swing: boolean }) {
  const dial = massBalanceView(snapshot, view);
  const duplicate = Object.values(view.holds).find((h) => h.kind === "DUPLICATE_SLIP");
  const decided = !isOpenHold(hold);
  const seeded = seededHold(snapshot, hold);
  return (
    <ScreenRoot id="W-TR-06" state={state} className="fsr-hold-screen" labelledBy="W-TR-06-title">
      <article
        className="fs-hold fsr-hold"
        data-state={decided ? "resolved" : "open"}
        data-gate={hold.gate}
        data-testid="W-TR-06.card"
      >
        <header className="fs-hold__head">
          <span className="fs-hold__kind">
            <Glyph
              name={decided ? "hanging-scale" : "hanging-scale-fill"}
              size={20}
              label={en("hold.kind.MASS_BALANCE")}
            />
          </span>
          <h2 id="W-TR-06-title" className="fs-hold__title fs-t-title-2">
            {HOLDS.massTitle}
          </h2>
        </header>
        <p className="fs-hold__gate" data-gate={hold.gate}>
          <Glyph name="hanging-scale" size={16} />
          <span className="fs-t-label">{en(`hold.gate.${hold.gate}`)}</span>
        </p>
        <div className="fsr-hold__dial">
          <Dial dial={dial} swing={swing} size={132} testId="W-TR-06.dial" />
          <p className="fs-t-body" data-testid="W-TR-06.dial.status" data-status={dial.status}>
            {decided ? (seeded?.resolvedLine ?? HOLDS.massCleared) : seeded?.engineLine}
          </p>
        </div>
        <footer className="fs-hold__actions">
          {decided ? (
            <p className="fs-hold__resolution fs-t-label">{HOLDS.massCleared}</p>
          ) : duplicate ? (
            <AppLink
              href={webRoutes.holdDrawer(view.runSlug, duplicate.label)}
              className="fs-flat"
              data-testid="W-TR-06.toH1"
            >
              <Glyph name="duplicate" size={18} />
              {HOLDS.massLink}
            </AppLink>
          ) : null}
        </footer>
      </article>
    </ScreenRoot>
  );
}
