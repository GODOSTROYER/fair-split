// G1 motion studies for MM-5 (Two keys) and MM-1 (Bayad na). Every frame comes from poseAt(), which evaluates
// @fairsplit/motion's timelines with the closed-form springs, so any instant renders statically
// (/prototype/moments/MM-5?t=1600) and the play button walks the same frames in real time. The shell's
// motion switch picks the renderer: full, reduced motion or the low tier.

import { type Lang, translate } from "@fairsplit/i18n";
import {
  MOMENT_INFO,
  type MomentId,
  type MotionMode,
  phaseTimes,
  poseOfStudy,
  STUDIES,
  type StudyId,
  TIMELINES,
} from "@fairsplit/motion";
import {
  feedback,
  Glyph,
  MomentRoot,
  PhoneFrame,
  Seal,
  Slab,
  type SlabFrame,
  UiProvider,
  useMotionMode,
} from "@fairsplit/ui-web";
import { useNavigate } from "@tanstack/react-router";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { approveConfirm, en } from "../content.js";
import { BATCH_SHA256, PEOPLE, SEASON, TOTALS } from "../fixture.js";
import { money, usd } from "../format.js";
import { PageTitle, Section, useProtoSearch } from "../Shell.js";
import type { StudyMomentId } from "../search.js";
import { MemberStatement } from "../statement.js";
import "../moments.css";

const STUDY_OF: Readonly<Record<StudyMomentId, readonly StudyId[]>> = {
  "MM-5": ["MM-5", "MM-5-early", "MM-5-disarmed"],
  "MM-1": ["MM-1"],
};

export function MomentStudyPage({ id }: { readonly id: StudyMomentId }) {
  const search = useProtoSearch();
  const studies = STUDY_OF[id];
  const studyId: StudyId = (studies as readonly string[]).includes(search.study ?? "")
    ? (search.study as StudyId)
    : (studies[0] as StudyId);
  const info = MOMENT_INFO[id as MomentId];
  return (
    <div data-testid={`W-DP-01.moment.${id}`}>
      <PageTitle
        title={`${info.name} (${id})`}
        lede={
          <>
            {info.trigger}. What it proves: {info.proves}. On {info.screens.join(", ")}.
          </>
        }
      />
      <Study key={studyId} moment={id} studyId={studyId} studies={studies} />
    </div>
  );
}

