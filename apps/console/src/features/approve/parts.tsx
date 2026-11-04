// W-TR-07's pieces: the seal (or its empty bands while the batch is not final) with one micro line under it, the
// checks above the slab, the two key rows, the details a person opens to compare hashes, the dialog route's body
// and the co-sign card. Machines print; people press (the one slab lives in the screen); a signature is ink under
// its initials stamp. Words are few: each piece is a title, a figure and a micro line (unslop spec §3.9).

import { bandCircle, type RingIndex, seal, sealHash } from "@fairsplit/seal";
import { Glyph, HonestyTag, Seal, type StampView } from "@fairsplit/ui-web";
import { type ReactNode, useMemo, useSyncExternalStore } from "react";
import { Stamp } from "../../chrome/Stamp.js";
import { format } from "../../lib/format.js";
import { APPROVE, en } from "../split/shared/copy.js";

/** On a short screen (a 13-inch laptop's 956 px, or 1280 × 800) the seal draws at 144 px. */
const SHORT_SCREEN = "(max-height: 1000px)";

function subscribeShort(listener: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const query = window.matchMedia(SHORT_SCREEN);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function readShort(): boolean {
  return typeof window !== "undefined" && window.matchMedia ? window.matchMedia(SHORT_SCREEN).matches : false;
}

/** The seal's size on Approve: 184 px (design §6 C7), 144 px on a short screen. */
export function useSealSize(): number {
  return useSyncExternalStore(subscribeShort, readShort, () => false) ? 144 : 184;
}

/**
 * The batch's own pattern before anyone signs: every ring the hash grows, in pencil at a quarter strength, so
 * the seal reads as this batch's guilloché, waiting for ink, never as empty circles. Each key's rings engrave
 * over it in ink (ui-web's Seal, on top). Decorative: the Seal above carries the name and the key count.
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
        <path key={r.index} d={r.d} fill="none" strokeWidth={geometry.strokeWidth} strokeLinejoin="round" />
      ))}
    </svg>
  );
}

const RINGS: readonly RingIndex[] = [0, 1, 2, 3, 4];

/** The seal's five bands before there is a batch hash to grow it from: 1 px rule circles, nothing invented. */
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

/** The seal, then one micro line: "1/2 signed · 5e66 5ac5 … 0811 8b75". The full hash is in the details. */
export function SealBlock({ batchSha256, keys, engrave, size: fixed }: SealBlockProps) {
  const responsive = useSealSize();
  const size = fixed ?? responsive;
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
      <p className="fsr-approve__seal-caption fs-t-micro">
        <span className="fsr-approve__keys-count" data-testid="W-TR-07.keysCount">
          {APPROVE.signedCount(keys)}
        </span>
        <span aria-hidden="true"> · </span>
        <span className="fs-sr">{APPROVE.batchHashLabel} </span>
        <span data-testid="W-TR-07.batchHash" title={batchSha256 ?? undefined}>
          {batchSha256 ? sealHash(batchSha256) : APPROVE.batchPending}
        </span>
      </p>
    </div>
  );
}

export interface CheckRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** A checked fact reads ✓ in ink; one still open reads a marigold dot (a person decides). */
  readonly done: boolean;
}

/** The four checks above the slab: a ✓ and the word in ink, the figure in micro on the right (spec §1.8). */
export function CheckList({ rows, testId }: { readonly rows: readonly CheckRow[]; readonly testId: string }) {
  return (
    <ul className="fsr-checks" aria-label={APPROVE.checksLabel} data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key} className="fsr-check" data-done={r.done ? "" : undefined}>
          {r.done ? (
            <Glyph name="ms:check" size={16} />
          ) : (
            <span className="fsr-check__dot" role="img" aria-label={APPROVE.checkOpen} />
          )}
          <span className="fsr-check__label fs-t-label">{r.label}</span>
          <span className="fsr-check__value fs-t-micro">{r.value}</span>
        </li>
      ))}
    </ul>
  );
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
}

