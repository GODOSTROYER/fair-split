// The router's fallbacks: a path the console does not have, and a screen that failed. Both say what
// happened and where to go, in the interface's voice; neither apologises.

import { Glyph } from "@fairsplit/ui-web";
import { type ErrorComponentProps, Link, useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { requestIdOf } from "../data/errors.js";
import type { RunAccess } from "../features/split/shared/run-data.js";
import { PrintBed } from "./PrintBed.js";
import { Wordmark } from "./Wordmark.js";

/** No amounts can render until the cookie has resumed this tab's own run. */
export function RunRouteGate({
  data,
  children,
}: {
  readonly data: { readonly access: RunAccess; readonly startFresh?: (() => Promise<void>) | undefined };
  readonly children?: ReactNode;
}) {
  const [resetFailed, setResetFailed] = useState(false);
  if (data.access === "allowed") return children;
  if (data.access === "pending")
    return (
      <section className="fsc-fallback" data-testid="run-visit.pending" data-state="loading">
        <p role="status">Resuming this visit…</p>
        <PrintBed shape="line" count={3} />
        <PrintBed shape="block" height={140} />
      </section>
    );
  return (
    <section className="fsc-fallback" data-testid="run-visit.missing">
      <h1 className="fs-t-title-2">This run belongs to another visit.</h1>
      <p className="fsc-fallback__links">
        <a
          className="fs-flat"
          href="/judge"
          onClick={(event) => {
            if (!data.startFresh) return;
            event.preventDefault();
            setResetFailed(false);
            void data
              .startFresh()
              .then(() => window.location.assign("/judge"))
              .catch(() => setResetFailed(true));
          }}
        >
          Start a fresh run
        </a>
        <a className="fs-link fs-t-label" href="/prototype">
          Open the showcase
        </a>
      </p>
      {resetFailed && <p role="alert">This visit could not be reset. Try again.</p>}
    </section>
  );
}

export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} – Fair Split` : "Fair Split: co-op payroll";
  }, [title]);
}

export function NotFound() {
  useDocumentTitle("Not here");
  return (
    <main className="fsc-fallback" data-testid="not-found">
      <Wordmark />
      <h1 className="fs-t-title-1">This page isn't part of the console.</h1>
      <p className="fsc-fallback__lede">The address may be from an older run, or mistyped.</p>
      <p className="fsc-fallback__links">
        <Link to="/judge" className="fs-flat" data-testid="not-found.judge">
          <Glyph name="sack" size={18} />
          Open the Judge stage
        </Link>
        <Link to="/prototype" className="fs-link fs-t-label">
          Open the design prototype
        </Link>
      </p>
    </main>
  );
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  useDocumentTitle("Something failed");
  const requestId = requestIdOf(error);
  return (
    <main className="fsc-fallback" role="alert" data-testid="route-error" data-state="error">
      <Wordmark />
      <h1 className="fs-t-title-1">This screen didn't load.</h1>
      <p className="fsc-fallback__lede">{error instanceof Error ? error.message : "Unknown failure."}</p>
      {requestId && <p className="fs-t-caption fsc-fallback__meta">Request {requestId}</p>}
      <p className="fsc-fallback__links">
        <button
          type="button"
          className="fs-flat"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
          data-testid="route-error.retry"
        >
          <Glyph name="ms:restart-alt" size={18} />
          Try again
        </button>
        <Link to="/judge" className="fs-link fs-t-label">
          Back to the Judge stage
        </Link>
      </p>
    </main>
  );
}
