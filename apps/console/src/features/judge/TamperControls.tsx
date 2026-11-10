// What's real's "Try to break it" (UI gate round 3): a list of four left-aligned rows, each the attack's name and a
// "Try" button. The row tried last expands in place to its result: "Refused · <rule id>" beside a marigold dot (a
// refusal a person reads), and the one number the attack would have changed ("+US$1,000.00 blocked"), with the
// policy's own words behind "Why". A row tried earlier keeps one word, "Refused". The 1-cent payout change is armed
// before key 2 and refused by both keys: its row says so, then that both approvals were voided. No model or
// PayPal call is made by these controls; the sheet's lede says so, and its PayPal row is the simulated sandbox's.

import { judgeRoutes, type RouteData, type TamperKind } from "@fairsplit/api-client";
import { Glyph, StateDot } from "@fairsplit/ui-web";
import { useEffect, useState } from "react";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { TRY_TO_BREAK } from "../../chrome/copy.js";
import { ChromePortal } from "../../chrome/slots.js";
import { useAdapter, useJudgeSession, useStageRun } from "../../data/hooks.js";
import { format } from "../../lib/format.js";
import { liveApprovals, voidedByChange } from "../approve/model.js";

type TamperResult = RouteData<"tamper">;

const ATTEMPTS: readonly { kind: TamperKind; label: string }[] = [
  { kind: "amount", label: "Overcharge the invoice draft" },
  { kind: "offsetting", label: "Offset shipping with a discount" },
  { kind: "recipient", label: "Add an invoice recipient" },
  { kind: "change_payout", label: "Arm a payout change before key 2" },
];

/** The policy's verdict in the console's words: only a DENY reads "Refused". */
const VERDICT_WORD: Readonly<Record<string, string>> = {
  DENY: TRY_TO_BREAK.refused,
  REQUIRE_APPROVAL: "Needs a person",
  ALLOW: "Allowed",
};

/**
 * The one number an attack would have changed, read from the server's own description of it (its label names the
 * amount: "overcharges Lantern Bay by US$1,000.00", "shipping 50.00 offset by a 50.00 discount", "by 1 cent").
 * Nothing is computed here; a label with no amount gives the attack's count instead.
 */
export function blockedFigure(result: Pick<TamperResult, "kind" | "label">): string | null {
  const money = /(?:US\$)?(\d[\d,]*\.\d{2})/.exec(result.label)?.[1];
  const cents = /\b(\d+) cents?\b/.exec(result.label)?.[1];
  switch (result.kind) {
    case "amount":
      return money ? `+US$${money}` : null;
    case "offsetting":
      return money ? `US$${money} offset` : null;
    case "recipient":
      return "+1 recipient";
    case "change_payout":
      return cents ? format.money(Number(cents)) : null;
  }
}

export function TamperControls() {
  const adapter = useAdapter();
  const { session } = useJudgeSession();
  const { view } = useStageRun();
  const [result, setResult] = useState<TamperResult | null>(null);
  const [tried, setTried] = useState<ReadonlySet<TamperKind>>(new Set());
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<TamperKind | null>(null);
  useEffect(() => {
    void session?.workspaceId;
    setResult(null);
    setTried(new Set());
    setError(null);
  }, [session?.workspaceId]);
  const signatures = view ? liveApprovals(view) : null;
  const secondKey = signatures?.chair !== null && signatures?.chair !== undefined;
  const voided = result?.armed === true && view !== undefined && voidedByChange(view) !== null;
  const tryIt = async (kind: TamperKind) => {
    if (!session || pending) return;
    setPending(kind);
    setError(null);
    try {
      const answer = await judgeRoutes(adapter.api).tamper({
        params: { sid: session.sessionId },
        body: { kind },
        token: null,
      });
      setResult(answer);
      setTried((prev) => new Set(prev).add(kind));
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(null);
    }
  };
  return (
    <ChromePortal name="whatsReal.tryToBreak">
      {!session && <p className="fs-t-body fsc-tampers__hint">{TRY_TO_BREAK.needsRun}</p>}
      <ul className="fsc-tampers" data-testid="W-JG-01.tampers">
        {ATTEMPTS.map(({ kind, label }) => {
          const open = result?.kind === kind ? result : null;
          const state = pending === kind ? "pending" : open ? (open.armed ? "armed" : "refused") : "idle";
          const word = open ? null : tried.has(kind) ? TRY_TO_BREAK.refused : null;
          const blocked = open ? blockedFigure(open) : null;
          return (
            <li key={kind} className="fsc-tamper" data-kind={kind} data-state={state}>
              <div className="fsc-tamper__row">
                <span className="fsc-tamper__name fs-t-label" id={`fsc-tamper-${kind}`}>
                  {label}
                </span>
                {word && <span className="fsc-tamper__was fs-t-caption">{word}</span>}
                <button
                  type="button"
                  className="fsc-tamper__try fs-t-label"
                  data-testid={`W-JG-01.tamper.${kind}`}
                  aria-describedby={`fsc-tamper-${kind}`}
                  disabled={
                    !session ||
                    pending !== null ||
                    (kind === "change_payout" && (secondKey || result?.armed === true))
                  }
                  onClick={() => void tryIt(kind)}
                >
                  {TRY_TO_BREAK.tryWord}
                  <span className="fs-sr">{`: ${label}`}</span>
                </button>
              </div>
              {open && (
                <div
                  role="status"
                  className="fsc-tamper__result"
                  data-testid="W-JG-01.tamper.result"
                  data-verdict={open.verdict ?? undefined}
                  data-armed={open.armed ? "" : undefined}
                >
                  {open.armed ? (
                    <p className="fsc-tamper__verdict">
                      <StateDot kind="pending" />
                      <span className="fs-t-label">{voided ? TRY_TO_BREAK.voided : TRY_TO_BREAK.armed}</span>
                      {blocked && <span className="fsc-tamper__figure fs-t-figure">{blocked}</span>}
                    </p>
                  ) : (
                    <>
                      <p className="fsc-tamper__verdict">
                        <StateDot kind={open.verdict === "DENY" ? "held" : "pending"} />
                        <span className="fs-t-label">
                          {VERDICT_WORD[open.verdict ?? ""] ?? open.verdict}
                          {open.decidedBy.length > 0 && (
                            <>
                              <span className="fsc-tamper__sep" aria-hidden>
                                {" · "}
                              </span>
                              <span className="fs-sr">, by </span>
                              <span className="fsc-tamper__rule fs-t-micro">
                                {open.decidedBy.join(" · ")}
                              </span>
                            </>
                          )}
                        </span>
                        {blocked && open.verdict === "DENY" && (
                          <span className="fsc-tamper__figure fs-t-figure">
                            {`${blocked} ${TRY_TO_BREAK.blocked}`}
                          </span>
                        )}
                      </p>
                      {open.reasons.length > 0 && (
                        <details className="fsc-truth__more fsc-tamper__why">
                          <summary className="fs-t-label">
                            {TRY_TO_BREAK.why}
                            <span className="fsc-truth__chev" aria-hidden>
                              <Glyph name="ms:expand-more" size={16} />
                            </span>
                          </summary>
                          <ul className="fs-t-caption">
                            {open.reasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <CommandNotice error={error} testId="W-JG-01.tamper.error" />
    </ChromePortal>
  );
}
