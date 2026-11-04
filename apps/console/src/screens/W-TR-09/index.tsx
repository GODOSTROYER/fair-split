// W-TR-09 Member line (S1.7, design §6 C9): beside the split while `?member=` is set, one member's line, why the
// number is the number, the slips it comes from, its history, an SMS preview that is never sent, and the cash-day
// actions. `PrintScreen` is the same line as an 80 mm statement on the daylight surface, for the bodega.

import { webRoutes } from "@fairsplit/contracts";
import { Glyph } from "@fairsplit/ui-web";
import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useCallback } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { RunRouteGate } from "../../chrome/Fallbacks.js";
import { PrintBed } from "../../chrome/PrintBed.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { StageDrawer } from "../../chrome/StageDrawer.js";
import { MemberLine } from "../../features/print/MemberLine.js";
import { findRow, lineScreenState } from "../../features/print/model.js";
import { PrintStatement } from "../../features/print/PrintStatement.js";
import { LINE } from "../../features/split/shared/copy.js";
import { useRunData } from "../../features/split/shared/run-data.js";
import type { ScreenState } from "../../lib/screens.js";
import type { MemberLineProps, PrintScreenProps } from "../contract.js";
import "../../features/split/shared/runs.css";
import "../../features/print/print.css";

export function Screen({ runSlug, memberNo }: MemberLineProps) {
  const data = useRunData(runSlug);
  const { snapshot, view } = data;
  const router = useRouter();
  const close = useCallback(() => router.history.push(webRoutes.split(runSlug)), [router, runSlug]);
  const member = snapshot?.members.find((m) => m.memberNo === memberNo);
  const row = snapshot && view ? findRow(snapshot, view, memberNo) : undefined;
  const label = member ? `${member.displayName}'s line` : `Line ${memberNo}`;

  if (data.access === "missing") return <RunRouteGate data={data} />;

  let body: ReactNode;
  if (data.error && !view) {
    body = (
      <ScreenRoot id="W-TR-09" state="error" className="fsr-line-screen" labelledBy="W-TR-09-title">
        <h2 id="W-TR-09-title" className="fs-sr">
          {label}
        </h2>
        <CommandNotice error={data.error} testId="W-TR-09.error" onRetry={data.retry} />
      </ScreenRoot>
    );
  } else if (!snapshot || !view) {
    body = (
      <ScreenRoot id="W-TR-09" state="loading" className="fsr-line-screen" labelledBy="W-TR-09-title">
        <h2 id="W-TR-09-title" className="fs-sr">
          {label}
        </h2>
        <div className="fsr-line__beds" aria-hidden data-testid="W-TR-09.loading">
          <PrintBed shape="block" height={72} />
          <PrintBed shape="line" count={4} />
          <PrintBed shape="photo" height={140} />
        </div>
        <p className="fs-sr" role="status">
          {LINE.loading}
        </p>
      </ScreenRoot>
    );
  } else if (!member || !row) {
    body = (
      <ScreenRoot id="W-TR-09" state="error" className="fsr-line-screen" labelledBy="W-TR-09-title">
        <div className="fsr-empty" data-testid="W-TR-09.notFound">
          <h2 id="W-TR-09-title" className="fs-t-title-2">
            {LINE.notFound}
          </h2>
          <p className="fsr-muted">{LINE.notFoundHelp}</p>
          <AppLink href={webRoutes.split(runSlug)} className="fs-link fs-t-label">
            {LINE.printBack}
          </AppLink>
        </div>
      </ScreenRoot>
    );
  } else {
    const state = lineScreenState(view, row);
    const screenState: ScreenState<"W-TR-09"> = state;
    body = (
      <ScreenRoot id="W-TR-09" state={screenState} className="fsr-line-screen" labelledBy="W-TR-09-title">
        <MemberLine
          snapshot={snapshot}
          view={view}
          member={member}
          row={row}
          state={state}
          live={data.live}
          printHref={webRoutes.memberPrint(runSlug, memberNo)}
        />
      </ScreenRoot>
    );
  }

  return (
    <StageDrawer label={label} meta={memberNo} onClose={close} testId="W-TR-09.drawer">
      {body}
    </StageDrawer>
  );
}

export function PrintScreen({ runSlug, memberNo }: PrintScreenProps) {
  const data = useRunData(runSlug);
  const { snapshot, view } = data;
  const member = snapshot?.members.find((m) => m.memberNo === memberNo);
  const row = snapshot && view ? findRow(snapshot, view, memberNo) : undefined;

  if (data.access === "missing") return <RunRouteGate data={data} />;

  const tools = (
    <nav className="fsr-print__tools" aria-label={LINE.printTitle}>
      <AppLink href={webRoutes.memberLine(runSlug, memberNo)} className="fs-link fs-t-label">
        {LINE.printBack}
      </AppLink>
      <button
        type="button"
        className="fs-flat"
        onClick={() => window.print()}
        disabled={!row}
        data-testid="W-TR-09.print.button"
      >
        <Glyph name="ms:print" size={18} />
        {LINE.printButton}
      </button>
    </nav>
  );

  if (data.error && !view) {
    return (
      <ScreenRoot id="W-TR-09" state="error" as="main" className="fsr-print" labelledBy="W-TR-09-print-title">
        {tools}
        <h1 id="W-TR-09-print-title" className="fs-sr">
          {LINE.printTitle}
        </h1>
        <CommandNotice error={data.error} testId="W-TR-09.error" onRetry={data.retry} />
      </ScreenRoot>
    );
  }
  if (!snapshot || !view) {
    return (
      <ScreenRoot
        id="W-TR-09"
        state="loading"
        as="main"
        className="fsr-print"
        labelledBy="W-TR-09-print-title"
      >
        {tools}
        <h1 id="W-TR-09-print-title" className="fs-sr">
          {LINE.printTitle}
        </h1>
        <div className="fsr-paper80 fsr-paper80--beds" aria-hidden data-testid="W-TR-09.loading">
          <PrintBed shape="line" count={3} />
          <PrintBed shape="block" height={64} />
          <PrintBed shape="seal" width={120} height={120} />
        </div>
      </ScreenRoot>
    );
  }
  if (!member || !row) {
    return (
      <ScreenRoot id="W-TR-09" state="error" as="main" className="fsr-print" labelledBy="W-TR-09-print-title">
        {tools}
        <div className="fsr-empty" data-testid="W-TR-09.notFound">
          <h1 id="W-TR-09-print-title" className="fs-t-title-2">
            {LINE.notFound}
          </h1>
        </div>
      </ScreenRoot>
    );
  }
  const state = lineScreenState(view, row);
  return (
    <ScreenRoot id="W-TR-09" state={state} as="main" className="fsr-print" labelledBy="W-TR-09-print-title">
      {tools}
      <PrintStatement snapshot={snapshot} view={view} member={member} row={row} state={state} />
    </ScreenRoot>
  );
}
