// W-OP-01 /ops (S3.15): plain tables on stock primitives, Tablea. Health from /healthz and /readyz, the three kill
// switches, PayPal (scopes, the limiter against 40 and 20 with the circuit and shared-IP 429s, webhook latency, the
// last reconciliation, estimated against observed balance), PayPal's notices with how each was checked, the outbox,
// Claude (spend per lane, the eval report), quotas, and the treasurer's browser key. Read-only for judges: only the
// operator's session makes or registers the key, and switches change from the treasurer's console or by the
// operator. A read the API hasn't shipped says so and names its route; nothing polls (a person asks again).

import type { PublishedKeys } from "@fairsplit/contracts";
import { Glyph, type GlyphName, Slab } from "@fairsplit/ui-web";
import { type ReactNode, useId, useMemo } from "react";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { PrintBed } from "../../chrome/PrintBed.js";
import { ScrollRegion } from "../../chrome/ScrollRegion.js";
import { Wordmark } from "../../chrome/Wordmark.js";
import { useJudgeSession, useRunStream, useRunView, useSnapshot } from "../../data/hooks.js";
import type { PaypalRail } from "../../lib/env.js";
import { format } from "../../lib/format.js";
import { fingerprint, TREASURER_KEY_ID } from "../../lib/keystore.js";
import { davaoShort } from "../proof/davao.js";
import {
  FLAG_WORDS,
  type FlagRow,
  flagRows,
  type HealthTone,
  healthRows,
  type NoticeRow,
  noticesFromEvents,
  noticesFromLedger,
  OPS_PATHS,
  type OpsVerdict,
  type OutboxRead,
  outboxSummary,
  type ReadOutcome,
} from "./opsModel.js";
import {
  balanceRows,
  claudeRows,
  evalCaption,
  evalRows,
  latencyRows,
  limiterRows,
  type OpsRow,
  quotaRows,
  reconciliationRows,
  registryKeyOf,
  SECTION_PATHS,
  scopeRows,
} from "./sections.js";
import {
  type KeyPhase,
  type SectionOutcomes,
  type TreasurerKey,
  useHealth,
  useOpsRefresh,
  useOutbox,
  usePublishedKeys,
  useSections,
} from "./useOps.js";

export const OPS_COPY = {
  title: "Ops",
  lede: "Health, the kill switches, PayPal, the outbox, Claude, quotas and the treasurer's key. Read-only for judges.",
  operator: "Operator",
  readOnly: "Read-only",
  checkedAt: (time: string) => `Checked at ${time}, Davao time.`,
  checking: "Checking.",
  again: "Check again",
  health: "Health",
  switches: "Kill switches",
  switchesNote:
    "Read-only here. The treasurer pauses payouts from the console; the operator changes the rest. Every change is written to the ledger.",
  forced: "Forced on by FS_KILL",
  paypal: "PayPal",
  scopes: "Scopes",
  scopesNote: "The OAuth scopes PayPal granted this app, against the ones its steps need.",
  limiter: "Limiter and circuit",
  limiterNote:
    "Every service shares one limiter: 40 PayPal calls a minute, 20 of them background. A 429 opens a 6-minute circuit.",
  latency: "Webhook latency",
  latencyNote: "From our own step to PayPal's notice, at the median and the 95th percentile.",
  reconciliation: "Last reconciliation",
  reconciliationNote: "Our record against PayPal's own, matched by transaction ID.",
  balance: "Balance",
  balanceNote: "Estimated against observed. PayPal has no balance API, so the estimate is labelled as one.",
  notices: "PayPal's notices",
  noticesSession: "This judge session's run, as its own stream delivers them.",
  noticesSeason: (run: string) => `The season's run ${run}, from its hash chain.`,
  noticesEmpty: "No PayPal notices yet. They arrive once the batch is posted.",
  outbox: "Outbox",
  outboxEmpty: "Nothing in the outbox.",
  claude: "Claude",
  spend: "Spend today",
  spendNote: "Each lane against its daily cap (UTC). A capped lane plays its labelled recording.",
  eval: "Eval",
  evalNote: "The reading eval's last report, against the bars it has to meet.",
  quotas: "Quotas",
  quotasNote:
    "Live runs are rationed to stay inside PayPal's limits. Over quota is a labelled replay, never a block.",
  key: "Treasurer's browser key",
  keyLede:
    "Analyn signs with fs-analyn-w1, an Ed25519 key made in her browser that can't be copied out. The operator registers its public half once.",
  keyLedeReadOnly:
    "Analyn signs with fs-analyn-w1, an Ed25519 key made in her browser that can't be copied out. Below is the key as Fair Split publishes it.",
  keyWho:
    "Read-only here. The operator registers this key once, from the treasurer's browser, signed in at /ops/login.",
  notServed: (route: string) => `Not served yet (GET ${route}).`,
  refused: "Only the operator reads this. It needs the operator's sign-in.",
  down: (status: number | null) =>
    `Didn't load. ${status ? `The API answered ${status}.` : "The API didn't answer."}`,
} as const;

