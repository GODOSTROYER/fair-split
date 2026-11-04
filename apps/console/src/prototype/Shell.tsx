// The G1 prototype shell (W-DP-01, /prototype): a flat 220 px rail like the console's, a sticky bar with the
// theme, motion and sound controls, and the page. Screen compositions render full-bleed at true scale.

import { withoutTransitions } from "@fairsplit/motion/web";
import { UiProvider } from "@fairsplit/ui-web";
import { Link, Outlet, useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { Segmented, SoundToggle } from "./controls.js";
import {
  COMPOSITIONS,
  type LangChoice,
  type MotionChoice,
  type PrototypeSearch,
  STUDY_MOMENTS,
  type ThemeChoice,
} from "./search.js";
import "./prototype.css";

/**
 * The prototype's URL state. Typed here rather than inferred: the route tree imports the pages that call this,
 * and that cycle would otherwise leave the inferred type as `any`.
 */
export function useProtoSearch(): PrototypeSearch {
  return useSearch({ from: "/prototype" });
}

function useApplyTheme(theme: ThemeChoice) {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.theme === theme) return;
    withoutTransitions(() => {
      root.dataset.theme = theme;
      root.dataset.agThemeMode = `fs-${theme}`;
    });
  }, [theme]);
}

const NAV: readonly {
  readonly to: string;
  readonly label: string;
  readonly params?: Record<string, string>;
}[] = [
  { to: "/prototype", label: "Sign-off" },
  { to: "/prototype/tokens", label: "Tokens" },
  { to: "/prototype/primitives", label: "Primitives" },
  { to: "/prototype/seal-sheet", label: "Seal sheet" },
];

export function PrototypeLayout() {
  const search = useProtoSearch();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const theme: ThemeChoice = search.theme ?? "adlaw";
  const motion: MotionChoice = search.motion ?? "system";
  const lang: LangChoice = search.lang ?? "ceb";
  useApplyTheme(theme);
  const fullBleed = pathname.startsWith("/prototype/compositions/");
  const composition = COMPOSITIONS.find((c) => pathname.endsWith(`/compositions/${c.id}`));
  const set = (patch: Partial<typeof search>) =>
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }),
      replace: true,
    });

  const controls = (
    <div
      className={fullBleed ? "proto-controls proto-controls--compact" : "proto-controls"}
      data-testid="W-DP-01.controls"
    >
      <Segmented
        label="Theme"
        value={theme}
        options={[
          { value: "adlaw", label: "Hayag" },
          { value: "tablea", label: "Gabii" },
        ]}
        onChange={(v) => set({ theme: v })}
        testId="W-DP-01.theme"
      />
      <Segmented
        label="Motion"
        value={motion}
        options={[
          { value: "system", label: "System" },
          { value: "full", label: "Full" },
          { value: "reduced", label: "Reduced" },
          { value: "low", label: "Low" },
        ]}
        onChange={(v) => set({ motion: v })}
        testId="W-DP-01.motion"
      />
      <Segmented
        label="Member"
        value={lang}
        options={[
          { value: "ceb", label: "ceb" },
          { value: "fil", label: "fil" },
          { value: "en", label: "en" },
        ]}
        onChange={(v) => set({ lang: v })}
        testId="W-DP-01.lang"
      />
      <SoundToggle testId="W-DP-01.sound" />
    </div>
  );

  return (
    <UiProvider lang="en" motion={motion}>
      <div
        className="proto"
        data-testid="W-DP-01"
        data-full-bleed={fullBleed ? "" : undefined}
        data-motion={motion === "system" ? undefined : motion}
      >
        {fullBleed ? (
          <header className="proto-strip">
            <p className="proto-strip__where">
              <Link to="/prototype" search={(prev) => prev} className="proto-strip__back fs-t-label">
                G1 prototype
              </Link>
              {composition && (
                <span className="fs-t-caption proto-strip__screen">
                  {composition.screen}: {composition.title}. Register §2 figures, prototype fixture.
                </span>
              )}
            </p>
            {controls}
          </header>
        ) : (
          <>
            <nav className="proto-rail" aria-label="Prototype">
              <div className="proto-rail__lockup">
                <p className="proto-rail__name">Fair Split</p>
                <p className="fs-t-caption">co-op payroll</p>
              </div>
              <p className="proto-rail__gate fs-t-caption">Design prototype, gate G1</p>
              <ul className="proto-rail__list">
                {NAV.map((item) => (
                  <li key={item.to}>
                    <RailLink to={item.to}>{item.label}</RailLink>
                  </li>
                ))}
              </ul>
              <p className="proto-rail__group fs-t-caption">Screens</p>
              <ul className="proto-rail__list">
                {COMPOSITIONS.map((c) => (
                  <li key={c.id}>
                    <Link
                      to="/prototype/compositions/$composition"
                      params={{ composition: c.id }}
                      search={(prev) => prev}
                      className="proto-rail__link"
                      activeProps={{ "aria-current": "page" }}
                    >
                      <span>{c.title}</span>
                      <span className="proto-rail__screen fs-t-caption">{c.screen}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="proto-rail__group fs-t-caption">Moments</p>
              <ul className="proto-rail__list">
                {STUDY_MOMENTS.map((m) => (
                  <li key={m.id}>
                    <Link
                      to="/prototype/moments/$moment"
                      params={{ moment: m.id }}
                      search={(prev) => ({ ...prev, t: undefined, study: undefined })}
                      className="proto-rail__link"
                      activeProps={{ "aria-current": "page" }}
                    >
                      <span>{m.title}</span>
                      <span className="proto-rail__screen fs-t-caption">{m.id}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="proto-rail__mark" aria-hidden>
                2026-A
              </p>
            </nav>
            <div className="proto-main">
              <header className="proto-bar">{controls}</header>
              <main className="proto-page">
                <Outlet />
              </main>
            </div>
          </>
        )}
        {fullBleed && (
          <main className="proto-bleed">
            <Outlet />
          </main>
        )}
      </div>
    </UiProvider>
  );
}

function RailLink({ to, children }: { readonly to: string; readonly children: ReactNode }) {
  return (
    <Link
      to={to}
      search={(prev) => prev}
      className="proto-rail__link"
      activeOptions={{ exact: true }}
      activeProps={{ "aria-current": "page" }}
    >
      {children}
    </Link>
  );
}

/** A page section with a title and a short brief of what to look for. */
export function Section({
  title,
  brief,
  children,
  testId,
}: {
  readonly title: string;
  readonly brief?: ReactNode;
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <section className="proto-section" data-testid={testId}>
      <header className="proto-section__head">
        <h2 className="fs-t-title-2">{title}</h2>
        {brief && <p className="proto-section__brief">{brief}</p>}
      </header>
      {children}
    </section>
  );
}

export function PageTitle({ title, lede }: { readonly title: string; readonly lede?: ReactNode }) {
  return (
    <header className="proto-title">
      <h1 className="fs-t-title-1">{title}</h1>
      {lede && <p className="proto-title__lede">{lede}</p>}
    </header>
  );
}
