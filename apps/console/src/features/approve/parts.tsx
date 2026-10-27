// W-TR-07's pieces: the seal (or its empty bands while the batch is not final), the batch facts in hash type,
// the two key slots, the dialog route's body and the co-sign card. Machines print (flat pencil, no button);
// people press (the one d3 slab lives in the screen); a signature is ink under its initials stamp.

import { bandCircle, type RingIndex } from "@fairsplit/seal";
import { Glyph, InkStamp, Seal, type StampView } from "@fairsplit/ui-web";
import type { ReactNode } from "react";
import { format } from "../../lib/format.js";
import { APPROVE, en } from "../split/shared/copy.js";

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

export function SealBlock({ batchSha256, keys, engrave, size = 200 }: SealBlockProps) {
  return (
    <div className="fsr-approve__seal" data-keys={keys}>
      {batchSha256 ? (
        <Seal batchSha256={batchSha256} size={size} keys={keys} engrave={engrave} testId="W-TR-07.seal" />
      ) : (
        <UnsealedRings size={size} testId="W-TR-07.seal" />
      )}
      <p className="fsr-approve__keys-count fs-t-caption" data-testid="W-TR-07.keysCount">
        {en("seal.keys", { signed: keys })}
      </p>
    </div>
  );
}

export interface BatchLedgerProps {
  readonly senderBatchId: string;
  readonly batchSha256: string | null;
  readonly linesDigest: string | null;
  readonly lines: number;
  readonly cashLines: number;
  readonly rateCardSha256: string;
}

/** The hashes a person can compare by eye, in groups of four (hash type, never monospace). */
export function BatchLedger({
  senderBatchId,
  batchSha256,
  linesDigest,
  lines,
  cashLines,
  rateCardSha256,
}: BatchLedgerProps) {
  return (
    <dl className="fsr-ledger" data-testid="W-TR-07.ledger">
      <div className="fsr-ledger__row">
        <dt className="fs-t-caption">{APPROVE.batchLabel}</dt>
        <dd className="fs-t-hash" data-testid="W-TR-07.batch">
          {senderBatchId}
        </dd>
      </div>
      <div className="fsr-ledger__row">
        <dt className="fs-t-caption">{APPROVE.batchHash}</dt>
        <dd className="fs-t-hash" data-testid="W-TR-07.batchHash" title={batchSha256 ?? undefined}>
          {batchSha256 ? format.hashGroups(batchSha256, 4) : APPROVE.batchPending}
        </dd>
      </div>
      <div className="fsr-ledger__row">
        <dt className="fs-t-caption">{APPROVE.linesDigest}</dt>
        <dd className="fs-t-hash" data-testid="W-TR-07.linesDigest" title={linesDigest ?? undefined}>
          {linesDigest ? format.hashGroups(linesDigest, 4) : APPROVE.batchPending}
          {linesDigest && (
            <span className="fsr-ledger__note fs-t-caption"> {APPROVE.linesNote(lines, cashLines)}</span>
          )}
        </dd>
      </div>
      <div className="fsr-ledger__row">
        <dt className="fs-t-caption">{APPROVE.rateCard}</dt>
        <dd className="fs-t-hash">{format.hashGroups(rateCardSha256)}</dd>
      </div>
    </dl>
  );
}

export interface KeySlotProps {
  readonly name: string;
  readonly why?: string;
  /** The key line: "Key fs-analyn-w1, Demo key (this browser)". */
  readonly keyLine?: string;
  readonly keyNote?: string;
  readonly status: string;
  readonly signed: boolean;
  readonly stamp: StampView | null;
  readonly testId: string;
}

export function KeySlot({ name, why, keyLine, keyNote, status, signed, stamp, testId }: KeySlotProps) {
  return (
    <li className="fsr-key" data-state={signed ? "signed" : "waiting"} data-testid={testId}>
      <span className="fsr-key__slot" aria-hidden={stamp ? undefined : true}>
        {signed && stamp ? (
          <InkStamp stamp={stamp} testId={`${testId}.stamp`} />
        ) : (
          <Glyph name="seal" size={18} />
        )}
      </span>
      <span className="fsr-key__text">
        <span className="fs-t-label">{name}</span>
        {why && <span className="fsr-key__why fs-t-caption">{why}</span>}
        {keyLine && <span className="fsr-key__id fs-t-caption">{keyLine}</span>}
        {keyNote && <span className="fsr-key__note fs-t-caption">{keyNote}</span>}
      </span>
      <span className="fsr-key__status fs-t-label" data-testid={`${testId}.status`}>
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
          <figcaption className="fs-t-hash">{format.hashGroups(batchSha256, 4)}</figcaption>
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
      <h2 id="W-TR-07-cosign" className="fs-t-label">
        {APPROVE.cosignTitle}
      </h2>
      <p className="fsr-cosign__body fs-t-caption">{APPROVE.cosignBody}</p>
      {code ? (
        <div className="fsr-cosign__code" data-testid="W-TR-07.cosign.code">
          <p className="fsr-cosign__digits fs-t-amount-l">
            <span aria-hidden>{codeGroups(code.code6)}</span>
            <span className="fs-sr">{code.code6.split("").join(" ")}</span>
          </p>
          <p className="fs-t-caption">{APPROVE.cosignCode}</p>
          <p className="fs-t-caption">
            <a className="fs-link" href={code.url} target="_blank" rel="noreferrer noopener">
              {APPROVE.cosignLink}
            </a>{" "}
            {APPROVE.cosignExpires(format.time(code.expiresAt).slice(0, 5))}
          </p>
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
          <Glyph name="ms:fingerprint" size={18} />
          {APPROVE.cosignMake}
        </button>
      )}
      {onChairFrame && (
        <button
          type="button"
          className="fs-link fs-t-caption"
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
