// What a phone frame shows until the app's web build answers fs.ready (and if it never does): a still of
// that persona's screen, drawn from the run the stage is showing, in Adlaw, and labelled as a preview.
// It never pretends to be the app: no controls, and a caption that says what it is. Member copy is
// Cebuano; "machine-translated, pending native review" is said to assistive technology (UI gate round 5: no legend
// glyph in the frame; the stage's indicator and What's real cover it). The Chair's seal is the console's, at 180 px.

import { MEMBER_LINE_LABELS, type MemberLineState, type SeasonSnapshot } from "@fairsplit/contracts";
import { translate } from "@fairsplit/i18n";
import { sealHash } from "@fairsplit/seal";
import { LAYOUT } from "@fairsplit/tokens";
import { AmountDisplay, type CapsuleState, Glyph, HONESTY, Seal, StatusCapsule } from "@fairsplit/ui-web";
import { POSTER, STAGE } from "../chrome/copy.js";
import type { FramePersona } from "../data/adapter.js";
import { payoutStatus } from "../data/payout-replay.js";
import { atLeast, type RunView } from "../data/run-view.js";
import { batchHashOf, sealKeys } from "../features/approve/model.js";
import { format } from "../lib/format.js";
import { HERO_MEMBER, personaStatus } from "./personas.js";

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
  const payout = payoutStatus({ state, view, memberNo: HERO_MEMBER });
  const capsule: CapsuleState = payout.replayed ? "sent" : (CAPSULE[state] ?? "checking");
  const line = snapshot?.checkpoints.resolved.lines.find((l) => l.memberNo === HERO_MEMBER);
  const showAmount = capsule === "sent" || capsule === "paid" || capsule === "unclaimed";
  return (
    <div className="fsc-poster__statement" lang="ceb">
      <p className="fsc-poster__coop fs-t-caption">
        {snapshot
          ? `${snapshot.coop.shortName}, ${translate("ceb", "M-MB-01.season", { season: snapshot.season.label })}`
          : ""}
        <span className="fs-sr">{`. ${HONESTY.machineTranslated.label}`}</span>
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
      <StatusCapsule
        state={capsule}
        text={personaStatus("member", view) ?? MEMBER_LINE_LABELS[state].ceb}
        lang={payout.replayed ? "en" : "ceb"}
      />
    </div>
  );
}

/**
 * The Chair's co-sign request and sign sheet (M-BD-01/02) as a still: the amount at the app's hero size in pencil
 * (nobody has finished signing), why him, the seal at 1 of 2 with its hash to compare with the console, and the
 * "Pirmahi" slab drawn flush and hatched, labelled as a preview: the poster has no controls.
 */
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
  const hash = view ? batchHashOf(view, null) : null;
  if (!(waiting || signed) || !snapshot || !view) {
    return (
      <div className="fsc-poster__statement">
        <p className="fsc-poster__coop fs-t-caption">{chair ? POSTER.chairRole(chair.name) : ""}</p>
        <p className="fsc-poster__greet fs-t-statement-lead">{POSTER.chairIdle}</p>
      </div>
    );
  }
  const cents = snapshot.figures.batchTotalCents;
  const keys = sealKeys(view);
  return (
    <div className="fsc-poster__statement fsc-poster__chair" data-testid="W-JG-01.poster.chair.request">
      <p className="fsc-poster__coop fs-t-caption">
        {chair ? POSTER.chairRole(chair.name) : ""}
        <span className="fs-sr">{`. ${HONESTY.machineTranslated.label}`}</span>
      </p>
      <p className="fsc-poster__title fs-t-label" lang="ceb">
        {POSTER.chairTitle(snapshot.season.label)}
      </p>
      <p className="fsc-poster__amount" data-amount-state={signed ? "ink" : "pencil"}>
        {format.money(cents)}
      </p>
      <p className="fsc-poster__why fs-t-caption" lang="ceb">
        {translate("ceb", "M-BD-01.why", {
          threshold: format.money(snapshot.rateCard.canonical.rules.cosign.batchOverCents),
        })}
      </p>
      {hash && (
        <figure className="fsc-poster__seal">
          <Seal batchSha256={hash} size={LAYOUT.app.seal} keys={keys} />
          <figcaption className="fs-t-hash">{sealHash(hash)}</figcaption>
        </figure>
      )}
      <div className="fsc-poster__slab" data-signed={signed ? "" : undefined}>
        <span className="fsc-poster__slab-face fs-t-slab" lang="ceb" aria-hidden>
          <Glyph name="ms:fingerprint" size={18} />
          {translate("ceb", "M-BD-02.sign")}
        </span>
        <span className="fsc-poster__slab-note fs-t-caption">{POSTER.slabPreview}</span>
      </div>
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
