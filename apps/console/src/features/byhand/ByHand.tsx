// W-TR-04 By hand (S1.7, design §6 C4): one field at a time. The slip's crop at three times its photo size, the
// logbook page's lines around the slip beneath it as a second witness, and one 48 px condensed field that shows
// "6▢.80" with the slot selected, so one keystroke fills it. As she types: "64.80 − 0.30 tare = 64.50 net.
// Matches logbook page 14, line 7." "Use logbook line 7" fills the digit from the logbook's net plus the tare.
// The commit is a d2 slab (or Enter); the value prints in ink with her AS stamp when the server's live
// `field.entered` arrives, and that event plays MM-2's by-hand act (by-hand → entered → done). The crop, line 7,
// the field and the slab all sit above the stage's ribbon. Doubt becomes the treasurer's ink.

import { type SeasonSnapshot, webRoutes } from "@fairsplit/contracts";
import { Glyph, Paper, Slab, useMotionMode } from "@fairsplit/ui-web";
import { useQuery } from "@tanstack/react-query";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { z } from "zod";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { Stamp } from "../../chrome/Stamp.js";
import { useAdapter, useCommand, useJudgeSession, useRunEvents, useStageRun } from "../../data/hooks.js";
import { focusAndReveal, useFocusAfterRemoval } from "../../lib/focus.js";
import { format } from "../../lib/format.js";
import { useMoment } from "../../lib/moment.js";
import { useNextStep, usePrefocus } from "../../stage/context.js";
import { byHandHoldFor } from "../reading/model.js";
import { SlipPaper } from "../reading/SlipPaper.js";
import { boxFor } from "../reading/slip.js";
import { BY_HAND_COPY } from "./copy.js";
import { resolveFieldId } from "./field-id.js";
import { LogbookPaper, logbookWindow } from "./LogbookPaper.js";
import { mockWorldFields } from "./mock-fields.js";
import {
  type ByHandState,
  byHandField,
  byHandState,
  fillMask,
  grossFromLogbook,
  insertedDigit,
  isComplete,
  logbookWitness,
  maskOf,
  preview,
  SLOT,
} from "./model.js";
import "./byhand.css";

/** The crop around gross, tare and net (the stain's reach), in the slip's own units. */
function cropBox() {
  const gross = boxFor("gross_kg");
  const tare = boxFor("tare_kg");
  const net = boxFor("net_kg");
  if (!gross || !tare || !net) return null;
  return {
    x: gross.x - 8,
    y: gross.y - 8,
    w: tare.x + tare.w - gross.x + 16,
    h: net.y + net.h - gross.y + 16,
  };
}

export function ByHand({ snapshot, serial }: { readonly snapshot: SeasonSnapshot; readonly serial: string }) {
  const by = byHandField(snapshot, serial);
  if (!by) return <NothingByHand snapshot={snapshot} serial={serial} />;
  return <ByHandField snapshot={snapshot} serial={serial} field={by} />;
}

/** Two kilo texts name the same weight ("64.50" and "64.5"). */
function sameKilos(a: string, b: string): boolean {
  return Number(a) === Number(b);
}

function NothingByHand({ snapshot, serial }: { readonly snapshot: SeasonSnapshot; readonly serial: string }) {
  const slip = snapshot.slips.find((s) => s.serial === serial);
  return (
    <ScreenRoot id="W-TR-04" state="empty" labelledBy="fsc-hand-title" className="fsc-hand">
      <header className="fsc-hand__head">
        <h1 id="fsc-hand-title" className="fs-t-title-1">
          {BY_HAND_COPY.title(serial)}
          <span className="fsc-hand__context"> {BY_HAND_COPY.titleContext}</span>
        </h1>
        <p className="fsc-hand__prompt" data-testid="W-TR-04.prompt">
          {BY_HAND_COPY.noNeed(serial)}{" "}
          {slip && (
            <AppLink href={webRoutes.reading(snapshot.season.label, slip.photoId)} className="fs-link">
              {BY_HAND_COPY.openReading}
            </AppLink>
          )}
        </p>
      </header>
    </ScreenRoot>
  );
}

