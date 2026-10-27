// What a phone frame shows until the app's web build answers fs.ready (and if it never does): a still of
// that persona's screen, drawn from the run the stage is showing, in Adlaw, and labelled as a preview.
// It never pretends to be the app: no controls, and a caption that says what it is. Member copy is
// Cebuano with the "machine-translated, pending native review" chip (S1.6).

import { MEMBER_LINE_LABELS, type MemberLineState, type SeasonSnapshot } from "@fairsplit/contracts";
import { translate } from "@fairsplit/i18n";
import { AmountDisplay, type CapsuleState, Glyph, StatusCapsule } from "@fairsplit/ui-web";
import { POSTER, STAGE } from "../chrome/copy.js";
import type { FramePersona } from "../data/adapter.js";
import { atLeast, type RunView } from "../data/run-view.js";
import { format } from "../lib/format.js";
import { HERO_MEMBER } from "./personas.js";

const CAPSULE: Partial<Record<MemberLineState, CapsuleState>> = {
  SUBMITTED: "sent",
  LOCKED: "sent",
  PAYPAL_PENDING: "sent",
  PAID: "paid",
  OFF_RAIL_DUE: "cash-due",
  OFF_RAIL_PAID: "received",
  UNCLAIMED: "unclaimed",
};

export interface FramePosterProps {
  readonly persona: FramePersona;
  readonly view: RunView | undefined;
  readonly snapshot: SeasonSnapshot | undefined;
  /** The app never answered: say so instead of waiting forever. */
  readonly asleep: boolean;
  /** The development stand-in answered: the preview stays, and says why. */
  readonly stub?: boolean;
}

export function FramePoster({ persona, view, snapshot, asleep, stub = false }: FramePosterProps) {
  const note = stub ? STAGE.frameStub : asleep ? STAGE.frameAsleep : STAGE.framePreview;
  return (
    <div className="fsc-poster" data-persona={persona} data-testid={`W-JG-01.poster.${persona}`}>
      <div className="fsc-poster__screen">
        {persona === "member" && <MemberPoster view={view} snapshot={snapshot} />}
        {persona === "chair" && <ChairPoster view={view} snapshot={snapshot} />}
        {persona === "clerk" && <ClerkPoster snapshot={snapshot} />}
      </div>
      <p className="fsc-poster__note fs-t-caption" data-state={stub ? "stub" : asleep ? "asleep" : "preview"}>
        <Glyph name={asleep && !stub ? "ms:wifi-off" : "ms:visibility"} size={14} />
        <span>{note}</span>
      </p>
    </div>
  );
}

function MemberPoster({
  view,
  snapshot,
}: {
  readonly view: RunView | undefined;
  readonly snapshot: SeasonSnapshot | undefined;
}) {
  const member = snapshot?.members.find((m) => m.memberNo === HERO_MEMBER);
  const state = view?.lines[HERO_MEMBER]?.state ?? "COMPUTED";
  const capsule: CapsuleState = CAPSULE[state] ?? "checking";
  const line = snapshot?.checkpoints.resolved.lines.find((l) => l.memberNo === HERO_MEMBER);
  const showAmount = capsule === "sent" || capsule === "paid" || capsule === "unclaimed";
  return (
    <div className="fsc-poster__statement" lang="ceb">
      <p className="fsc-poster__coop fs-t-caption">
        {snapshot
          ? `${snapshot.coop.shortName}, ${translate("ceb", "M-MB-01.season", { season: snapshot.season.label })}`
          : ""}
      </p>
      <p className="fsc-poster__greet fs-t-statement-lead">
        {translate("ceb", "M-MB-01.greeting", { name: member?.addressAs.ceb ?? "Nang Celing" })}
      </p>
      {showAmount && line && (
        <AmountDisplay
          amount={{ display: format.money(line.netCents), spoken: format.amountSpoken(line.netCents, "en") }}
          typeRole="amount-l"
          hollow={capsule !== "paid"}
          lang="ceb"
        />
      )}
      <StatusCapsule state={capsule} text={MEMBER_LINE_LABELS[state].ceb} lang="ceb" />
      <p className="fsc-poster__chip fs-t-caption" lang="en">
        <Glyph name="ms:translate" size={14} />
        <span>{translate("en", "W-JG-01.machineTranslated")}</span>
      </p>
    </div>
  );
}

function ChairPoster({
  view,
  snapshot,
}: {
  readonly view: RunView | undefined;
  readonly snapshot: SeasonSnapshot | undefined;
}) {
  const chair = snapshot?.officers.find((o) => o.role === "CHAIR");
  const waiting = view?.state === "AWAITING_BOARD" || view?.state === "TREASURER_APPROVED";
  const signed = view ? atLeast(view, "APPROVED") : false;
  return (
    <div className="fsc-poster__statement">
      <p className="fsc-poster__coop fs-t-caption">{chair ? POSTER.chairRole(chair.name) : ""}</p>
      {waiting && snapshot ? (
        <p className="fsc-poster__greet fs-t-statement-lead" lang="ceb">
          {translate("ceb", "M-BD-01.push", {
            season: snapshot.season.label,
            count: snapshot.figures.batchItemCount,
            amount: format.money(snapshot.figures.batchTotalCents),
          })}
        </p>
      ) : (
        <p className="fsc-poster__greet fs-t-statement-lead">{POSTER.chairIdle}</p>
      )}
      <p className="fsc-poster__chip fs-t-label">
        <Glyph name={signed ? "seal-fill" : "seal"} size={16} />
        <span>{POSTER.sign}</span>
      </p>
    </div>
  );
}

function ClerkPoster({ snapshot }: { readonly snapshot: SeasonSnapshot | undefined }) {
  const clerk = snapshot?.officers.find((o) => o.role === "CLERK");
  const station = snapshot?.coop.stations.find((s) => s.station === "PUROK_2")?.name;
  return (
    <div className="fsc-poster__statement">
      <p className="fsc-poster__coop fs-t-caption">{clerk ? POSTER.clerkRole(clerk.name) : ""}</p>
      <p className="fsc-poster__greet fs-t-statement-lead">{POSTER.clerkReady}</p>
      {station && (
        <p className="fsc-poster__chip fs-t-label">
          <Glyph name="triplicate-slip" size={16} />
          <span>{station}</span>
        </p>
      )}
    </div>
  );
}
