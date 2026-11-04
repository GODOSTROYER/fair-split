// What's real's "Try to break it" (UI gate round 2): the honesty tag, four attempts, and each result as one line,
// "Refused · DENY · invoiceEqualsQuote · Nothing sent", with the policy's own words behind "Why".

import { judgeRoutes, type RouteData, type TamperKind } from "@fairsplit/api-client";
import { HonestyTag } from "@fairsplit/ui-web";
import { useEffect, useState } from "react";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { railTag, TRY_TO_BREAK } from "../../chrome/copy.js";
import { ChromePortal } from "../../chrome/slots.js";
import { useAdapter, useJudgeSession, usePaypalRail, useStageRun } from "../../data/hooks.js";
import { env } from "../../lib/env.js";
import { liveApprovals, voidedByChange } from "../approve/model.js";

const ATTEMPTS: readonly { kind: TamperKind; label: string }[] = [
  { kind: "amount", label: "Overcharge the invoice draft" },
  { kind: "offsetting", label: "Offset shipping with a discount" },
  { kind: "recipient", label: "Add an invoice recipient" },
  { kind: "change_payout", label: "Arm a payout change before key 2" },
];
export function TamperControls() {
  const adapter = useAdapter();
  const { session } = useJudgeSession();
  const { view } = useStageRun();
  const rail = usePaypalRail() ?? env.paypalRail;
  const [result, setResult] = useState<RouteData<"tamper"> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    void session?.workspaceId;
    setResult(null);
    setError(null);
  }, [session?.workspaceId]);
  const signatures = view ? liveApprovals(view) : null;
  const secondKey = signatures?.chair !== null && signatures?.chair !== undefined;
  const tryIt = async (kind: TamperKind) => {
    if (!session || pending) return;
    setPending(true);
    setError(null);
    try {
      setResult(
        await judgeRoutes(adapter.api).tamper({
          params: { sid: session.sessionId },
          body: { kind },
          token: null,
        }),
      );
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  };
  return (
    <ChromePortal name="whatsReal.tryToBreak">
      <p className="fsc-tampers__tag" title="No model or PayPal call is made by these controls.">
        <HonestyTag>{railTag(rail)}</HonestyTag>
      </p>
      {!session && <p className="fs-t-body fsc-tampers__hint">{TRY_TO_BREAK.needsRun}</p>}
      <div className="fsc-tampers">
        {ATTEMPTS.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            className="fs-flat"
            data-testid={`W-JG-01.tamper.${kind}`}
            disabled={
              !session || pending || (kind === "change_payout" && (secondKey || result?.armed === true))
            }
            onClick={() => void tryIt(kind)}
          >
            {label}
          </button>
        ))}
      </div>
      {result && (
        <div role="status" className="fsc-tampers__result" data-testid="W-JG-01.tamper.result">
          {result.armed ? (
            <p className="fs-t-body">Armed before key 2. Both signatures will refuse the change.</p>
          ) : (
            <>
              <p className="fsc-tampers__verdict">
                <span className="fs-t-label">{TRY_TO_BREAK.refused}</span>
                <span className="fs-t-micro">
                  {[result.verdict, ...result.decidedBy, TRY_TO_BREAK.nothingSent]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </p>
              <details className="fsc-truth__more">
                <summary className="fs-t-label">{TRY_TO_BREAK.why}</summary>
                <ul className="fs-t-caption">
                  {result.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </details>
            </>
          )}
          {result.armed && view && voidedByChange(view) !== null && (
            <p>Changed payout refused. Both approvals voided; review and sign again.</p>
          )}
        </div>
      )}
      <CommandNotice error={error} testId="W-JG-01.tamper.error" />
    </ChromePortal>
  );
}