function Study({
  moment,
  studyId,
  studies,
}: {
  readonly moment: StudyMomentId;
  readonly studyId: StudyId;
  readonly studies: readonly StudyId[];
}) {
  const search = useProtoSearch();
  const navigate = useNavigate();
  const mode = useMotionMode();
  const study = STUDIES[studyId];
  const [t, setT] = useState(() => Math.min(search.t ?? 0, study.duration));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const lastT = useRef(t);
  const pose = useMemo(() => poseOfStudy(studyId, t, mode), [studyId, t, mode]);
  const phases = useMemo(() => phaseTimes(study.moment, study.cues, mode), [study, mode]);
  const events = poseOfStudy(studyId, study.duration, mode).fired;

  const commitTime = useCallback(
    (next: number) =>
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({ ...prev, t: Math.round(next), study: studyId }),
        replace: true,
      }),
    [navigate, studyId],
  );

  // Real-time playback: the same poses, advanced by requestAnimationFrame. Feedback fires as events pass.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const dt = (now - previous) * speed;
      previous = now;
      setT((current) => {
        const next = Math.min(study.duration, current + dt);
        for (const e of events)
          if (e.at > lastT.current && e.at <= next) feedback.play(e.event, { index: 0 });
        lastT.current = next;
        if (next >= study.duration) setPlaying(false);
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, study.duration, events]);

  useEffect(() => {
    if (!playing) commitTime(t);
  }, [playing, t, commitTime]);

  const play = () => {
    if (t >= study.duration) {
      setT(0);
      lastT.current = 0;
    }
    setPlaying(true);
  };

  return (
    <>
      {studies.length > 1 && (
        <fieldset className="mo-studies proto-group" aria-label="Study">
          {studies.map((s) => (
            <button
              key={s}
              type="button"
              className="mo-studies__option fs-t-label"
              aria-pressed={s === studyId}
              onClick={() =>
                void navigate({
                  to: ".",
                  search: (prev: Record<string, unknown>) => ({ ...prev, study: s, t: 0 }),
                  replace: true,
                })
              }
            >
              {STUDIES[s].title}
            </button>
          ))}
        </fieldset>
      )}
      <MomentRoot id={study.moment} phase={pose.phase} className="mo-stage" testId="W-DP-01.study">
        {moment === "MM-5" ? <TwoKeysFrame values={pose.values} phase={pose.phase} mode={mode} /> : null}
        {moment === "MM-1" ? <BayadNaFrame values={pose.values} phase={pose.phase} /> : null}
      </MomentRoot>

      <div className="mo-transport">
        <div className="mo-transport__controls">
          <button
            type="button"
            className="fs-flat"
            onClick={() => (playing ? setPlaying(false) : play())}
            data-testid="W-DP-01.study.play"
          >
            <Glyph name={playing ? "ms:pause" : "ms:play-arrow"} size={18} />
            {playing ? "Pause" : t >= study.duration ? "Play again" : "Play"}
          </button>
          <button
            type="button"
            className="fs-flat"
            onClick={() => {
              setPlaying(false);
              setT(0);
              lastT.current = 0;
            }}
          >
            <Glyph name="ms:restart-alt" size={18} />
            Start
          </button>
          <fieldset className="mo-speed proto-group" aria-label="Speed">
            {[1, 0.25].map((s) => (
              <button
                key={s}
                type="button"
                className="mo-speed__option fs-t-label"
                aria-pressed={speed === s}
                onClick={() => setSpeed(s)}
              >
                {s === 1 ? "Real time" : "Quarter speed"}
              </button>
            ))}
          </fieldset>
          <p className="mo-now">
            <span className="fs-t-figure" data-testid="W-DP-01.study.t">
              {Math.round(t).toLocaleString("en")} ms
            </span>
            <span className="mo-now__phase fs-t-label" data-testid="W-DP-01.study.phase">
              {pose.phase}
            </span>
          </p>
        </div>
        <div className="mo-track">
          <input
            type="range"
            min={0}
            max={study.duration}
            step={10}
            value={Math.round(t)}
            aria-label="Time in the study, in milliseconds"
            onChange={(e) => {
              setPlaying(false);
              const next = Number(e.currentTarget.value);
              setT(next);
              lastT.current = next;
            }}
            className="mo-track__range"
          />
          <ol className="mo-track__phases" aria-label="Phases">
            {phases.map((p, i) => (
              <li
                key={`${p.phase}-${p.at}`}
                className="mo-track__phase"
                data-row={i % 2}
                style={{ left: `${(p.at / study.duration) * 100}%` } as CSSProperties}
              >
                <button
                  type="button"
                  className="mo-track__tick fs-t-caption"
                  aria-current={pose.phase === p.phase ? "step" : undefined}
                  onClick={() => {
                    setPlaying(false);
                    setT(p.at);
                    lastT.current = p.at;
                  }}
                >
                  {p.phase}
                </button>
              </li>
            ))}
          </ol>
          <ol className="mo-track__events" aria-hidden>
            {events.map((e) => (
              <li
                key={`${e.event}-${e.at}`}
                style={{ left: `${(e.at / study.duration) * 100}%` }}
                title={e.event}
              />
            ))}
          </ol>
        </div>
      </div>

      <Section title="Phases" brief={study.note}>
        <table className="proto-table mo-phases">
          <thead>
            <tr>
              <th scope="col">Phase</th>
              <th scope="col">At</th>
              <th scope="col">Sound and haptics</th>
            </tr>
          </thead>
          <tbody>
            {phases.map((p) => (
              <tr key={`${p.phase}-${p.at}`} data-current={pose.phase === p.phase ? "" : undefined}>
                <td className="fs-t-label">{p.phase}</td>
                <td className="fs-t-figure">{p.at.toLocaleString("en")} ms</td>
                <td className="fs-t-caption">
                  {events
                    .filter(
                      (e) =>
                        e.at >= p.at &&
                        e.at < (phases[phases.indexOf(p) + 1]?.at ?? Number.POSITIVE_INFINITY),
                    )
                    .map((e) => e.event)
                    .join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Variants"
        brief="Every renderer emits the same phases at the same times; only what is drawn between them changes."
      >
        <dl className="proto-dl">
          <dt>Reduced motion</dt>
          <dd>{MOMENT_INFO[study.moment].reducedMotion}.</dd>
          <dt>Low tier</dt>
          <dd>{MOMENT_INFO[study.moment].lowTier}.</dd>
          <dt>Assertion</dt>
          <dd>{MOMENT_INFO[study.moment].assertion}.</dd>
          <dt>Timeline</dt>
          <dd>
            {TIMELINES[study.moment].acts.length} acts in <code>packages/motion/src/timelines.ts</code>. The
            phases are the <code>data-moment-phase</code> values tests wait on (IC-10).
          </dd>
        </dl>
      </Section>
    </>
  );
}

// ------------------------------------------------------------------------------------------- MM-5 frame

const RING_COUNT = 5;

function TwoKeysFrame({
  values: v,
  phase,
  mode,
}: {
  readonly values: Readonly<Record<string, number>>;
  readonly phase: string;
  readonly mode: MotionMode;
}) {
  const search = useProtoSearch();
  const lang: Lang = search.lang ?? "ceb";
  const amount = money(TOTALS.paypalCents);
  const val = (k: string) => v[k] ?? 0;
  const keys = (
    phase === "signed-2" || phase === "sealed" || phase === "inked"
      ? 2
      : ["signed-1", "waiting-2", "hold-2", "armed-2", "confirm-2"].includes(phase)
        ? 1
        : 0
  ) as 0 | 1 | 2;
  const reduced = mode === "reduced";

  // The slab reads "Release to sign" from armed until the person lets go inside; the phase then waits on
  // approval.signed, with the face flush and the label back.
  const consoleSlab: SlabFrame = (() => {
    if (phase === "blocked") return { state: "unavailable", travel: 8 };
    if (phase === "rising" || phase === "ready")
      return { state: "rest", travel: 8 - val("slab.edge"), edgeOpacity: val("slab.edgeOpacity") };
    if (phase === "released-early" || phase === "disarmed")
      return {
        state: "rest",
        travel: val("slab.travel"),
        fill: val("slab.fill"),
        notice: phase === "disarmed" ? "disarmed" : "early",
      };
    if (phase === "hold-1")
      return {
        state: "holding",
        travel: val("slab.travel"),
        fill: val("slab.fill"),
        step: reduced ? val("slab.step") : undefined,
        edgeOpacity: val("slab.edgeOpacity"),
      };
    if (phase === "armed-1" && val("slab.released") < 1)
      return { state: "armed", travel: val("slab.travel"), fill: 1, step: reduced ? 1 : undefined };
    return { state: "committed", travel: reduced ? 0 : 8, fill: 1, edgeOpacity: val("slab.edgeOpacity") };
  })();

  const phoneSlab: SlabFrame = (() => {
    if (phase === "hold-2")
      return {
        state: "holding",
        travel: val("phone.travel"),
        fill: val("phone.fill"),
        step: reduced ? val("phone.step") : undefined,
      };
    if (phase === "armed-2" && val("phone.released") < 1)
      return { state: "armed", travel: val("phone.travel"), fill: 1, step: reduced ? 1 : undefined };
    if (["armed-2", "signed-2", "sealed", "inked"].includes(phase))
      return { state: "committed", travel: reduced ? 0 : 8, fill: 1, edgeOpacity: reduced ? 0 : 1 };
    return { state: "rest" };
  })();

  const sealFrame = {
    rings: Array.from({ length: RING_COUNT }, (_, i) => val(`ring${i}`)),
    opacity: Array.from({ length: RING_COUNT }, (_, i) => val(`ring${i}.opacity`)),
    scale: v["seal.scale"] ?? 1,
  };
  const approved = val("label.approved");
  const presence = val("presence");
  const inked = val("inked");
  const m = (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) =>
    translate(lang, key, values);
  const coSign = m("M-BD-01.push", {
    season: SEASON.code,
    count: TOTALS.paypalCount,
    amount: usd(TOTALS.paypalCents),
  });
  const coSignWhy = m("M-BD-01.why", { threshold: "US$300" });

  return (
    <div className="mo-mm5">
      <section className="mo-console" aria-label="Console, W-TR-07">
        <p className="mo-surface fs-t-caption">Console, W-TR-07</p>
        <Seal
          batchSha256={BATCH_SHA256}
          size={180}
          keys={keys}
          frame={sealFrame}
          testId="MM-5.seal.console"
        />
        <div className="mo-console__amount fs-t-amount-l" style={{ color: mix(inked) }}>
          {amount.display}
        </div>
        <Slab
          label={en("W-TR-07.approve", { count: 8 })}
          srLabel={`${en("W-TR-07.approve", { count: 8 })}, ${amount.spoken}, moves money`}
          depth="d3"
          tone="jade"
          hold={1600}
          size="l"
          width={420}
          unavailableReason={phase === "blocked" ? en("W-TR-07.blocked") : undefined}
          testId="MM-5.slab.console"
          onCommit={() => undefined}
          confirm={approveConfirm()}
          frame={consoleSlab}
        />
        <div className="mo-keys">
          <p className="mo-key fs-t-label">
            {keys >= 1 ? <span className="fs-stamp fs-t-stamp">AS</span> : <Glyph name="seal" size={18} />}
            <span className="mo-key__text">
              <span>{en("W-TR-07.key.treasurer")}</span>
              <span className="fs-t-caption mo-muted">
                {keys >= 1 ? en("W-TR-07.key.signed", { time: "10:31" }) : en("W-TR-07.key.demo")}
              </span>
            </span>
          </p>
          <p className="mo-key fs-t-label">
            {keys >= 2 ? <span className="fs-stamp fs-t-stamp">EC</span> : <Glyph name="seal" size={18} />}
            <span className="mo-key__text">
              <span>{en("W-TR-07.key.chair")}</span>
              <span className="mo-crossfade fs-t-caption">
                <span style={{ opacity: 1 - approved }}>
                  {keys >= 1 ? en("W-TR-07.waiting") : en("W-TR-07.key.waiting")}
                </span>
                <span style={{ opacity: approved }} aria-hidden={approved < 0.5}>
                  {en("W-TR-07.approved")}
                </span>
              </span>
            </span>
          </p>
        </div>
        <p
          className="mo-presence fs-t-label"
          style={{
            opacity: presence,
            transform: reduced ? undefined : `translateY(${(1 - presence) * 10}px)`,
          }}
        >
          <Glyph name="ms:visibility" size={18} />
          {en("W-TR-07.presence", { hold: 2 })}
        </p>
        <p className="mo-inked fs-t-figure" style={{ color: mix(inked) }}>
          <span className="fs-sr">Grid figures: </span>
          <span>64.45</span>
          <span>62.71</span>
          <span>55.96</span>
          <span>55.63</span>
        </p>
      </section>
      <section className="mo-phone" aria-label="Chair's phone, M-BD-02">
        <p className="mo-surface fs-t-caption">Chair’s phone, M-BD-02</p>
        <PhoneFrame label="Chair frame: Ernesto P. Cabahug" width={340} height={600} testId="MM-5.phone">
          <UiProvider lang={lang} motion={search.motion ?? "system"}>
            <div className="mo-chair" lang={lang}>
              <p className="fs-t-label">{coSign}</p>
              <p className="fs-t-caption mo-muted">{coSignWhy}</p>
              <div className="mo-chair__seal">
                <Seal
                  batchSha256={BATCH_SHA256}
                  size={128}
                  keys={keys}
                  frame={sealFrame}
                  testId="MM-5.seal.phone"
                />
              </div>
              <p className="fs-t-caption mo-muted">{m("M-BD-01.analyn")}</p>
              <div className="mo-chair__slab">
                <Slab
                  label={m("M-BD-02.sign")}
                  srLabel={`${m("M-BD-02.sign")}, ${amount.spoken}`}
                  depth="d3"
                  tone="jade"
                  hold={1200}
                  size="l"
                  width="100%"
                  hint={false}
                  testId="MM-5.slab.phone"
                  onCommit={() => undefined}
                  confirm={{
                    title: coSign,
                    body: <p>{coSignWhy}</p>,
                    confirmLabel: m("M-BD-02.sign"),
                    seal: { batchSha256: BATCH_SHA256, keys: 1 },
                  }}
                  frame={phoneSlab}
                />
                <p className="fs-t-caption mo-muted">
                  {keys >= 2 ? m("M-BD-02.signed", { key: PEOPLE.chair.keyId }) : m("M-BD-02.hint")}
                </p>
                <p className="fs-t-caption mo-muted">{m("M-BD-02.demo")}</p>
              </div>
            </div>
          </UiProvider>
        </PhoneFrame>
      </section>
    </div>
  );
}

/** Pencil to ink as one colour mix: the sheet inks when both keys are in. */
function mix(inked: number): string {
  const p = Math.round(Math.max(0, Math.min(1, inked)) * 100);
  return `color-mix(in oklab, var(--fs-ink) ${p}%, var(--fs-pencil))`;
}

// ------------------------------------------------------------------------------------------- MM-1 frame

function BayadNaFrame({
  values: v,
  phase,
}: {
  readonly values: Readonly<Record<string, number>>;
  readonly phase: string;
}) {
  const search = useProtoSearch();
  const lang: Lang = search.lang ?? "ceb";
  const val = (k: string) => v[k] ?? 0;
  const done = phase === "done";
  return (
    <div className="mo-mm1">
      <section className="mo-phone" aria-label="Member's phone, M-MB-01">
        <p className="mo-surface fs-t-caption">Member’s phone, M-MB-01</p>
        <PhoneFrame label="Member frame: Nang Celing, M-014" width={360} height={720} testId="MM-1.phone">
          <MemberStatement
            lang={lang}
            state={done ? "paid" : "sent"}
            motion={search.motion ?? "system"}
            testId="MM-1.statement"
            frame={
              done
                ? undefined
                : {
                    capsule: {
                      inset: val("capsule.inset"),
                      flood: val("flood.scale"),
                      floodOpacity: val("flood.opacity"),
                      label: val("label.paid"),
                    },
                    solid: val("amount.solid"),
                    invite: val("invite.ring"),
                  }
            }
          />
        </PhoneFrame>
      </section>
      <section className="mo-mm1__notes" aria-label="What happens">
        <ol className="proto-list">
          <li>0 ms: the capsule takes PayPal’s press; its 5 px inset closes in 90 ms.</li>
          <li>90 ms: jade floods it from the bottom-right corner over 140 ms.</li>
          <li>120 ms: the hollow amount fills in over 120 ms. No scaling, no counting.</li>
          <li>180 ms: the chime, with two haptics 90 ms apart on the phone.</li>
          <li>
            400 ms: the words cross to “
            {translate(lang, "M-MB-01.paid", { date: lang === "en" ? "30 Oct" : "30 Okt" })}”.
          </li>
          <li>900 ms: one 1 px ink ring pulses on Paminawa, the next thing to do.</li>
        </ol>
        <p className="proto-note">
          The same item.updated event updates the console grid and the Proof counter within 100 ms; nothing
          moves before PayPal’s webhook passes our signature check.
        </p>
      </section>
    </div>
  );
}
