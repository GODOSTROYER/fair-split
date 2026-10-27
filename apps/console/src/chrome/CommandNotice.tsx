// How a screen says a command, query or stream failed (S1.11): what happened in the console's words, the
// API's own message beneath, and the request and PayPal debug IDs in hash type. Red only when PayPal is the
// actor (design §2.2); every other refusal is ink on plate-2, because a refused step is information.

import { Glyph } from "@fairsplit/ui-web";
import { errorView } from "../data/errors.js";

export interface CommandNoticeProps {
  /** A CommandError, a query error, or anything thrown. Nothing renders for null or undefined. */
  readonly error: unknown;
  /** `{screenId}.{element}`, e.g. "W-TR-06.error". */
  readonly testId: string;
  /** Offered as a flat link when the step can be tried again. */
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
}

export function CommandNotice({ error, testId, onRetry, retryLabel = "Try again" }: CommandNoticeProps) {
  if (error === null || error === undefined) return null;
  const view = errorView(error);
  return (
    <div
      className="fsc-command-notice"
      role="alert"
      data-tone={view.paypal ? "paypal" : "neutral"}
      data-code={view.code ?? undefined}
      data-testid={testId}
    >
      <Glyph name={view.paypal ? "rail" : "ms:help"} size={18} />
      <div className="fsc-command-notice__body">
        <p className="fsc-command-notice__title fs-t-label">{view.title}</p>
        {view.detail && <p className="fsc-command-notice__detail">{view.detail}</p>}
        {view.refs.length > 0 && (
          <p className="fsc-command-notice__refs fs-t-hash">
            {view.refs.map((ref) => (
              <span key={ref}>{ref}</span>
            ))}
          </p>
        )}
      </div>
      {onRetry && (
        <button
          type="button"
          className="fs-link fs-t-label"
          onClick={onRetry}
          data-testid={`${testId}.retry`}
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}
