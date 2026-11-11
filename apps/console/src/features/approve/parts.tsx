// W-TR-07's pieces (UI gate rounds 4 and 5): the seal at 180 px, 220 from a 1,600 px window (or its empty bands while
// the batch is not final) with its hash under it, the two named signers beside it ("Two officers sign this batch"),
// the checks above the slab, the PayPal recipients under the money bar, the details a person opens to compare hashes,
// the dialog route's body and the Chair's co-sign block. Unsigned rings are the batch's own pattern at 1 px in
// neutral-400; each key fills its rings in indigo, the same on the Chair's phone. A waiting signer is a hollow circle
// and "Waiting" ("Reviewing" while the Chair is on the batch); a signed one a solid row with an ink dot and "Signed
// 19:03". Round 5: no ids for people. A signer's line says in words where the key lives ("Key on this browser") or
// what it is for ("Co-signs batches over US$300"); the key ids, like the hashes, wait behind "IDs" in the mono id role
// on one line, cut in the middle when long (IdText). One marker vocabulary: a check is a line ✓ and its word, a state
// an 8 px dot. Words are few: each piece is a title, a figure and one line (unslop spec §3.9).

import { bandCircle, type RingIndex, seal, sealHash } from "@fairsplit/seal";
import { LAYOUT } from "@fairsplit/tokens";
import {
  CheckMark,
  Glyph,
  IdText,
  MoneyFigure,
  Seal,
  type StampView,
  StateDot,
  type StateDotKind,
} from "@fairsplit/ui-web";
import { type CSSProperties, type ReactNode, useMemo } from "react";
import { Stamp } from "../../chrome/Stamp.js";
import { format } from "../../lib/format.js";
import { useViewportHeight, useViewportWidth } from "../../stage/layout.js";
import { APPROVE, en } from "../split/shared/copy.js";

/** The seal's size on Approve: 180 px (`LAYOUT.console.seal`), the same drawing as the Chair's phone. */
export const SEAL_SIZE: number = LAYOUT.console.seal;
/**
 * From a 1,600 px window the seal grows to 220 px (round 4), so the composition in columns 1–7 holds the stage's
 * height on its own, top-aligned, never centred in it.
 */
export const SEAL_SIZE_WIDE = 220;
/**
 * On the 1,920 stage (a window 1,600 by 1,000 or more) the seal is the screen's hero at 280 px (round 6): the spare
 * height goes to it and to the recipients' rows, never to an empty band under "Fees".
 */
export const SEAL_SIZE_HERO = 280;
/** The window height from which Approve has the room for the hero seal and the taller recipient rows. */
export const APPROVE_TALL_PX = 1000;

/** The seal's share of the window's width (round 8): the same at every width, about 14%. */
export const SEAL_SHARE = 0.14;

/**
 * The seal's size for this window (round 8): one relative size at every width, 14% of the window (180 px at 1,280,
 * 206 at 1,470, 268 at 1,920), never under 180 px or over the 280 px hero, and never taller than a short window
 * allows. Its importance beside the amount no longer changes with the layout.
 */
export function sealSizeFor(width: number, height: number): number {
  const byWidth = Math.round((width * SEAL_SHARE) / 2) * 2;
  const byHeight = Math.round((height * 0.28) / 2) * 2;
  return Math.max(SEAL_SIZE, Math.min(SEAL_SIZE_HERO, byWidth, Math.max(SEAL_SIZE, byHeight)));
}

export function useSealSize(): number {
  return sealSizeFor(useViewportWidth(), useViewportHeight());
}

/** A key id prints whole up to this many characters ("fs-ernesto-demo-mj2ng2"), cut in the middle beyond. */
const KEY_ID_MAX = 24;

/**
 * The batch's own pattern before anyone signs: every ring the hash grows, at 1 px in neutral-400, so the seal reads
 * as this batch's guilloché waiting for ink, never as empty circles. Each key's rings fill over it in indigo
 * (ui-web's Seal, on top). Decorative: the Seal above carries the name and the key count.
 */