function ByHandField({
  snapshot,
  serial,
  field,
}: {
  readonly snapshot: SeasonSnapshot;
  readonly serial: string;
  readonly field: NonNullable<ReturnType<typeof byHandField>>;
}) {
  const mode = useMotionMode();
  const adapter = useAdapter();
  const session = useJudgeSession();
  const { runSlug, view, inSession } = useStageRun();
  const moment = useMoment("MM-2");
  // A failed entry puts the slab back at rest (remounted), so she can press again.
  const [attempt, setAttempt] = useState(0);
  const enter = useCommand("enterField", {
    onError: () => setAttempt((a) => a + 1),
  });
  const next = useNextStep();
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hintId = useId();
  const liveId = useId();

  const witness = logbookWitness(snapshot, serial);
  const mask = maskOf(field.reading);
  const tare = field.slip.boxes["7"];
  const [whole, setWhole] = useState(mask === null);
  const [value, setValue] = useState(mask?.template ?? "");
  const [fromLogbook, setFromLogbook] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [anyway, setAnyway] = useState(false);
  const [pressedAt, setPressedAt] = useState<string | null>(null);

  const hold = view ? byHandHoldFor(view, snapshot, serial) : undefined;
  const entered =
    Object.values(view?.fields ?? {}).find((f) => f.serial === serial && f.field === field.field) ?? null;
  const committed = entered !== null || hold?.resolution === "ENTERED_BY_HAND";
  const holdReady = inSession && hold !== undefined && hold.state === "OPEN";
  // The session run's own field, never the showcase's (./field-id.ts); none until something names it.
  const servedFields = useQuery({
    queryKey: ["by-hand-fields", session.session?.workspaceId, runSlug, serial, view?.state],
    enabled: inSession && view?.state === "IN_REVIEW" && adapter.source === "http",
    queryFn: async ({ signal }) => {
      const read = await adapter.api.request({
        name: "slip",
        path: `/v1/seasons/${encodeURIComponent(snapshot.season.label)}/slips/${encodeURIComponent(serial)}`,
        signal,
        schema: z.looseObject({
          slips: z.array(
            z.looseObject({
              serial: z.string(),
              fields: z.array(
                z.looseObject({
                  id: z.string(),
                  slipRowId: z.string(),
                  field: z.string(),
                  finalValue: z.string().nullable(),
                }),
              ),
            }),
          ),
        }),
      });
      return read.slips.flatMap((slip) => slip.fields.map((f) => ({ ...f, serial: slip.serial })));
    },
    retry: false,
  });
  const ready =
    holdReady ||
    (inSession &&
      adapter.source === "http" &&
      (servedFields.data?.some((f) => f.field === field.field && f.finalValue === null) ?? false));
  const fieldId = resolveFieldId({
    view,
    snapshot,
    serial,
    field: field.field,
    fields: adapter.source === "http" ? (servedFields.data ?? null) : mockWorldFields(),
  });
  const p = preview(value, tare, witness);
  const state: ByHandState = byHandState({ committed, skipped, value, preview: p });

  // MM-2's by-hand act plays on the server's live `field.entered`, with that event as its evidence: the press
  // is the person's (local), the ink is the server's. A repeat of the same event plays nothing.
  const liveEntry = useRef(false);
  useRunEvents(inSession ? runSlug : null, (event, meta) => {
    if (meta.replay || event.type !== "field.entered" || event.payload.serial !== serial) return;
    liveEntry.current = true;
    moment.play("by-hand", { eventId: event.id, kind: "sse" });
  });
  // A field entered before this page opened is history: it shows done, still, and plays nothing.
  const { phase, enter: enterPhase } = moment;
  useEffect(() => {
    if (committed && phase === "idle" && !liveEntry.current) enterPhase("done");
  }, [committed, phase, enterPhase]);

  usePrefocus(input, "W-TR-04", ready && !committed);

  // The field, its slab, Skip and Undo skip each go once answered, while they hold the keyboard: focus goes on
  // in that commit to what replaced them (WCAG 2.4.3). The ink once the value is entered (the Next link under it
  // when the run already names the next step), Undo skip after Skip, the field after Undo skip; a slab remounted
  // at rest after a failure takes its own focus back.
  const [entry, setEntry] = useState<HTMLElement | null>(null);
  useFocusAfterRemoval(entry, () => {
    const find = (id: string) => entry?.querySelector<HTMLElement>(`[data-testid="${id}"]`) ?? null;
    return [find("W-TR-04.next"), find("W-TR-04.committed"), find("W-TR-04.unskip"), input.current];
  });
  // Focus left on the ink when the run names the next step a moment later goes on to its Next link: Enter there
  // takes the judge on. A focus the person moved elsewhere meanwhile stays where they put it.
  const ink = useRef<HTMLDivElement>(null);
  const hasNext = Boolean(next && next.screen !== "W-TR-04" && next.actor === "person");
  useLayoutEffect(() => {
    const at = ink.current;
    if (!committed || !hasNext || !at || document.activeElement !== at) return;
    const link = at.querySelector<HTMLElement>('[data-testid="W-TR-04.next"]');
    if (link) focusAndReveal(link);
  }, [committed, hasNext]);

  // "Type the whole number" (and back to the mask) hands the keyboard to the field in the commit that switched
  // it: never on a timer, which can fire before React commits.
  const focusField = useRef(false);
  useLayoutEffect(() => {
    if (!focusField.current) return;
    focusField.current = false;
    if (input.current) focusAndReveal(input.current);
  });

  // The slot is selected so one keystroke replaces it: now, and again after a click has placed its caret.
  const selectSlot = useCallback(() => {
    const el = input.current;
    if (!el || whole || !mask) return;
    const select = () => {
      const at = el.value.indexOf(SLOT);
      if (at >= 0 && document.activeElement === el) el.setSelectionRange(at, at + 1);
    };
    select();
    setTimeout(select, 0);
  }, [whole, mask]);

  const commit = () => {
    if (!fieldId || !isComplete(value) || enter.isPending) return;
    setPressedAt(new Date().toISOString());
    enter.mutate({ params: { fieldId }, body: { value } });
  };

  const mismatch = p?.matches === false;
  let unavailable: string | undefined;
  if (!ready) unavailable = BY_HAND_COPY.notRead(serial);
  else if (!fieldId) unavailable = BY_HAND_COPY.noField(serial);
  else if (!isComplete(value)) unavailable = whole ? BY_HAND_COPY.needValue : BY_HAND_COPY.needDigit;
  // A value the logbook disagrees with cannot be entered here: this console computes the split, the lines root
  // the keys sign and every amount from the engine's checkpoint for the logbook's value, so a different value
  // would sign lines that are not the run's (I1) or never match the server's (W-TR-07). Until the API returns the
  // lines for the value typed, "Enter anyway" says why, and nothing is entered.
  else if (mismatch) unavailable = anyway ? BY_HAND_COPY.offPath : BY_HAND_COPY.checkBoth;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (unavailable === undefined) commit();
      return;
    }
    if (whole || !mask || event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      setValue(fillMask(mask.template, event.key));
      setFromLogbook(false);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      setValue(mask.template);
      setFromLogbook(false);
      setTimeout(selectSlot, 0);
      return;
    }
    if (event.key.length === 1) event.preventDefault();
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    if (whole || !mask) {
      setValue(next.replace(/[^\d.]/g, "").slice(0, 7));
      setFromLogbook(false);
      return;
    }
    // Mobile keyboards and IMEs skip keydown: take the digit they put in, wherever the caret was.
    const digit = insertedDigit(mask.template, next);
    if (digit) {
      setValue(fillMask(mask.template, digit));
      setFromLogbook(false);
    }
  };

  const useLogbook = () => {
    if (!witness) return;
    const gross = grossFromLogbook(witness, tare);
    if (!gross) return;
    setValue(gross);
    setFromLogbook(true);
    setAnyway(false);
    if (input.current) focusAndReveal(input.current);
  };

  const member = snapshot.members.find((m) => m.memberNo === field.slip.memberNo);
  // One line, the stand-in's reading as a figure, and the stand-in tag (its canonical phrase whole for readers).
  const prompt = (
    <>
      <span>{mask ? BY_HAND_COPY.promptLine : BY_HAND_COPY.promptLinePlain}</span>{" "}
      <span className="fsc-hand__reading fs-t-figure">{field.reading}</span>{" "}
      <span className="fsc-hand__tag fs-honesty fs-t-micro">
        <Glyph name="pencil" size={12} />
        <span>
          {BY_HAND_COPY.standInTag}
          <span className="fs-sr">{BY_HAND_COPY.standInRest}</span>
        </span>
      </span>
    </>
  );
  const enteredBy = entered?.enteredBy ?? hold?.resolvedBy ?? null;
  const officer =
    snapshot.officers.find((o) => o.initials === enteredBy) ??
    snapshot.officers.find((o) => o.role === "TREASURER");
  const shownValue = committed ? (entered?.value ?? field.slip.boxes["6"]) : value;
  const netAfter = entered?.derived.net_kg ?? (committed ? field.slip.boxes["8"] : null);
  const slabLabel =
    mismatch && anyway
      ? BY_HAND_COPY.enterAnyway(value)
      : BY_HAND_COPY.enter(isComplete(value) ? value : field.reading.replace("?", SLOT));
  const crop = cropBox();
  // The logbook's lines around the slip's own (5 to 9 for line 7): enough ledger to trust, small enough that
  // the crop, the witness line, the field and the slab all fit above the stage's ribbon.
  const lines = witness ? logbookWindow(witness.page, witness.lineNo) : null;

  return (
    <ScreenRoot id="W-TR-04" state={state} labelledBy="fsc-hand-title" className="fsc-hand">
      <header className="fsc-hand__head">
        <h1 id="fsc-hand-title" className="fs-t-title-1">
          {BY_HAND_COPY.title(serial)}
          <span className="fsc-hand__context"> {BY_HAND_COPY.titleContext}</span>
        </h1>
        <p className="fsc-hand__who fs-t-micro">
          {BY_HAND_COPY.who(member?.displayName ?? field.slip.memberNo, field.slip.memberNo)}
        </p>
      </header>

      <div className="fsc-hand__body" {...moment.rootProps} data-motion={mode}>
        <div className="fsc-hand__evidence" data-testid="W-TR-04.evidence">
          <figure className="fsc-hand__figure">
            <figcaption className="fs-t-micro fsc-hand__muted">{BY_HAND_COPY.crop(serial)}</figcaption>
            <Paper alt={BY_HAND_COPY.cropAlt(serial)} className="fsc-hand__crop" testId="W-TR-04.crop">
              <div
                className="fsc-hand__crop-frame"
                style={crop ? { aspectRatio: `${crop.w} / ${crop.h}` } : undefined}
              >
                <SlipPaper slip={field.slip} crop={crop} />
              </div>
            </Paper>
          </figure>
          {witness && lines && (
            <figure className="fsc-hand__figure">
              <figcaption className="fs-t-micro fsc-hand__muted">
                {BY_HAND_COPY.logbook(witness.page.page, lines.from, lines.to)}
              </figcaption>
              <Paper
                alt={BY_HAND_COPY.logbookAlt(witness.page.page, witness.lineNo, witness.netKgText)}
                className="fsc-hand__logbook"
                testId="W-TR-04.logbook"
              >
                <LogbookPaper page={witness.page} highlight={witness.lineNo} lines={lines} />
              </Paper>
            </figure>
          )}
        </div>

        <section
          ref={setEntry}
          className="fsc-hand__entry"
          aria-labelledby={`${inputId}-label`}
          data-testid="W-TR-04.entry"
        >
          <p className="fsc-hand__prompt" data-testid="W-TR-04.prompt">
            {prompt}
          </p>
          {committed ? (
            // Focusable from script only: the field's focus lands here when the value prints in ink.
            <div ref={ink} className="fsc-hand__committed" tabIndex={-1} data-testid="W-TR-04.committed">
              <p id={`${inputId}-label`} className="fs-t-label fsc-hand__muted">
                {BY_HAND_COPY.inputLabel(serial)}
              </p>
              <p className="fsc-hand__ink" data-amount-state="ink">
                {officer && (
                  <Stamp
                    stamp={{
                      initials: officer.initials,
                      name: officer.name,
                      at: entered ? format.time(entered.at) : pressedAt ? format.time(pressedAt) : "",
                    }}
                    testId="W-TR-04.stamp"
                  />
                )}
                <span className="fsc-hand__ink-value">{shownValue}</span>
              </p>
              <p className="fs-t-label fsc-hand__by" data-testid="W-TR-04.provenance">
                {fromLogbook && witness
                  ? BY_HAND_COPY.committedFrom(officer?.shortName ?? "Analyn", witness.lineNo)
                  : BY_HAND_COPY.committed(officer?.shortName ?? "Analyn")}
              </p>
              {netAfter && (
                <p className="fs-t-label fsc-hand__net" data-testid="W-TR-04.net">
                  {witness
                    ? `${BY_HAND_COPY.committedNet(netAfter)} ${
                        sameKilos(netAfter, witness.netKgText)
                          ? BY_HAND_COPY.matches(witness.page.page, witness.lineNo)
                          : BY_HAND_COPY.committedMismatch(witness.lineNo, witness.netKgText)
                      }`
                    : BY_HAND_COPY.committedNet(netAfter)}
                </p>
              )}
              {next && hasNext && (
                <p className="fsc-hand__next fs-t-label">
                  <span className="fsc-hand__next-mark" aria-hidden />
                  <AppLink href={next.to} className="fs-link" data-testid="W-TR-04.next">
                    {next.text}
                  </AppLink>
                </p>
              )}
            </div>
          ) : skipped ? (
            <div className="fsc-hand__skipped" data-testid="W-TR-04.skipped">
              <p id={`${inputId}-label`} className="fs-t-label">
                {BY_HAND_COPY.skipped(serial)}
              </p>
              <button
                type="button"
                className="fs-link fs-t-label"
                onClick={() => setSkipped(false)}
                data-testid="W-TR-04.unskip"
              >
                {BY_HAND_COPY.unskip}
              </button>
            </div>
          ) : (
            <>
              <label id={`${inputId}-label`} htmlFor={inputId} className="fs-t-label fsc-hand__label">
                {BY_HAND_COPY.inputLabel(serial)}
              </label>
              <div className="fsc-hand__field" data-state={state} data-mask={whole ? undefined : ""}>
                <input
                  ref={input}
                  id={inputId}
                  className="fsc-hand__input"
                  value={value}
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby={`${hintId} ${liveId}`}
                  aria-invalid={mismatch ? true : undefined}
                  disabled={!ready}
                  onKeyDown={onKeyDown}
                  onChange={onChange}
                  onFocus={selectSlot}
                  onClick={selectSlot}
                  onMouseUp={selectSlot}
                  data-testid="W-TR-04.input"
                />
              </div>
              {/* The caret in the box says it; the hint stays for screen readers (spec §3.5). */}
              <p id={hintId} className="fs-sr">
                {whole ? BY_HAND_COPY.inputHintWhole : BY_HAND_COPY.inputHint}
              </p>
              <p
                id={liveId}
                className="fsc-hand__live fs-t-label"
                aria-live="polite"
                data-testid="W-TR-04.live"
                data-state={state}
              >
                {p ? (
                  <>
                    <span className="fsc-hand__sum">{BY_HAND_COPY.live(p.gross, p.tare, p.net)}</span>{" "}
                    {witness ? (
                      p.matches ? (
                        <span>{BY_HAND_COPY.matches(witness.page.page, witness.lineNo)}</span>
                      ) : (
                        <span className="fsc-hand__mismatch">
                          {BY_HAND_COPY.mismatch(p.net, witness.lineNo, witness.netKgText)}
                        </span>
                      )
                    ) : (
                      <span>{BY_HAND_COPY.noWitness}</span>
                    )}
                  </>
                ) : null}
              </p>
              <div className="fsc-hand__links">
                {witness && (
                  <button
                    type="button"
                    className="fs-link fs-t-label"
                    onClick={useLogbook}
                    disabled={!ready}
                    data-used={fromLogbook ? "" : undefined}
                    data-testid="W-TR-04.useLogbook"
                  >
                    {BY_HAND_COPY.useLogbook(witness.lineNo)}
                  </button>
                )}
                {mask && (
                  <button
                    type="button"
                    className="fs-link fs-t-label"
                    disabled={!ready}
                    onClick={() => {
                      setWhole((w) => !w);
                      setValue(whole ? mask.template : "");
                      setFromLogbook(false);
                      focusField.current = true;
                    }}
                    data-testid="W-TR-04.typeWhole"
                  >
                    {whole ? BY_HAND_COPY.useMask : BY_HAND_COPY.typeWhole}
                  </button>
                )}
                {mismatch && !anyway && (
                  <button
                    type="button"
                    className="fs-link fs-t-label"
                    onClick={() => setAnyway(true)}
                    data-testid="W-TR-04.anyway"
                  >
                    {BY_HAND_COPY.anywayOpen}
                  </button>
                )}
              </div>
              {mismatch && anyway && (
                <p className="fsc-hand__reason fs-t-caption" role="status" data-testid="W-TR-04.offPath">
                  {BY_HAND_COPY.offPath}
                </p>
              )}
              <div className="fsc-hand__commit">
                <Slab
                  key={attempt}
                  label={slabLabel}
                  srLabel={BY_HAND_COPY.enterSr(isComplete(value) ? value : field.reading, serial)}
                  depth="d2"
                  tone="chalk"
                  testId="W-TR-04.commit"
                  unavailableReason={unavailable}
                  onCommit={commit}
                />
                {!ready && (
                  <AppLink
                    href={webRoutes.reading(snapshot.season.label, field.slip.photoId)}
                    className="fs-link fs-t-label"
                  >
                    {BY_HAND_COPY.readFirst}
                  </AppLink>
                )}
                {ready && (
                  <button
                    type="button"
                    className="fs-link fs-t-caption fsc-hand__skip"
                    onClick={() => setSkipped(true)}
                    data-testid="W-TR-04.skip"
                  >
                    {BY_HAND_COPY.skip}
                  </button>
                )}
              </div>
              {enter.isPending && (
                <p className="fs-t-caption fsc-hand__muted" role="status">
                  {BY_HAND_COPY.sending}
                </p>
              )}
              <CommandNotice error={enter.error} testId="W-TR-04.error" onRetry={commit} />
            </>
          )}
        </section>
      </div>
    </ScreenRoot>
  );
}
