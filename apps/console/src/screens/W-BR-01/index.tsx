// W-BR-01 Proof with the brand header, entered by the signed brand link `/b/:token` (S1.8, design B1). The token
// is the brand tier's credential for one read (`proofExport`); it is never shown, logged or stored. The column
// under the strip is the same Proof, with names and masked receivers (C-23). States: unpaid, progress (the live
// count, through to its final value), mismatch (proof withheld), and the shell's loading and error.

import { useMotionMode } from "@fairsplit/ui-web";
import { useMemo } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { PrintBed } from "../../chrome/PrintBed.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { usePaypalRail } from "../../data/hooks.js";
import { payoutReplayed } from "../../data/payout-replay.js";
import { BRAND_COPY, BrandHeader, type BrandState, FUNDED } from "../../features/brand/BrandHeader.js";
import { useBrandBundle } from "../../features/brand/useBrandProof.js";
import { provenanceWords } from "../../features/proof/copy.js";
import type { MemberLabel } from "../../features/proof/Lines.js";
import { returnedCashPaid } from "../../features/proof/model.js";
import { isShowcase, ProofView, verifyAttr } from "../../features/proof/ProofView.js";
import { isPosted, useProofPage } from "../../features/proof/useProof.js";
import { useVerification } from "../../features/proof/useVerification.js";
import type { BrandEntryProps } from "../contract.js";
import "../../features/proof/proof.css";
import "../../features/brand/brand.css";

export function Screen({ token }: BrandEntryProps) {
  const read = useBrandBundle(token);
  const runSlug = read.runSlug ?? "";
  const page = useProofPage(runSlug, read);
  const verification = useVerification(page.bundle, runSlug);
  const rail = usePaypalRail() ?? "simulator";
  const motion = useMotionMode();
  const members = page.snapshot?.members;
  const names = useMemo(
    () =>
      new Map<string, MemberLabel>(
        (members ?? []).map((m) => [m.memberNo, { name: m.displayName, receiverMasked: m.receiverMasked }]),
      ),
    [members],
  );

  const invoiceStatus = page.runView?.invoice.status ?? page.bundle?.invoice.status ?? null;
  const invoiceNumber = page.runView?.invoice.number ?? page.bundle?.invoice.invoiceNumber ?? null;
  const posted = page.runView ? isPosted(page.runView) : page.bundle !== null;
  const failed = verification.state.kind === "done" && verification.state.outcome.verdict === "failed";

  let state: BrandState;
  if (read.access === "checking" || page.snapshot === undefined) state = "loading";
  else if (read.access === "refused" || read.access === "failed") state = "error";
  else if (failed) state = "mismatch";
  else if (invoiceStatus && !FUNDED.includes(invoiceStatus)) state = "unpaid";
  else state = "progress";

  return (
    <ScreenRoot id="W-BR-01" state={state} as="main" className="pf br" labelledBy="W-BR-01-title">
      <div className="pf-page" data-verify={verifyAttr(verification)} data-motion={motion} data-rail={rail}>
        {state === "loading" ? (
          <div className="br-loading" data-testid="W-BR-01.loading" aria-busy="true">
            <h1 className="fs-sr" id="W-BR-01-title">
              Proof for the brand
            </h1>
            <PrintBed shape="plate" height={168} />
            <PrintBed shape="seal" width={320} height={320} />
          </div>
        ) : state === "error" ? (
          <div className="pf-state" data-testid="W-BR-01.error">
            <h1 className="pf-state__title" id="W-BR-01-title">
              {read.access === "refused" ? BRAND_COPY.refused : BRAND_COPY.failed}
            </h1>
            <p className="pf-state__lede">{BRAND_COPY.refusedHint}</p>
            {read.access === "failed" && (
              <CommandNotice error={read.error} testId="W-BR-01.error.notice" onRetry={read.refetch} />
            )}
            {runSlug && (
              <AppLink href={`/proof/${runSlug}`} className="fs-flat" data-testid="W-BR-01.public">
                {BRAND_COPY.openPublic}
              </AppLink>
            )}
          </div>
        ) : (
          <>
            <BrandHeader
              state={state}
              snapshot={page.snapshot}
              bundle={page.bundle}
              invoiceStatus={invoiceStatus}
              invoiceNumber={invoiceNumber}
              progress={page.progress}
              returnedCashPaid={returnedCashPaid(page.items, page.lineStates)}
              posted={posted && page.phase === "ready"}
              rail={rail}
              payoutReplayed={payoutReplayed(page.runView, page.bundle)}
              provenance={page.provenance ? provenanceWords(page.provenance) : null}
              showcase={isShowcase(page)}
            />
            <ProofView page={page} verification={verification} rail={rail} names={names} level="h2" />
          </>
        )}
      </div>
    </ScreenRoot>
  );
}
