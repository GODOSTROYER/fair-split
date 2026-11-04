import { judgeRoutes, type RouteData, type TamperKind } from "@fairsplit/api-client";
import { useEffect, useState } from "react";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { ChromePortal } from "../../chrome/slots.js";
import { useAdapter, useJudgeSession, useStageRun } from "../../data/hooks.js";
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
      <p className="fs-t-caption">
        Simulated PayPal sandbox. No model or PayPal call is made by these controls.
      </p>
      {!session && <p>Start the run with Mark paid to try an attack.</p>}
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
        <div role="status" data-testid="W-JG-01.tamper.result">
          {result.armed ? (
            <p>
              Armed before key 2. After both signatures, the digest check will refuse the changed payout and
              void both approvals.
            </p>
          ) : (
            <p>
              {result.verdict}: {result.reasons.join("; ")}. Nothing sent.
            </p>
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