const TONE_GLYPH: Readonly<Record<HealthTone, GlyphName>> = {
  ok: "ms:check",
  attention: "ms:help",
  paypal: "rail",
  quiet: "ms:schedule",
};

const VERDICT_GLYPH: Readonly<Record<OpsVerdict["state"], GlyphName>> = {
  loading: "ms:schedule",
  ready: "ms:check",
  degraded: "ms:help",
};

function Section({
  title,
  testId,
  children,
  aside,
  note,
  level = "h2",
}: {
  readonly title: string;
  readonly testId: string;
  readonly children: ReactNode;
  readonly aside?: ReactNode;
  readonly note?: string;
  readonly level?: "h2" | "h3";
}) {
  const id = useId();
  const Heading = level;
  return (
    <section className="op-section" aria-labelledby={id} data-testid={testId}>
      <header className="op-section__head">
        <Heading
          id={id}
          className={level === "h2" ? "op-section__title" : "op-section__title op-section__title--sub"}
        >
          {title}
        </Heading>
        {aside}
      </header>
      {note && <p className="op-note">{note}</p>}
      {children}
    </section>
  );
}

/** A heading over a grid of smaller sections (h3s): PayPal's figures, Claude's. */
function Group({
  title,
  testId,
  children,
}: {
  readonly title: string;
  readonly testId: string;
  readonly children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="op-group" aria-labelledby={id} data-testid={testId}>
      <h2 id={id} className="op-section__title">
        {title}
      </h2>
      <div className="op-grid">{children}</div>
    </section>
  );
}

function when(at: string | null): string {
  if (!at) return "";
  return davaoShort(at);
}

/** How a read ended, in words: print beds while it's out, the route when it isn't served, else the data. */
function ReadBody<T>({
  outcome,
  route,
  testId,
  children,
}: {
  readonly outcome: ReadOutcome<T> | undefined;
  readonly route: string;
  readonly testId: string;
  readonly children: (data: T) => ReactNode;
}) {
  if (!outcome) {
    return (
      <div className="op-beds" data-testid={`${testId}.loading`}>
        <PrintBed shape="row" count={2} height={38} />
      </div>
    );
  }
  if (outcome.kind === "not-served") {
    return (
      <p className="op-empty" data-testid={`${testId}.not-served`}>
        <Glyph name="ms:schedule" size={16} />
        {OPS_COPY.notServed(route)}
      </p>
    );
  }
  if (outcome.kind === "refused") {
    return (
      <p className="op-empty" data-testid={`${testId}.refused`}>
        <Glyph name="ms:lock" size={16} />
        {OPS_COPY.refused}
      </p>
    );
  }
  if (outcome.kind === "down") {
    return (
      <p className="op-empty" data-testid={`${testId}.down`}>
        <Glyph name="ms:help" size={16} />
        {OPS_COPY.down(outcome.status)}
      </p>
    );
  }
  return <>{children(outcome.data)}</>;
}

