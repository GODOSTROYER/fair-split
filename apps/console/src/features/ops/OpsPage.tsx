// W-OP-01 /ops (S3.15): plain tables on stock primitives, Tablea. Health from /healthz and /readyz, the three kill
// switches, PayPal's notices with how each was checked, the outbox, and the treasurer's browser key. Read-only for
// judges: switches change from the treasurer's console or by the operator. Reads the API's ops slice hasn't shipped
// say so plainly; nothing polls (a person asks again with "Check again").

import { Glyph, type GlyphName, Slab } from "@fairsplit/ui-web";
import { type ReactNode, useId, useMemo } from "react";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { Wordmark } from "../../chrome/Wordmark.js";
import { useJudgeSession, useRunStream, useRunView, useSnapshot } from "../../data/hooks.js";
import type { PaypalRail } from "../../lib/env.js";
import { format } from "../../lib/format.js";
import { davaoShort } from "../proof/davao.js";
import { fingerprint } from "./keystore.js";
import {
  FLAG_WORDS,
  type FlagRow,
  flagRows,
  type HealthTone,
  healthRows,
  type NoticeRow,
  noticesFromEvents,
  noticesFromLedger,
  type OutboxRead,
  outboxSummary,
  type ReadOutcome,
} from "./opsModel.js";
import { type KeyPhase, type TreasurerKey, useHealth, useOutbox } from "./useOps.js";

export const OPS_COPY = {
  title: "Ops",
  lede: "Health, the kill switches, PayPal's notices, the outbox and the treasurer's key. Read-only for judges.",
  checkedAt: (time: string) => `Checked at ${time}, Davao time.`,
  checking: "Checking.",
  again: "Check again",
  health: "Health",
  switches: "Kill switches",
  switchesNote:
    "Read-only here. The treasurer pauses payouts from the console; the operator changes the rest. Every change is written to the ledger.",
  forced: "Forced on by FS_KILL",
  notices: "PayPal's notices",
  noticesSession: "This judge session's run, as its live stream delivers them.",
  noticesSeason: (run: string) => `The season's run ${run}, from its hash chain.`,
  noticesEmpty: "No PayPal notices yet. They arrive once the batch is posted.",
  outbox: "Outbox",
  outboxNotServed:
    "The outbox read isn't served by this API yet. It comes with the ops slice (GET /v1/ops/outbox).",
  outboxRefused: "Only the operator reads the outbox. It needs the operator's sign-in.",
  outboxDown: "The outbox didn't load.",
  outboxEmpty: "Nothing in the outbox.",
  key: "Treasurer's browser key",
  keyLede:
    "Analyn signs with fs-analyn-w1, an Ed25519 key made in this browser that can't be copied out. The operator registers its public half once.",
} as const;

const TONE_GLYPH: Readonly<Record<HealthTone, GlyphName>> = {
  ok: "ms:check",
  attention: "ms:help",
  paypal: "rail",
  quiet: "ms:schedule",
};

