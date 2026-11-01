// The router's fallbacks: a path the console does not have, and a screen that failed. Both say what
// happened and where to go, in the interface's voice; neither apologises.

import { Glyph } from "@fairsplit/ui-web";
import { type ErrorComponentProps, Link, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { requestIdOf } from "../data/errors.js";
import { Wordmark } from "./Wordmark.js";

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