/** Rows in words: what, its value with a glyph and a tone (money in its amount state, no glyph), and why. */
function RowsTable({
  rows,
  caption,
  head,
  testId,
}: {
  readonly rows: readonly OpsRow[];
  readonly caption: string;
  readonly head: readonly [string, string, string];
  readonly testId: string;
}) {
  return (
    <table className="op-table op-table--framed" data-testid={testId}>
      <caption className="fs-sr">{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th scope="col" key={h}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} data-state={r.tone} data-testid={`${testId}.${r.key}`}>
            <th scope="row">{r.label}</th>
            <td>
              {r.amountState ? (
                <span className="op-num op-amount" data-amount-state={r.amountState}>
                  {r.value}
                </span>
              ) : (
                <span className="op-status" data-tone={r.tone}>
                  <Glyph name={TONE_GLYPH[r.tone]} size={16} />
                  {r.value}
                </span>
              )}
            </td>
            <td className="op-table__detail">{r.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface OpsPageProps {
  readonly rail: PaypalRail;
  readonly treasurerKey: TreasurerKey;
  /** The operator's session (S3.8); everyone else reads. */
  readonly operator: boolean;
  readonly verdict: OpsVerdict;
}

export function OpsPage({ rail, treasurerKey, operator, verdict }: OpsPageProps) {
  const health = useHealth();
  const outbox = useOutbox();
  const sections = useSections();
  const registry = usePublishedKeys();
  const { checking, refresh } = useOpsRefresh();
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
          <span
            className="op-chip"
            data-testid="W-OP-01.access"
            data-access={operator ? "operator" : "read-only"}
          >
            <Glyph name={operator ? "ms:fingerprint" : "ms:visibility"} size={16} />
            {operator ? OPS_COPY.operator : OPS_COPY.readOnly}
          </span>
        </div>
        <p className="op-mast__lede">{OPS_COPY.lede}</p>
        <p className="op-verdict" data-state={verdict.state} data-testid="W-OP-01.verdict">
          <Glyph name={VERDICT_GLYPH[verdict.state]} size={18} />
          {verdict.words}
        </p>
        <p className="op-mast__checked" data-testid="W-OP-01.checked">
          <span>
            {checking || !health.checkedAt
              ? OPS_COPY.checking
              : OPS_COPY.checkedAt(format.time(new Date(health.checkedAt).toISOString()))}
          </span>
          <button
            type="button"
            className="fs-flat"
            onClick={refresh}
            disabled={checking}
            data-testid="W-OP-01.refresh"
          >
            <Glyph name="ms:restart-alt" size={18} />
            {OPS_COPY.again}
          </button>
        </p>
      </header>

      <Section title={OPS_COPY.health} testId="W-OP-01.health">
        {verdict.state === "loading" ? (
          <div className="op-beds" data-testid="W-OP-01.loading" aria-busy="true">
            <span className="fs-sr">Checking health.</span>
            <PrintBed shape="row" count={2} height={38} labels={["Liveness", "Readiness"]} />
          </div>
        ) : (
          <table className="op-table op-table--framed">
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
        )}
      </Section>

      <Section title={OPS_COPY.switches} testId="W-OP-01.switches" note={OPS_COPY.switchesNote}>
        <table className="op-table op-table--framed">
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

      <Group title={OPS_COPY.paypal} testId="W-OP-01.paypal">
        <PaypalSections sections={sections} />
      </Group>

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
          <ScrollRegion className="op-scroll" label="PayPal's notices, newest first">
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
          </ScrollRegion>
        )}
      </Section>

      <Section title={OPS_COPY.outbox} testId="W-OP-01.outbox">
        <ReadBody outcome={outbox.data} route={OPS_PATHS.outbox} testId="W-OP-01.outbox">
          {(data) => <OutboxTable data={data} />}
        </ReadBody>
      </Section>

      <Group title={OPS_COPY.claude} testId="W-OP-01.claude-group">
        <Section title={OPS_COPY.spend} testId="W-OP-01.claude" note={OPS_COPY.spendNote} level="h3">
          <ReadBody outcome={sections.claude} route={SECTION_PATHS.claude} testId="W-OP-01.claude">
            {(data) => (
              <RowsTable
                rows={claudeRows(data)}
                caption={`Claude spend per lane on ${data.day} (UTC), against each lane's cap`}
                head={["Lane", "Spent", "Detail"]}
                testId="W-OP-01.claude.table"
              />
            )}
          </ReadBody>
        </Section>
        <Section title={OPS_COPY.eval} testId="W-OP-01.eval" note={OPS_COPY.evalNote} level="h3">
          <ReadBody outcome={sections.eval} route={SECTION_PATHS.eval} testId="W-OP-01.eval">
            {(report) => (
              <>
                <p className="op-note" data-testid="W-OP-01.eval.caption">
                  {evalCaption(report)}
                </p>
                <RowsTable
                  rows={evalRows(report)}
                  caption="The eval's measures against their bars"
                  head={["Measure", "Result", "Bar"]}
                  testId="W-OP-01.eval.table"
                />
              </>
            )}
          </ReadBody>
        </Section>
      </Group>

      <Section title={OPS_COPY.quotas} testId="W-OP-01.quotas" note={OPS_COPY.quotasNote}>
        <ReadBody outcome={sections.quotas} route={SECTION_PATHS.quotas} testId="W-OP-01.quotas">
          {(data) => (
            <RowsTable
              rows={quotaRows(data)}
              caption="Live-run quotas, used against their limits"
              head={["Quota", "Used", "Detail"]}
              testId="W-OP-01.quotas.table"
            />
          )}
        </ReadBody>
      </Section>

      <Section title={OPS_COPY.key} testId="W-OP-01.key">
        <KeyPanel treasurerKey={treasurerKey} operator={operator} registry={registry} />
      </Section>
    </div>
  );
}