function SealGhost({ batchSha256, size }: { readonly batchSha256: string; readonly size: number }) {
  const geometry = useMemo(() => seal(batchSha256, size), [batchSha256, size]);
  return (
    <svg
      className="fsr-seal-ghost"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      focusable="false"
      data-testid="W-TR-07.sealGhost"
    >
      {geometry.rings.map((r) => (
        <path key={r.index} d={r.d} fill="none" strokeWidth={1} strokeLinejoin="round" />
      ))}
    </svg>
  );
}

const RINGS: readonly RingIndex[] = [0, 1, 2, 3, 4];

/** The seal's five bands before there is a batch hash to grow it from: 1 px circles, nothing invented. */
export function UnsealedRings({ size, testId }: { readonly size: number; readonly testId: string }) {
  return (
    <svg
      className="fs-seal fsr-seal--empty"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={APPROVE.sealWaiting}
      data-testid={testId}
      data-state="keys-0"
    >
      {RINGS.map((i) => {
        const c = bandCircle(i, size);
        return (
          <circle key={i} className="fs-seal__band" cx={c.cx} cy={c.cy} r={c.r} strokeWidth={1} fill="none" />
        );
      })}
    </svg>
  );
}

export interface SealBlockProps {
  readonly batchSha256: string | null;
  readonly keys: 0 | 1 | 2;
  /** Engrave newly signed rings: only for a live signature. */
  readonly engrave: boolean;
  readonly size?: number;
}

/** The seal at 180 px, then its hash in one micro line: "5e66 5ac5 … 0811 8b75". The full hash is in Details. */
export function SealBlock({ batchSha256, keys, engrave, size = SEAL_SIZE }: SealBlockProps) {
  return (
    <div className="fsr-approve__seal" data-keys={keys} data-testid="W-TR-07.sealBlock" tabIndex={-1}>
      {batchSha256 ? (
        <span className="fsr-seal-stack" style={{ width: size, height: size }}>
          <SealGhost batchSha256={batchSha256} size={size} />
          <Seal batchSha256={batchSha256} size={size} keys={keys} engrave={engrave} testId="W-TR-07.seal" />
        </span>
      ) : (
        <UnsealedRings size={size} testId="W-TR-07.seal" />
      )}
      {/* Round 8: the seal's state in a short label (not signed yet, half signed, signed), so the drawing explains
          itself; the hash sits under it. */}
      {batchSha256 && (
        <p className="fsr-approve__seal-state fs-t-label" data-keys={keys} data-testid="W-TR-07.sealState">
          <StateDot kind={keys === 0 ? "waiting" : "done"} className="fsr-approve__seal-dot" />
          {APPROVE.sealState[keys]}
        </p>
      )}
      <p className="fsr-approve__seal-caption fs-t-id">
        <span className="fs-sr">{APPROVE.batchHashLabel} </span>
        <span data-testid="W-TR-07.batchHash" title={batchSha256 ?? undefined}>
          {batchSha256 ? sealHash(batchSha256) : APPROVE.batchPending}
        </span>
      </p>
    </div>
  );
}

/**
 * The two named signers beside the seal: "Two officers sign this batch", then one row per key. Its rows are KeySlots
 * (Ernesto's presence is his row's status since round 4); anything after them sits under the list. How many have
 * signed is the screen's state, said once in its title row's chip (round 5).
 */
export function Signers({
  officers,
  rows,
  after,
}: {
  /** How many officers this batch needs: two over the Chair's threshold. */
  readonly officers: 1 | 2;
  readonly rows: ReactNode;
  readonly after?: ReactNode;
}) {
  return (
    <section className="fsr-signers" aria-labelledby="W-TR-07-signers">
      <header className="fsr-signers__head">
        <h2 id="W-TR-07-signers" className="fsr-signers__title fs-t-label">
          {APPROVE.signersTitle(officers)}
        </h2>
      </header>
      <ul className="fsr-keys" aria-labelledby="W-TR-07-signers" data-testid="W-TR-07.keys">
        {rows}
      </ul>
      {after}
    </section>
  );
}

