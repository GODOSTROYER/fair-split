// The five primitives in every state, in both themes, under the shell's motion switch (G1). The first row of
// each section is live: it responds to pointer and keyboard exactly as the product will.

import { LINE_STATES, type LineState, translate } from "@fairsplit/i18n";
import {
  AmountDisplay,
  ConfidenceRing,
  HoldCard,
  InkStamp,
  MassBalanceDial,
  Print,
  RailBar,
  ReceiptBar,
  Seal,
  type SegmentId,
  Slab,
  type SlabFrame,
  StatusCapsule,
  StatusChip,
  UiProvider,
  useMotionMode,
} from "@fairsplit/ui-web";
import { type ReactNode, useState } from "react";
import { approveConfirm, heroLine, holdH1, holdH3, TwinEvidence } from "../content.js";
import { BATCH_SHA256, PEOPLE, TOTALS } from "../fixture.js";
import { money, percent, phpEstimate, usd } from "../format.js";
import { PageTitle, Section, useProtoSearch } from "../Shell.js";

function State({
  name,
  note,
  children,
}: {
  readonly name: string;
  readonly note?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="proto-state">
      <p className="proto-state__name fs-t-caption">
        <code>{name}</code>
        {note && <span>{note}</span>}
      </p>
      {children}
    </div>
  );
}

function Themed({ children }: { readonly children: (theme: "tablea" | "adlaw") => ReactNode }) {
  return (
    <div className="proto-panes">
      {(["tablea", "adlaw"] as const).map((theme) => (
        <div key={theme} className="proto-pane" data-theme={theme}>
          <p className="proto-pane__name">
            <span className="fs-t-label">{theme === "tablea" ? "Tablea" : "Adlaw"}</span>
          </p>
          {children(theme)}
        </div>
      ))}
    </div>
  );
}

const noop = () => undefined;

const SLAB_FRAMES: readonly { readonly name: string; readonly note: string; readonly frame: SlabFrame }[] = [
  { name: "rest", note: "edges at full depth", frame: { state: "rest" } },
  { name: "pressed", note: "face at (d, d)", frame: { state: "pressed", travel: 5 } },
  { name: "committed", note: "flush until the screen moves on", frame: { state: "committed", travel: 5 } },
  { name: "refusing", note: "bolted: shakes, never travels", frame: { state: "refusing" } },
];

