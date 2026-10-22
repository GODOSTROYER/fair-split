// The sign-off sheet: what gate G1 covers, where each part lives, and the decisions made while building.

import { contrastResults } from "@fairsplit/tokens";
import { Glyph } from "@fairsplit/ui-web";
import { Link } from "@tanstack/react-router";
import { PageTitle, Section } from "../Shell.js";
import { COMPOSITIONS, STUDY_MOMENTS } from "../search.js";

export function OverviewPage() {
  const contrast = contrastResults();
  const failing = contrast.filter((r) => !r.pass).length;
  return (
    <div data-testid="W-DP-01.overview">
      <PageTitle
        title="G1 design prototype"
        lede={
          <>
            What you sign off at gate G1 (register §12): the token sheet with its contrast results, the five
            primitives in every state including reduced motion, six screens composed from the register’s
            figures, and motion studies of Two keys and Bayad na. Everything renders from the shared packages,
            so what you approve here is what the console, the app and Proof are built from.
          </>
        }
      />

      <Section title="What to sign off">
        <dl className="proto-dl">
          <dt>Tokens</dt>
          <dd>
            <Link to="/prototype/tokens" search={(prev) => prev} className="fs-link">
              Token sheet
            </Link>{" "}
            in Tablea and Adlaw: colour, type, space, depth and motion. {contrast.length} declared colour
            pairs, {failing === 0 ? "all at or above their floor" : `${failing} below their floor`}.
          </dd>
          <dt>Primitives</dt>
          <dd>
            <Link to="/prototype/primitives" search={(prev) => prev} className="fs-link">
              Slab, Print, Seal, ReceiptBar and HoldCard
            </Link>{" "}
            in every state, in both themes, under the motion switch above. The live ones respond to pointer
            and keyboard.
          </dd>
          <dt>Screens</dt>
          <dd>
            <ul className="proto-list">
              {COMPOSITIONS.map((c) => (
                <li key={c.id}>
                  <Link
                    to="/prototype/compositions/$composition"
                    params={{ composition: c.id }}
                    search={(prev) => prev}
                    className="fs-link"
                  >
                    {c.title}
                  </Link>{" "}
                  <span className="proto-label">
                    {c.screen}. {c.note}.
                  </span>
                </li>
              ))}
            </ul>
          </dd>
          <dt>Moments</dt>
          <dd>
            <ul className="proto-list">
              {STUDY_MOMENTS.map((m) => (
                <li key={m.id}>
                  <Link
                    to="/prototype/moments/$moment"
                    params={{ moment: m.id }}
                    search={(prev) => prev}
                    className="fs-link"
                  >
                    {m.title} ({m.id})
                  </Link>{" "}
                  <span className="proto-label">
                    on {m.screens}. Scrub any frame, play it, compare reduced motion and the low tier.
                  </span>
                </li>
              ))}
            </ul>
          </dd>
        </dl>
      </Section>

      <Section
        title="How to review"
        brief="The prototype runs the real components, so it can be reviewed the way people will use them."
      >
        <ul className="proto-list">
          <li>
            Tab moves the pod-coloured focus ring; it travels with a slab’s face when the face is pressed.
          </li>
          <li>
            On Approve, hold Space (or the pointer) for 1.6 s. Let go early to see the face spring back.
            Enter, or “Can’t hold? Approve another way”, opens the dialog route.
          </li>
          <li>
            The motion switch compares the full renderer with reduced motion and the low tier. “System”
            follows your operating system.
          </li>
          <li>Sound stays off until you turn it on; it is remembered in this browser only.</li>
          <li>Every view is a link: the theme, motion, language and moment time live in the address.</li>
        </ul>
      </Section>

      <Section
        title="Decisions made while building"
        brief="Each one is in the WS-DS report; none changes the register."
      >
        <dl className="proto-dl">
          <dt>The zero</dt>
          <dd>
            Mona Sans’ tabular zero is already slashed, so money, kilos and hashes use tabular figures alone.
            The stylistic set S2 suggested (ss08) swaps the slash for a straight bar; both sit side by side on
            the token sheet for your choice.
          </dd>
          <dt>The peso sign</dt>
          <dd>
            Neither Mona Sans nor Atkinson Hyperlegible Next has ₱. A 2 KB Noto Sans subset joins “FS Sans”
            for that one glyph on the web, and is grafted into the four native cuts (spike S8’s fallback).
          </dd>
          <dt>Red on its wash</dt>
          <dd>
            In Tablea the red wash mixes at 10%, not 14%, so red copy on it measures 4.56:1 instead of 4.29:1.
          </dd>
          <dt>Moment phases</dt>
          <dd>
            Phase names follow S2 §2.9 where S1 §1.9 differs; the supporting beat takes the register’s ID,
            MM-S, with S2’s “BEAT-PAID” as an alias.
          </dd>
          <dt>Placeholders</dt>
          <dd>
            <span className="proto-check">
              <Glyph name="triplicate-slip" size={16} />
              Slip photos are drawn placeholders until WS-MEDIA’s photos land; the co-sign QR is a placeholder
              until the pairing route exists. Hashes on these pages are real SHA-256 digests of the
              prototype’s fixture.
            </span>
          </dd>
        </dl>
      </Section>

      <Section title="Open checks this gate settles">
        <ul className="proto-list">
          <li>Legibility of the slashed and straight-bar zeros at 13 px (token sheet, type).</li>
          <li>
            Whether the hatch reads at 1080p: the cash rail, the unavailable slab and the dial’s over-limit
            band.
          </li>
          <li>
            Safari composing the ₱ face with font-stretch (WebKit snapshot): look at “₱4,028” on the
            statement.
          </li>
        </ul>
      </Section>
    </div>
  );
}