function PaypalSections({ sections }: { readonly sections: SectionOutcomes }) {
  return (
    <>
      <Section title={OPS_COPY.scopes} testId="W-OP-01.scopes" note={OPS_COPY.scopesNote} level="h3">
        <ReadBody outcome={sections.scopes} route={SECTION_PATHS.scopes} testId="W-OP-01.scopes">
          {(data) => (
            <RowsTable
              rows={scopeRows(data)}
              caption="PayPal OAuth scopes, needed and granted"
              head={["Scope", "Status", "Detail"]}
              testId="W-OP-01.scopes.table"
            />
          )}
        </ReadBody>
      </Section>
      <Section title={OPS_COPY.limiter} testId="W-OP-01.limiter" note={OPS_COPY.limiterNote} level="h3">
        <ReadBody outcome={sections.limiter} route={SECTION_PATHS.limiter} testId="W-OP-01.limiter">
          {(data) => (
            <RowsTable
              rows={limiterRows(data)}
              caption="The PayPal limiter's window against 40 and 20, the circuit, and shared-IP 429s"
              head={["Measure", "Now", "Detail"]}
              testId="W-OP-01.limiter.table"
            />
          )}
        </ReadBody>
      </Section>
      <Section title={OPS_COPY.latency} testId="W-OP-01.latency" note={OPS_COPY.latencyNote} level="h3">
        <ReadBody outcome={sections.latency} route={SECTION_PATHS.latency} testId="W-OP-01.latency">
          {(data) => (
            <table className="op-table op-table--framed" data-testid="W-OP-01.latency.table">
              <caption className="fs-sr">Webhook latency at p50 and p95, with the number of samples</caption>
              <thead>
                <tr>
                  <th scope="col">From, to</th>
                  <th scope="col">p50</th>
                  <th scope="col">p95</th>
                  <th scope="col">Samples</th>
                </tr>
              </thead>
              <tbody>
                {latencyRows(data).map((r) => (
                  <tr key={r.key} data-testid={`W-OP-01.latency.table.${r.key}`}>
                    <th scope="row">{r.label}</th>
                    <td className="op-num">{r.p50}</td>
                    <td className="op-num">{r.p95}</td>
                    <td className="op-num">{r.samples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ReadBody>
      </Section>
      <Section
        title={OPS_COPY.reconciliation}
        testId="W-OP-01.reconciliation"
        note={OPS_COPY.reconciliationNote}
        level="h3"
      >
        <ReadBody
          outcome={sections.reconciliation}
          route={SECTION_PATHS.reconciliation}
          testId="W-OP-01.reconciliation"
        >
          {(data) => (
            <RowsTable
              rows={reconciliationRows(data)}
              caption="The last reconciliation with PayPal"
              head={["Measure", "Result", "Detail"]}
              testId="W-OP-01.reconciliation.table"
            />
          )}
        </ReadBody>
      </Section>
      <Section title={OPS_COPY.balance} testId="W-OP-01.balance" note={OPS_COPY.balanceNote} level="h3">
        <ReadBody outcome={sections.balance} route={SECTION_PATHS.balance} testId="W-OP-01.balance">
          {(data) => (
            <RowsTable
              rows={balanceRows(data)}
              caption="The PayPal balance, estimated against observed"
              head={["Figure", "Amount", "Detail"]}
              testId="W-OP-01.balance.table"
            />
          )}
        </ReadBody>
      </Section>
    </>
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

function OutboxTable({ data }: { readonly data: OutboxRead }) {
  const rows = data.rows;
  const s = outboxSummary(rows);
  if (rows.length === 0) return <p className="op-empty">{OPS_COPY.outboxEmpty}</p>;
  return (
    <>
      <p className="op-note" data-testid="W-OP-01.outbox.summary">
        {s.queued} queued, {s.running} running, {s.dead} dead, {s.done} done
        {data.executor ? `. Executor ${data.executor}` : ""}
        {data.lastTickAt ? `. Last cron tick ${when(data.lastTickAt)}` : ""}.
      </p>
      <ScrollRegion className="op-scroll" label="Outbox tasks, newest first">
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
      </ScrollRegion>
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

/** The key as Fair Split publishes it (Proof checks signatures against exactly this), in words. */
function registryWords(registry: ReadOutcome<PublishedKeys> | undefined): {
  readonly state: string;
  readonly words: string;
  readonly publicKeyHex: string | null;
} {
  if (!registry) return { state: "checking", words: OPS_COPY.checking, publicKeyHex: null };
  if (registry.kind === "not-served") {
    return { state: "not-served", words: OPS_COPY.notServed(SECTION_PATHS.keys), publicKeyHex: null };
  }
  if (registry.kind === "refused") return { state: "refused", words: OPS_COPY.refused, publicKeyHex: null };
  if (registry.kind === "down")
    return { state: "down", words: OPS_COPY.down(registry.status), publicKeyHex: null };
  const key = registryKeyOf(registry.data, TREASURER_KEY_ID);
  const words =
    key.state === "registered"
      ? "Registered. Proof checks Analyn's signatures against it."
      : key.state === "revoked"
        ? `Revoked${key.revokedAt ? ` ${when(key.revokedAt)}` : ""}. It signs nothing more.`
        : "Not registered yet.";
  return { state: key.state, words, publicKeyHex: key.publicKeyHex };
}

export interface KeyPanelProps {
  readonly treasurerKey: TreasurerKey;
  /** Only the operator's session sees the make and register slabs. */
  readonly operator: boolean;
  /** The keys Fair Split publishes (`/.well-known/fairsplit-keys.json`). */
  readonly registry: ReadOutcome<PublishedKeys> | undefined;
}

export function KeyPanel({ treasurerKey, operator, registry }: KeyPanelProps) {
  const published = registryWords(registry);
  if (!operator) {
    // A judge (anyone but the operator) reads the key as the server publishes it; nothing here makes a key.
    return (
      <div
        className="op-key"
        data-testid="W-OP-01.key.panel"
        data-access="read-only"
        data-state={published.state}
      >
        <p className="op-note">{OPS_COPY.keyLedeReadOnly}</p>
        <dl className="op-facts">
          <div>
            <dt>Key</dt>
            <dd className="op-num">{TREASURER_KEY_ID}</dd>
          </div>
          <div>
            <dt>With Fair Split</dt>
            <dd data-testid="W-OP-01.key.status">{published.words}</dd>
          </div>
          {published.publicKeyHex && (
            <div>
              <dt>Fingerprint</dt>
              <dd className="op-num" data-testid="W-OP-01.key.fingerprint">
                {fingerprint(published.publicKeyHex)}
              </dd>
            </div>
          )}
        </dl>
        <p className="op-key__who" data-testid="W-OP-01.key.who">
          <Glyph name="ms:lock" size={16} />
          {OPS_COPY.keyWho}
        </p>
      </div>
    );
  }

  const { phase, durable, make, register } = treasurerKey;
  const key = "key" in phase ? phase.key : null;
  const canRegister =
    key !== null &&
    (phase.kind === "made" ||
      phase.kind === "not-served" ||
      phase.kind === "refused" ||
      phase.kind === "failed");
  return (
    <div className="op-key" data-testid="W-OP-01.key.panel" data-access="operator" data-state={phase.kind}>
      <p className="op-note">{OPS_COPY.keyLede}</p>
      <dl className="op-facts">
        <div>
          <dt>Key</dt>
          <dd className="op-num">{TREASURER_KEY_ID}</dd>
        </div>
        <div>
          <dt>This browser</dt>
          <dd data-testid="W-OP-01.key.status">{KEY_WORDS[phase.kind]}</dd>
        </div>
        <div>
          <dt>With Fair Split</dt>
          <dd data-testid="W-OP-01.key.published">{published.words}</dd>
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