function Section({
  title,
  testId,
  children,
  aside,
}: {
  readonly title: string;
  readonly testId: string;
  readonly children: ReactNode;
  readonly aside?: ReactNode;
}) {
  const id = useId();
  return (
    <section className="op-section" aria-labelledby={id} data-testid={testId}>
      <header className="op-section__head">
        <h2 id={id} className="op-section__title">
          {title}
        </h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

function when(at: string | null): string {
  if (!at) return "";
  return davaoShort(at);
}

export interface OpsPageProps {
  readonly rail: PaypalRail;
  readonly treasurerKey: TreasurerKey;
}

export function OpsPage({ rail, treasurerKey }: OpsPageProps) {
  const health = useHealth();
  const outbox = useOutbox();
  const snapshot = useSnapshot().data;
  const session = useJudgeSession().session;
  const sessionRun = session?.runSlug ?? null;
  useRunStream(sessionRun);
  const runView = useRunView(sessionRun ?? "none").data;
  const events = sessionRun ? (runView?.events ?? []) : [];
  const forced = health.ready?.kind === "ok" ? (health.ready.data.checks.flags?.forcedByEnv ?? []) : [];
  const flags = useMemo(() => flagRows(events, forced), [events, forced]);
  const notices = useMemo<NoticeRow[]>(
    () =>
      sessionRun ? noticesFromEvents(events, rail) : noticesFromLedger(snapshot?.proof.ledger ?? [], rail),
    [sessionRun, events, rail, snapshot],
  );
  const rows = healthRows(health.live, health.ready);
  const railWords = rail === "simulator" ? "Simulated PayPal sandbox" : "PayPal sandbox";

  return (
    <div className="op">
      <header className="op-mast">
        <Wordmark compact />
        <div className="op-mast__row">
          <h1 className="op-mast__title" id="W-OP-01-title">
            {OPS_COPY.title}
          </h1>
          <span className="op-chip" data-testid="W-OP-01.rail">
            <Glyph name="rail" size={16} />
            {railWords}
          </span>
        </div>
        <p className="op-mast__lede">{OPS_COPY.lede}</p>
        <p className="op-mast__checked" data-testid="W-OP-01.checked">
          <span>
            {health.checking || !health.checkedAt
              ? OPS_COPY.checking
              : OPS_COPY.checkedAt(format.time(new Date(health.checkedAt).toISOString()))}
          </span>
          <button
            type="button"
            className="fs-flat"
            onClick={() => {
              health.refresh();
              void outbox.refetch();
            }}
            disabled={health.checking}
            data-testid="W-OP-01.refresh"
          >
            <Glyph name="ms:restart-alt" size={18} />
            {OPS_COPY.again}
          </button>
        </p>
      </header>

      <Section title={OPS_COPY.health} testId="W-OP-01.health">
        <table className="op-table">
          <caption className="fs-sr">Health checks: liveness, readiness and what readiness reports</caption>
          <thead>
            <tr>
              <th scope="col">Check</th>
              <th scope="col">Status</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-state={r.tone} data-testid={`W-OP-01.health.${r.key}`}>
                <th scope="row">{r.check}</th>
                <td>
                  <span className="op-status" data-tone={r.tone}>
                    <Glyph name={TONE_GLYPH[r.tone]} size={16} />
                    {r.status}
                  </span>
                </td>
                <td className="op-table__detail">{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={OPS_COPY.switches} testId="W-OP-01.switches">
        <p className="op-note">{OPS_COPY.switchesNote}</p>
        <table className="op-table">
          <caption className="fs-sr">The three kill switches, their state and what each does</caption>
          <thead>
            <tr>
              <th scope="col">Switch</th>
              <th scope="col">State</th>
              <th scope="col">What it does</th>
              <th scope="col">Set by</th>
            </tr>
          </thead>
          <tbody>
            {flags.map((f) => (
              <FlagLine key={f.flag} row={f} />
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title={OPS_COPY.notices}
        testId="W-OP-01.notices"
        aside={
          <p className="op-section__aside">
            {sessionRun ? OPS_COPY.noticesSession : OPS_COPY.noticesSeason(snapshot?.run.runSlug ?? "")}
          </p>
        }
      >
        {notices.length === 0 ? (
          <p className="op-empty" data-testid="W-OP-01.notices.empty">
            {OPS_COPY.noticesEmpty}
          </p>
        ) : (
          <div className="op-scroll">
            <table className="op-table" data-testid="W-OP-01.notices.table">
              <caption className="fs-sr">PayPal's notices, newest first, with how each was checked</caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Notice</th>
                  <th scope="col">Object</th>
                  <th scope="col">Status</th>
                  <th scope="col">How we know</th>
                  <th scope="col">Record</th>
                </tr>
              </thead>
              <tbody>
                {notices.map((n) => (
                  <tr key={n.id} data-duplicate={n.duplicate ? "" : undefined}>
                    <td className="op-num">{when(n.at)}</td>
                    <th scope="row" className="op-table__event">
                      {n.notice}
                      {n.paypalEventId && <span className="op-table__id">{n.paypalEventId}</span>}
                    </th>
                    <td className="op-num">{n.object}</td>
                    <td>{n.status}</td>
                    <td className="op-table__detail">{n.check}</td>
                    <td className="op-table__detail">{n.provenance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={OPS_COPY.outbox} testId="W-OP-01.outbox">
        <OutboxBlock outcome={outbox.data} />
      </Section>

      <Section title={OPS_COPY.key} testId="W-OP-01.key">
        <KeyPanel treasurerKey={treasurerKey} />
      </Section>
    </div>
  );
}

function FlagLine({ row }: { readonly row: FlagRow }) {
  const words = FLAG_WORDS[row.flag];
  return (
    <tr data-state={row.on ? "on" : "off"} data-testid={`W-OP-01.switch.${row.flag}`}>
      <th scope="row">{words.name}</th>
      <td>
        <span className="op-switch" data-on={row.on ? "" : undefined}>
          <Glyph name={row.on ? "ms:pause" : "ms:play-arrow"} size={16} />
          {row.on ? (row.forcedByEnv ? OPS_COPY.forced : "On: paused") : "Off: running"}
        </span>
      </td>
      <td className="op-table__detail">{words.effect}</td>
      <td className="op-table__detail">
        {row.by ? `${row.by}${row.at ? `, ${when(row.at)}` : ""}` : "No change recorded"}
      </td>
    </tr>
  );
}

function OutboxBlock({ outcome }: { readonly outcome: ReadOutcome<OutboxRead> | undefined }) {
  if (!outcome) return <p className="op-empty">{OPS_COPY.checking}</p>;
  if (outcome.kind === "not-served") {
    return (
      <p className="op-empty" data-testid="W-OP-01.outbox.not-served">
        <Glyph name="ms:schedule" size={16} />
        {OPS_COPY.outboxNotServed}
      </p>
    );
  }
  if (outcome.kind === "refused") {
    return (
      <p className="op-empty" data-testid="W-OP-01.outbox.refused">
        <Glyph name="ms:lock" size={16} />
        {OPS_COPY.outboxRefused}
      </p>
    );
  }
  if (outcome.kind === "down") {
    return (
      <p className="op-empty" data-testid="W-OP-01.outbox.down">
        <Glyph name="ms:help" size={16} />
        {OPS_COPY.outboxDown}
        {outcome.status ? ` The API answered ${outcome.status}.` : ""}
      </p>
    );
  }
  const rows = outcome.data.rows;
  const s = outboxSummary(rows);
  if (rows.length === 0) return <p className="op-empty">{OPS_COPY.outboxEmpty}</p>;
  return (
    <>
      <p className="op-note" data-testid="W-OP-01.outbox.summary">
        {s.queued} queued, {s.running} running, {s.dead} dead, {s.done} done
        {outcome.data.executor ? `. Executor ${outcome.data.executor}` : ""}
        {outcome.data.lastTickAt ? `. Last cron tick ${when(outcome.data.lastTickAt)}` : ""}.
      </p>
      <div className="op-scroll">
        <table className="op-table" data-testid="W-OP-01.outbox.table">
          <caption className="fs-sr">Outbox tasks, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">State</th>
              <th scope="col">Attempts</th>
              <th scope="col">Queued</th>
              <th scope="col">Last error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-state={r.state}>
                <th scope="row">{r.task}</th>
                <td>{r.state}</td>
                <td className="op-num">{r.attempts}</td>
                <td className="op-num">{when(r.createdAt)}</td>
                <td className="op-table__detail">{r.lastError ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const KEY_WORDS: Readonly<Record<KeyPhase["kind"], string>> = {
  checking: "Looking for the key in this browser.",
  unsupported: "This browser can't make Ed25519 keys. Use Chrome or Edge 137+, Firefox 129+ or Safari 17+.",
  none: "No treasurer key in this browser yet.",
  making: "Making the key in this browser.",
  made: "Made in this browser. Not registered yet.",
  registering: "Registering the public key with Fair Split's server.",
  registered: "Registered. The treasurer signs with it from this browser.",
  "not-served":
    "Made in this browser, not registered: the server's key registration isn't served yet (POST /v1/ops/keys).",
  refused: "Only the operator registers a treasurer key. It needs the operator's sign-in.",
  failed: "The key step failed. Nothing was registered.",
};

export function KeyPanel({ treasurerKey }: { readonly treasurerKey: TreasurerKey }) {
  const { phase, durable, make, register } = treasurerKey;
  const key = "key" in phase ? phase.key : null;
  const canRegister =
    key !== null &&
    (phase.kind === "made" ||
      phase.kind === "not-served" ||
      phase.kind === "refused" ||
      phase.kind === "failed");
  return (
    <div className="op-key" data-testid="W-OP-01.key.panel" data-state={phase.kind}>
      <p className="op-note">{OPS_COPY.keyLede}</p>
      <dl className="op-facts">
        <div>
          <dt>Key</dt>
          <dd className="op-num">fs-analyn-w1</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd data-testid="W-OP-01.key.status">{KEY_WORDS[phase.kind]}</dd>
        </div>
        {key && (
          <>
            <div>
              <dt>Fingerprint</dt>
              <dd className="op-num" data-testid="W-OP-01.key.fingerprint">
                {fingerprint(key.publicKeyHex)}
              </dd>
            </div>
            <div>
              <dt>Made</dt>
              <dd className="op-num">{when(key.createdAt)}</dd>
            </div>
            <div>
              <dt>Kept</dt>
              <dd>
                {durable
                  ? "In this browser's storage, non-extractable"
                  : "For this page only: this browser offers no key storage here"}
              </dd>
            </div>
          </>
        )}
      </dl>
      {phase.kind === "failed" && <CommandNotice error={phase.error} testId="W-OP-01.key.error" />}
      <div className="op-key__actions">
        {(phase.kind === "none" || (phase.kind === "failed" && !key)) && (
          <Slab
            label="Make the key in this browser"
            srLabel="Make the treasurer's key fs-analyn-w1 in this browser; it can't be copied out"
            depth="d1"
            tone="chalk"
            glyph="ms:fingerprint"
            testId="W-OP-01.key.make"
            onCommit={make}
          />
        )}
        {canRegister && (
          <Slab
            label="Register fs-analyn-w1"
            srLabel="Register the treasurer's public key with Fair Split's server, so her signatures are accepted"
            depth="d2"
            tone="chalk"
            glyph="seal"
            stayDown={false}
            testId="W-OP-01.key.register"
            onCommit={register}
          />
        )}
      </div>
    </div>
  );
}
