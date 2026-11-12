// The screen's one primary when its next action is a place to go, not a commit (UI gate round 4: the settled Run's
// "Review cash handover"). It wears the Slab's own face (ui-web's `.fs-slab` rules: indigo, 48 px, radius 12, label
// 16/600, hugging its label) but stays a real link: a new tab, copy link and a middle click all work, and a plain
// click navigates inside the SPA. Nothing is signed or moved by it, so it has no hold and no depth of its own.

import { Glyph, type GlyphName } from "@fairsplit/ui-web";
import type { ReactNode } from "react";
import { AppLink } from "../../chrome/AppLink.js";

export interface PrimaryLinkProps {
  readonly href: string;
  readonly children: ReactNode;
  readonly glyph?: GlyphName;
  readonly className?: string;
  readonly testId?: string;
}

export function PrimaryLink({ href, children, glyph, className, testId }: PrimaryLinkProps) {
  return (
    <span
      className={["fs-slab", className].filter(Boolean).join(" ")}
      data-tone="chalk"
      data-depth="d1"
      data-size="l"
      data-state="rest"
    >
      <span className="fs-slab__body">
        <AppLink href={href} className="fs-slab__face" data-testid={testId}>
          <span className="fs-slab__label">
            {glyph && <Glyph name={glyph} size={24} />}
            <span className="fs-slab__words">{children}</span>
          </span>
        </AppLink>
      </span>
    </span>
  );
}