export interface CheckRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** A checked fact reads ✓ in ink; one still open reads a marigold dot (a person decides). */
  readonly done: boolean;
}

/**
 * The four checks above the slab: a 16 px line ✓ and the word in ink, the figure on the right (spec §1.8; round 5:
 * the one check mark). One still open is an 8 px amber dot: a person decides.
 */
export function CheckList({ rows, testId }: { readonly rows: readonly CheckRow[]; readonly testId: string }) {
  return (
    <ul className="fsr-checks" aria-label={APPROVE.checksLabel} data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key} className="fsr-check" data-done={r.done ? "" : undefined}>
          {r.done ? (
            <CheckMark className="fsr-check__mark" />
          ) : (
            <span className="fsr-check__mark" role="img" aria-label={APPROVE.checkOpen}>
              <StateDot kind="held" />
            </span>
          )}
          <span className="fsr-check__label fs-t-label">{r.label}</span>
          <span className="fsr-check__value fs-t-caption">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export interface PayeeRow {
  readonly memberNo: string;
  readonly name: string;
  /** "US$64.45" */
  readonly amount: string;
  /** pending (to send or in flight, hollow), paid (the simulated PayPal confirmed it), held (parked). */
  readonly state: Extract<StateDotKind, "pending" | "paid" | "held">;
  /** The state in words for a screen reader, when it is not "to send". */
  readonly stateWord?: string;
}

/**
 * Who the batch pays (round 5: the second row under the money bar at 1,920): the PayPal recipients two columns
 * across, each a hollow 8 px dot until the simulated PayPal confirms the payment, the name and the amount.
 */
export function Payees({
  rows,
  label,
  testId,
}: {
  readonly rows: readonly PayeeRow[];
  readonly label: string;
  readonly testId: string;
}) {
  return (
    <ul
      className="fsr-payees"
      aria-label={label}
      data-testid={testId}
      // Two columns reading down: half the rows each (the CSS lays them out column by column).
      style={{ "--fsr-rows": String(Math.max(1, Math.ceil(rows.length / 2))) } as CSSProperties}
    >
      {rows.map((r) => (
        <li key={r.memberNo} className="fsr-payee" data-state={r.state}>
          <StateDot kind={r.state} />
          <span className="fsr-payee__name fs-t-label">
            {r.name}
            {r.stateWord && <span className="fs-sr">, {r.stateWord}</span>}
          </span>
          <MoneyFigure display={r.amount} className="fsr-payee__amount fs-t-figure" />
        </li>
      ))}
    </ul>
  );
}

export interface LedgerKey {
  /** "Analyn's key" */
  readonly label: string;
  /** The key's id ("fs-analyn-demo-f4ew6o"). */
  readonly id: string;
  /** How it was made, on hover. */
  readonly title?: string;
  readonly testId: string;
}

export interface BatchLedgerProps {
  readonly senderBatchId: string;
  readonly batchSha256: string | null;
  /**
   * The lines root the payload asks both keys to sign, shown only when this browser recomputed the same root.
   * Null hides the row: a digest no signature binds is never shown beside what two people sign.
   */
  readonly signedLinesDigest: string | null;
  readonly lines: number;
  readonly cashLines: number;
  readonly rateCardSha256: string;
  /** The signers' key ids (round 5: behind "IDs", never under a person's name). */
  readonly keys?: readonly LedgerKey[];
}

/** What both keys sign, as key and value in hash type: a person compares them by eye with the Chair's phone. */
export function BatchLedger({
  senderBatchId,
  batchSha256,
  signedLinesDigest,
  lines,
  cashLines,
  rateCardSha256,
  keys = [],
}: BatchLedgerProps) {
  return (
    <dl className="fsr-ledger" data-testid="W-TR-07.ledger">
      <div className="fsr-ledger__row">
        <dt className="fs-t-caption">{APPROVE.batchLabel}</dt>
        <dd className="fs-t-id" data-testid="W-TR-07.batch">
          {senderBatchId}
        </dd>
      </div>
      {batchSha256 && (
        <div className="fsr-ledger__row">
          <dt className="fs-t-caption">{APPROVE.batchHashLabel}</dt>
          <dd className="fs-t-id">{format.hashGroups(batchSha256, 4)}</dd>
        </div>
      )}
      {signedLinesDigest && (
        <div className="fsr-ledger__row">
          <dt className="fs-t-caption">{APPROVE.linesDigest}</dt>
          <dd className="fs-t-id" data-testid="W-TR-07.linesDigest" title={signedLinesDigest}>
            {format.hashGroups(signedLinesDigest, 4)}
            <span className="fsr-ledger__note fs-t-caption"> {APPROVE.linesNote(lines, cashLines)}</span>
          </dd>
        </div>
      )}
      <div className="fsr-ledger__row">
        <dt className="fs-t-caption">{APPROVE.rateCard}</dt>
        <dd className="fs-t-id">{format.hashGroups(rateCardSha256)}</dd>
      </div>
      {keys.map((k) => (
        <div key={k.testId} className="fsr-ledger__row">
          <dt className="fs-t-caption">{k.label}</dt>
          <dd className="fs-t-id" title={k.title}>
            <IdText value={k.id} max={KEY_ID_MAX} tail={6} testId={k.testId} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface KeySlotProps {
  /** "Analyn · Treasurer" */
  readonly name: string;
  /**
   * One line in words under the name (round 5: no ids for people): where the key lives ("Key on this browser",
   * "Sample key") or what it is for ("Co-signs batches over US$300").
   */
  readonly caption?: string;
  /** Behind the caption, for hover and a screen reader: the rule ("Rule R5") or how the key was made. */
  readonly captionTitle?: string;
  readonly status: string;
  /** The whole sentence behind a short status ("Reviewing": "Ernesto is reviewing the batch"). */
  readonly statusTitle?: string;
  readonly signed: boolean;
  readonly stamp: StampView | null;
  readonly voided?: boolean;
  readonly testId: string;
}

/**
 * One signer: a hollow circle and "Waiting" until the key signs, then a solid 1 px row with an ink dot and "Signed
 * 19:03" (jade is only money PayPal confirmed, never a signature). A voided signature keeps its struck-through
 * stamp: a person's ink, voided, never erased.
 */
export function KeySlot({
  name,
  caption,
  captionTitle,
  status,
  statusTitle,
  signed,
  stamp,
  testId,
  voided = false,
}: KeySlotProps) {
  return (
    <li
      className={["fsr-key", signed && !voided ? "fs-solid-row" : null].filter(Boolean).join(" ")}
      data-state={voided ? "voided" : signed ? "signed" : "waiting"}
      data-testid={testId}
    >
      <span className="fsr-key__slot" aria-hidden={voided && stamp ? undefined : true}>
        {voided && stamp ? (
          <Stamp stamp={stamp} testId={`${testId}.stamp`} />
        ) : (
          <StateDot kind={signed ? "done" : "waiting"} />
        )}
      </span>
      <span className="fsr-key__text">
        <span className="fsr-key__name fs-t-label">{name}</span>
        {caption && (
          <span className="fsr-key__why fs-t-caption" title={captionTitle} data-testid={`${testId}.caption`}>
            {caption}
            {captionTitle && <span className="fs-sr">{`. ${captionTitle}`}</span>}
          </span>
        )}
      </span>
      <span
        className="fsr-key__status fs-t-caption"
        title={statusTitle}
        data-presence={statusTitle ? "" : undefined}
        data-testid={`${testId}.status`}
      >
        {status}
      </span>
    </li>
  );
}

export interface ConfirmBodyProps {
  readonly amount: string;
  readonly count: number;
  readonly recipients: readonly {
    readonly name: string;
    readonly memberNo: string;
    readonly amount: string;
  }[];
  readonly batchSha256: string | null;
}

/** The dialog route (S2.7): the amount, every recipient, the consequence, and the seal with its hash. */
export function ConfirmBody({ amount, count, recipients, batchSha256 }: ConfirmBodyProps): ReactNode {
  return (
    <div className="fsr-confirm">
      <p>{APPROVE.confirmBody(amount, count)}</p>
      <p className="fsr-confirm__head fs-t-caption">{en("confirm.recipients")}</p>
      <ul className="fsr-confirm__list">
        {recipients.map((r) => (
          <li key={r.memberNo}>
            <span>{r.name}</span>
            <span className="fs-t-figure">{r.amount}</span>
          </li>
        ))}
      </ul>
      {batchSha256 && (
        <figure className="fsr-confirm__seal">
          <Seal batchSha256={batchSha256} size={96} keys={0} />
          <figcaption className="fs-t-id">{sealHash(batchSha256)}</figcaption>
        </figure>
      )}
    </div>
  );
}

export interface CosignCardProps {
  readonly code: { readonly code6: string; readonly url: string; readonly expiresAt: string } | null;
  readonly busy: boolean;
  readonly onMake: () => void;
  readonly onChairFrame?: () => void;
  readonly error?: ReactNode;
}

/** "6 4 2 1 9 3" → "642 193": read aloud in two groups. */
export function codeGroups(code6: string): string {
  return `${code6.slice(0, 3)} ${code6.slice(3)}`;
}

/**
 * Judge Mode's second key from the judge's own phone. The API returns a single-use pairing link and a six-digit
 * code; no QR matrix exists yet (no encoder is pinned), so the code is the scannable route, never a fake QR.
 */
export function CosignCard({ code, busy, onMake, onChairFrame, error }: CosignCardProps) {
  return (
    <aside className="fsr-cosign" aria-labelledby="W-TR-07-cosign" data-testid="W-TR-07.cosign">
      {/* Round 5: no glyph beside the title; the demo key is said in the co-sign's own words and in its title. */}
      <h2 id="W-TR-07-cosign" className="fs-t-label" title={APPROVE.cosignDemo}>
        {APPROVE.cosignTitle}
      </h2>
      {code ? (
        <div className="fsr-cosign__code" data-testid="W-TR-07.cosign.code">
          <p className="fsr-cosign__digits fs-t-amount-l">
            <span aria-hidden>{codeGroups(code.code6)}</span>
            <span className="fs-sr">{code.code6.split("").join(" ")}</span>
          </p>
          <p className="fs-t-caption fsr-muted">
            {APPROVE.cosignCode} · {APPROVE.cosignExpires(format.time(code.expiresAt).slice(0, 5))}
          </p>
          <a className="fs-link fs-t-label" href={code.url} target="_blank" rel="noreferrer noopener">
            {APPROVE.cosignLink}
          </a>
        </div>
      ) : (
        <button
          type="button"
          className="fs-flat"
          onClick={onMake}
          disabled={busy}
          aria-busy={busy || undefined}
          data-testid="W-TR-07.cosign.make"
        >
          <Glyph name="ms:fingerprint" size={16} />
          {APPROVE.cosignMake}
        </button>
      )}
      {onChairFrame && (
        <button
          type="button"
          className="fs-link fs-t-label"
          // The console lowers a docked phone on pointerdown; this action raises that same phone.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onChairFrame}
          data-testid="W-TR-07.cosign.frame"
        >
          {APPROVE.cosignFrame}
        </button>
      )}
      {error}
    </aside>
  );
}