function LiveSlabs() {
  const [round, setRound] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const note = (text: string) => setLog((l) => [text, ...l].slice(0, 4));
  return (
    <div className="prim-live">
      <div className="prim-live__row" key={round}>
        <Slab
          label="Request rescan"
          srLabel="Request rescan, can be undone"
          depth="d1"
          tone="chalk"
          testId="W-DP-01.live.d1"
          onCommit={() => note("d1 committed and sprang back")}
        />
        <Slab
          label="Count it once"
          srLabel="Count it once, changes a line"
          depth="d2"
          tone="chalk"
          testId="W-DP-01.live.d2"
          onCommit={() => note("d2 committed: stays flush")}
        />
        <Slab
          label="Add to Schedule A"
          srLabel="Add to Schedule A, bolted by BR 2026-04"
          depth="d2"
          tone="chalk"
          bolted
          testId="W-DP-01.live.bolted"
          onCommit={noop}
          onRefuse={() => note("bolted: refused, nothing moved")}
        />
        <Slab
          label="Approve 8 payouts"
          srLabel={`Approve 8 payouts, ${money(TOTALS.paypalCents).spoken}, moves money`}
          depth="d3"
          tone="jade"
          hold={1600}
          size="l"
          width={420}
          testId="W-DP-01.live.d3"
          onCommit={() => note("d3 held 1,600 ms: signed")}
          confirm={approveConfirm()}
        />
      </div>
      <div className="prim-live__log">
        <button type="button" className="fs-flat" onClick={() => setRound((r) => r + 1)}>
          Reset the interactive slabs
        </button>
        <ol className="prim-live__events fs-t-caption" aria-live="polite">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function SealDemo() {
  const [keys, setKeys] = useState<0 | 1 | 2>(0);
  return (
    <div className="prim-seal">
      <Seal batchSha256={BATCH_SHA256} size={200} keys={keys} engrave testId="W-DP-01.live.seal" />
      <div className="prim-seal__actions">
        <button type="button" className="fs-flat" disabled={keys > 0} onClick={() => setKeys(1)}>
          Sign key 1 (Analyn)
        </button>
        <button type="button" className="fs-flat" disabled={keys !== 1} onClick={() => setKeys(2)}>
          Sign key 2 (Ernesto)
        </button>
        <button type="button" className="fs-flat" onClick={() => setKeys(0)}>
          Reset
        </button>
      </div>
    </div>
  );
}

function ReceiptDemo() {
  const [active, setActive] = useState<SegmentId | undefined>();
  return (
    <div className="prim-receipts">
      <div style={{ maxWidth: 720 }}>
        <ReceiptBar
          line={heroLine()}
          onSegment={(id) => setActive(id)}
          active={active}
          testId="W-DP-01.receipt.wide"
        />
      </div>
      <div style={{ maxWidth: 320 }}>
        <ReceiptBar
          line={heroLine()}
          onSegment={(id) => setActive(id)}
          active={active}
          testId="W-DP-01.receipt.narrow"
        />
      </div>
    </div>
  );
}

function MotionLabel() {
  const mode = useMotionMode();
  return (
    <span className="fs-t-caption">
      Renderer: {mode === "full" ? "full" : mode === "reduced" ? "reduced motion" : "low tier"}
    </span>
  );
}

export function PrimitivesPage() {
  const search = useProtoSearch();
  const lang = search.lang ?? "ceb";
  const motion = search.motion ?? "system";
  const member = (node: ReactNode) => (
    <UiProvider lang={lang} motion={motion}>
      {node}
    </UiProvider>
  );
  const h1 = (state: Parameters<typeof holdH1>[0]) => holdH1(state);
  const actions = (id: string) =>
    [
      {
        kind: "slab",
        label: "Count it once",
        srLabel: "Count it once, changes a line",
        onCommit: noop,
        testId: `${id}.once`,
      },
      {
        kind: "flat",
        label: "These are two deliveries",
        note: "Needs a reason, then the Chair",
        onSelect: noop,
        testId: `${id}.two`,
      },
    ] as const;
  const stamp = { initials: PEOPLE.treasurer.initials, name: PEOPLE.treasurer.name, at: "10:24" };
  const m = (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) =>
    translate(lang, key, values);
  const date = lang === "en" ? "30 Oct" : "30 Okt";
  return (
    <div data-testid="W-DP-01.primitives">
      <PageTitle
        title="Primitives"
        lede={
          <>
            Five primitives that everything else is built from, each with one contract and two implementations
            (this is the web one). Every state exposes <code>data-testid</code> and <code>data-state</code>.{" "}
            <MotionLabel />.
          </>
        }
      />

      <Section
        title="Slab"
        brief="A human commit. Depth equals consequence: d1 can be undone, d2 changes a line, d3 moves money or signs. Hold slabs commit in four ratchet steps and always offer a dialog route. Try Space, Enter and Tab."
        testId="W-DP-01.slab"
      >
        <LiveSlabs />
        <Themed>
          {(theme) => (
            <div className="proto-states">
              {SLAB_FRAMES.map((s) => (
                <State key={s.name} name={s.name} note={s.note}>
                  <Slab
                    label={s.name === "refusing" ? "Add to Schedule A" : "Count it once"}
                    srLabel="Count it once"
                    depth="d2"
                    tone="chalk"
                    bolted={s.name === "refusing"}
                    testId={`W-DP-01.slab.${theme}.${s.name}`}
                    onCommit={noop}
                    frame={s.frame}
                  />
                </State>
              ))}
              <State name="bolted" note="steel edges, zero travel">
                <Slab
                  label="Add to Schedule A"
                  srLabel="Add to Schedule A, bolted"
                  depth="d2"
                  tone="chalk"
                  bolted
                  testId={`W-DP-01.slab.${theme}.bolted`}
                  onCommit={noop}
                />
              </State>
              <State name="unavailable" note="flush, hatched, with a reason">
                <Slab
                  label="Approve 8 payouts"
                  srLabel="Approve 8 payouts"
                  depth="d3"
                  tone="jade"
                  hold={1600}
                  confirm={approveConfirm()}
                  unavailableReason="Resolve 1 hold that changes kilos first"
                  onReasonClick={noop}
                  testId={`W-DP-01.slab.${theme}.unavailable`}
                  onCommit={noop}
                />
              </State>
              {[0.25, 0.5, 0.75].map((p) => (
                <State key={p} name={`holding ${p * 100}%`} note={`face sunk ${p * 8} px`}>
                  <Slab
                    label="Approve 8 payouts"
                    srLabel="Approve 8 payouts"
                    depth="d3"
                    tone="jade"
                    hold={1600}
                    confirm={approveConfirm()}
                    testId={`W-DP-01.slab.${theme}.holding-${p * 100}`}
                    onCommit={noop}
                    frame={{ state: "holding", travel: p * 8, fill: p }}
                  />
                </State>
              ))}
              <State name="holding 50%, reduced" note="a stepped bar; no travel">
                <Slab
                  label="Approve 8 payouts"
                  srLabel="Approve 8 payouts"
                  depth="d3"
                  tone="jade"
                  hold={1600}
                  confirm={approveConfirm()}
                  testId={`W-DP-01.slab.${theme}.reduced`}
                  onCommit={noop}
                  frame={{ state: "holding", travel: 0, fill: 0.5, step: 0.5 }}
                />
              </State>
              <State name="released early" note="springs back, says why">
                <Slab
                  label="Approve 8 payouts"
                  srLabel="Approve 8 payouts"
                  depth="d3"
                  tone="jade"
                  hold={1600}
                  confirm={approveConfirm()}
                  testId={`W-DP-01.slab.${theme}.early`}
                  onCommit={noop}
                  frame={{ state: "rest", notice: "early" }}
                />
              </State>
              <State name="committed d3" note="clunked flush, signed">
                <Slab
                  label="Approve 8 payouts"
                  srLabel="Approve 8 payouts"
                  depth="d3"
                  tone="jade"
                  hold={1600}
                  confirm={approveConfirm()}
                  testId={`W-DP-01.slab.${theme}.d3-committed`}
                  onCommit={noop}
                  frame={{ state: "committed", travel: 8, fill: 1 }}
                />
              </State>
            </div>
          )}
        </Themed>
      </Section>

      <Section
        title="Print"
        brief="What machines say: flat text with no container and never a button, always with its provenance. Pencil until the two keys turn it to ink; hollow when approved but not yet received; a You cell when the read is below 0.85."
        testId="W-DP-01.print"
      >
        <Themed>
          {() => (
            <div className="proto-states">
              <State name="pencil" note="Claude’s reading">
                <Print
                  value="38.45"
                  provenance="claude"
                  state="pencil"
                  typeRole="amount-l"
                  footer="Read by Claude (claude-opus-5-5)"
                />
              </State>
              <State name="pencil" note="the engine’s figure">
                <Print
                  value="US$64.45"
                  provenance="engine"
                  state="pencil"
                  typeRole="amount-l"
                  footer="Computed by engine v1, rate card 7f3a 91c2"
                />
              </State>
              <State name="ink" note="after the two keys">
                <Print
                  value="US$64.45"
                  provenance="engine"
                  state="ink"
                  typeRole="amount-l"
                  footer="Approved by AS and EC"
                />
              </State>
              <State name="hollow" note="approved, not received">
                <Print value="US$64.45" provenance="engine" state="hollow" typeRole="amount-l" />
              </State>
              <State name="You" note="read at 0.40, a person enters it">
                <Print
                  value="6?.80"
                  provenance="claude"
                  state="pencil"
                  confidence={0.4}
                  footer="Read by Claude, 0.40"
                />
              </State>
              <State name="reveal" note="180 ms clip wipe, or a fade">
                <RevealDemo />
              </State>
            </div>
          )}
        </Themed>
      </Section>

      <Section
        title="Seal"
        brief="Five hypotrochoid rings grown from the batch digest. Key 1 engraves the inner three, key 2 the outer two; unsigned bands are 1 px rule circles. The same digest draws the same seal on every surface."
        testId="W-DP-01.seal"
      >
        <SealDemo />
        <Themed>
          {(theme) => (
            <div className="proto-states">
              {([0, 1, 2] as const).map((k) => (
                <State key={k} name={`${k} of 2`}>
                  <Seal
                    batchSha256={BATCH_SHA256}
                    size={160}
                    keys={k}
                    testId={`W-DP-01.seal.${theme}.${k}`}
                  />
                </State>
              ))}
              <State name="64 px" note="statement footer">
                <Seal batchSha256={BATCH_SHA256} size={64} keys={2} />
              </State>
            </div>
          )}
        </Themed>
      </Section>

      <Section
        title="ReceiptBar"
        brief="Why her number is her number, in reading order: kilos × rate, the protected premium, the bonus, ruled deductions as rule chips, credits, the net. Every segment can be tapped; narrow containers turn the row into a list. Words follow the member language switch."
        testId="W-DP-01.receipt"
      >
        {member(<ReceiptDemo />)}
      </Section>

      <Section
        title="HoldCard"
        brief="Two voices and one decision. The engine’s line carries every digit, from code; Claude’s line is pencil and has none. The gate says whether a hold blocks the run or reserves one line. Never an error, never red."
        testId="W-DP-01.hold"
      >
        <div className="prim-holds">
          <State name="open" note="H1, blocks approval">
            <HoldCard
              hold={h1("open")}
              gate="BLOCKS_APPROVAL"
              actions={actions("W-DP-01.hold.open")}
              evidence={<TwinEvidence compact />}
              testId="W-DP-01.hold.open"
            />
          </State>
          <State name="resolved" note="flush ink, the AS stamp">
            <HoldCard
              hold={h1("resolved")}
              gate="BLOCKS_APPROVAL"
              actions={actions("W-DP-01.hold.resolved")}
              resolution={stamp}
              testId="W-DP-01.hold.resolved"
            />
          </State>
          <State name="resolving" note="slab pressed, waiting for the recompute">
            <HoldCard
              hold={h1("resolving")}
              gate="BLOCKS_APPROVAL"
              actions={actions("W-DP-01.hold.resolving")}
              testId="W-DP-01.hold.resolving"
            />
          </State>
          <State name="asked-chair" note="the two-deliveries route">
            <HoldCard
              hold={h1("asked-chair")}
              gate="BLOCKS_APPROVAL"
              actions={actions("W-DP-01.hold.asked")}
              testId="W-DP-01.hold.asked"
            />
          </State>
          <State name="conflict" note="presence, not a lock">
            <HoldCard
              hold={h1("conflict")}
              gate="BLOCKS_APPROVAL"
              actions={actions("W-DP-01.hold.conflict")}
              testId="W-DP-01.hold.conflict"
            />
          </State>
          <State name="open" note="H3, reserves one line">
            <HoldCard
              hold={holdH3("open")}
              gate="RESERVES_LINE"
              actions={[
                {
                  kind: "slab",
                  label: "Return the ₱200 as a credit",
                  srLabel: "Return the ₱200 as a credit, changes a line",
                  onCommit: noop,
                  testId: "W-DP-01.hold.h3.return",
                  suggestedByClaude: true,
                },
              ]}
              testId="W-DP-01.hold.h3"
            />
          </State>
        </div>
      </Section>

      <Section
        title="Marks"
        brief="Built from the same tokens: status words (never a raw state), the statement capsule, amounts, ink stamps, confidence rings, the mass-balance dial and the rail bar."
        testId="W-DP-01.marks"
      >
        {member(
          <div className="prim-chips">
            {LINE_STATES.map((s: LineState) => (
              <StatusChip key={s} state={s} testId={`W-DP-01.chip.${s}`} />
            ))}
          </div>,
        )}
        <div className="prim-chips">
          {(["HELD", "OFF_RAIL_DUE", "UNCLAIMED", "PAID", "NEEDS_ACTION"] as const).map((s) => (
            <StatusChip key={s} state={s} surface="console" />
          ))}
        </div>
        <Themed>
          {() => (
            <div className="proto-states">
              <State name="capsule, sent" note="5 px inset, waiting for PayPal">
                <StatusCapsule state="sent" text={m("M-MB-01.sent", { elapsed: "0:14" })} lang={lang} />
              </State>
              <State name="capsule, paid" note="flush jade: PayPal confirmed">
                <StatusCapsule state="paid" text={m("M-MB-01.paid", { date })} lang={lang} />
              </State>
              <State name="capsule, checking">
                <StatusCapsule state="checking" text={m("M-MB-01.checking")} lang={lang} />
              </State>
              <State name="capsule, cash due">
                <StatusCapsule state="cash-due" text={m("M-MB-01.cashDue", { date })} lang={lang} />
              </State>
              <State name="amount, hollow">
                <AmountDisplay
                  amount={money(6445)}
                  estimate={m("money.estimate", { php: phpEstimate(6445) })}
                  hollow
                  lang={lang}
                />
              </State>
              <State name="amount, solid">
                <AmountDisplay
                  amount={money(6445)}
                  estimate={m("money.estimate", { php: phpEstimate(6445) })}
                  lang={lang}
                />
              </State>
              <State name="amount, pencil" note="before the keys">
                <AmountDisplay amount={money(TOTALS.paypalCents)} pencil />
              </State>
              <State name="ink stamp" note="hover for the time">
                <span className="prim-row">
                  <InkStamp stamp={{ initials: "AS", name: PEOPLE.treasurer.name, at: "10:24" }} />
                  <InkStamp stamp={{ initials: "EC", name: PEOPLE.chair.name, at: "10:31" }} />
                  <InkStamp stamp={{ initials: "JD", name: PEOPLE.clerk.name, at: "09:12" }} />
                </span>
              </State>
              <State name="confidence" note="0.97, 0.88, 0.40">
                <span className="prim-row">
                  <ConfidenceRing confidence={0.97} size={20} />
                  <ConfidenceRing confidence={0.88} size={20} />
                  <ConfidenceRing confidence={0.4} size={20} />
                </span>
              </State>
              <State name="mass balance" note="2.05% with 0457 twice">
                <MassBalanceDial
                  value={2.05}
                  display={percent(TOTALS.shrinkWithDuplicateBp)}
                  limitDisplay="Limit ±2.0%"
                  label="Shrink"
                />
              </State>
              <State name="mass balance" note="1.62% counted once">
                <MassBalanceDial
                  value={1.62}
                  display={percent(TOTALS.shrinkBp)}
                  limitDisplay="Limit ±2.0%"
                  label="Shrink"
                />
              </State>
              <State name="rail bar" note="before PayPal confirms">
                <RailBar
                  paypalShare={TOTALS.paypalCents / TOTALS.netCents}
                  paypalText="8 payouts by PayPal"
                  cashText={`56 members, ${usd(TOTALS.cashCents)}, cash at the bodega on 30 Oct`}
                  cashWord="Cash"
                />
              </State>
            </div>
          )}
        </Themed>
      </Section>
    </div>
  );
}

function RevealDemo() {
  const [n, setN] = useState(0);
  return (
    <div className="prim-reveal">
      <Print key={n} value="US$64.45" provenance="engine" state="pencil" typeRole="amount-l" reveal />
      <button type="button" className="fs-flat" onClick={() => setN((x) => x + 1)}>
        Print again
      </button>
    </div>
  );
}