/** What both keys sign, as key and value in hash type: a person compares them by eye with the Chair's phone. */
export function BatchLedger({
  senderBatchId,
  batchSha256,
  signedLinesDigest,
  lines,
  cashLines,
  rateCardSha256,
}: BatchLedgerProps) {
  return (
    <dl className="fsr-ledger" data-testid="W-TR-07.ledger">
      <div className="fsr-ledger__row">
        <dt className="fs-t-micro">{APPROVE.batchLabel}</dt>
        <dd className="fs-t-hash" data-testid="W-TR-07.batch">
          {senderBatchId}
        </dd>
      </div>
      {batchSha256 && (
        <div className="fsr-ledger__row">
          <dt className="fs-t-micro">{APPROVE.batchHashLabel}</dt>
          <dd className="fs-t-hash">{format.hashGroups(batchSha256, 4)}</dd>
        </div>
      )}
      {signedLinesDigest && (
        <div className="fsr-ledger__row">
          <dt className="fs-t-micro">{APPROVE.linesDigest}</dt>
          <dd className="fs-t-hash" data-testid="W-TR-07.linesDigest" title={signedLinesDigest}>
            {format.hashGroups(signedLinesDigest, 4)}
            <span className="fsr-ledger__note fs-t-micro"> {APPROVE.linesNote(lines, cashLines)}</span>
          </dd>
        </div>
      )}
      <div className="fsr-ledger__row">
        <dt className="fs-t-micro">{APPROVE.rateCard}</dt>
        <dd className="fs-t-hash">{format.hashGroups(rateCardSha256)}</dd>
      </div>
    </dl>
  );
}

export interface KeySlotProps {
  /** "Analyn · Treasurer" */
  readonly name: string;
  /** A micro line: the key's ID ("fs-analyn-demo-f4ew6o") or why this key is needed ("> US$300 · R5"). */
  readonly meta?: string;
  /** Said on hover: how the key was made. */
  readonly metaTitle?: string;
  /** The honesty tag for a key made for the demo ("Demo key", "Sample key"). */
  readonly tag?: string;
  readonly status: string;
  readonly signed: boolean;
  readonly stamp: StampView | null;
  readonly voided?: boolean;
  readonly testId: string;
}

export function KeySlot({
  name,
  meta,
  metaTitle,
  tag,
  status,
  signed,
  stamp,
  testId,
  voided = false,
}: KeySlotProps) {
  return (
    <li
      className="fsr-key"
      data-state={voided ? "voided" : signed ? "signed" : "waiting"}
      data-testid={testId}
    >
      <span className="fsr-key__slot" aria-hidden={stamp ? undefined : true}>
        {(signed || voided) && stamp ? (
          <Stamp stamp={stamp} testId={`${testId}.stamp`} />
        ) : (
          <Glyph name="seal" size={16} />
        )}
      </span>
      <span className="fsr-key__text">
        <span className="fsr-key__name fs-t-label">{name}</span>
        {(meta || tag) && (
          <span className="fsr-key__meta">
            {meta && (
              <span className="fsr-key__id fs-t-micro" title={metaTitle}>
                {meta}
              </span>
            )}
            {tag && <HonestyTag>{tag}</HonestyTag>}
          </span>
        )}
      </span>
      <span className="fsr-key__status fs-t-micro" data-testid={`${testId}.status`}>
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
          <figcaption className="fs-t-hash">{sealHash(batchSha256)}</figcaption>
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
      <div className="fsr-cosign__head">
        <h2 id="W-TR-07-cosign" className="fs-t-label">
          {APPROVE.cosignTitle}
        </h2>
        <HonestyTag>{APPROVE.tagDemoKey}</HonestyTag>
      </div>
      {code ? (
        <div className="fsr-cosign__code" data-testid="W-TR-07.cosign.code">
          <p className="fsr-cosign__digits fs-t-amount-l">
            <span aria-hidden>{codeGroups(code.code6)}</span>
            <span className="fs-sr">{code.code6.split("").join(" ")}</span>
          </p>
          <p className="fs-t-micro fsr-muted">
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
