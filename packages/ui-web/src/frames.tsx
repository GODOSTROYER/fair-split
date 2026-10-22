// Frames and moment roots. Every moment root renders data-moment and data-moment-phase (S2 §2.0, rule 4),
// and in test builds or with ?fsTrace=1 appends {m, phase, t} to window.__fsMoments for Playwright.

import type { MomentId } from "@fairsplit/motion";
import { type ReactNode, useEffect } from "react";

declare global {
  interface Window {
    __fsMoments?: { m: string; phase: string; t: number }[];
  }
}

function tracing(): boolean {
  try {
    return (
      typeof window !== "undefined" && new URLSearchParams(window.location.search).get("fsTrace") === "1"
    );
  } catch {
    return false;
  }
}

export interface MomentRootProps {
  readonly id: MomentId;
  readonly phase: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly testId?: string;
}

export function MomentRoot({ id, phase, children, className, testId }: MomentRootProps) {
  useEffect(() => {
    if (!tracing()) return;
    window.__fsMoments ??= [];
    window.__fsMoments.push({ m: id, phase, t: performance.now() });
  }, [id, phase]);
  return (
    <section className={className} data-moment={id} data-moment-phase={phase} data-testid={testId}>
      {children}
    </section>
  );
}

export interface PhoneFrameProps {
  readonly children: ReactNode;
  /** Phone surfaces default to Adlaw, the daylight theme. */
  readonly theme?: "adlaw" | "tablea";
  readonly label: string;
  readonly caption?: string;
  readonly width?: number;
  readonly height?: number;
  readonly testId?: string;
}

/** A judge-stage phone frame. The frame is chrome; the screen inside is the app. */
export function PhoneFrame({
  children,
  theme = "adlaw",
  label,
  caption,
  width = 390,
  height = 844,
  testId,
}: PhoneFrameProps) {
  return (
    <figure className="fs-phone" data-testid={testId} style={{ width: width + 20 }}>
      <section className="fs-phone__bezel" aria-label={label}>
        <div className="fs-phone__screen" data-theme={theme} style={{ width, height }}>
          {children}
        </div>
      </section>
      {caption && <figcaption className="fs-phone__caption fs-t-caption">{caption}</figcaption>}
    </figure>
  );
}
