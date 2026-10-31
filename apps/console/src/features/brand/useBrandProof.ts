// The brand tier's read (W-BR-01, S3.8, S3.12): the signed brand link `/b/:token` is the credential. It goes with
// one request, IC-01 `proof` (GET /v1/proof/:runSlug, which "returns whatever the credential allows": the full
// tier for a brand link of the workspace), as a bearer token, and is never shown, logged, stored or put in a
// query key (the key holds a short fingerprint). `proofExport` is an acting command (frame_or_session) that
// fs-api refuses to every signed link, so it is never the brand's read. A link that only earns the public tier
// (redacted) did not grant the brand tier: that reads as refused. The link names a workspace, not a run: the
// brand sees the run this console holds, the judge session's own run or else the season's run. fs-api looks the
// run up before it reads the credential, so its 404 (no run posted yet) says nothing about the link: the console
// then asks who the link is (GET /v1/credential, the link as the bearer) and grants nothing until fs-api names it
// a brand link. An invalid link never shows the brand's header.

import { isApiClientError, judgeRoutes } from "@fairsplit/api-client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAdapter, useJudgeSession, useSnapshot } from "../../data/hooks.js";
import { sha256Hex } from "../../lib/sha256.js";
import type { BundleRead } from "../proof/useProof.js";

export type BrandAccess = "checking" | "granted" | "refused" | "failed";

export interface BrandRead extends BundleRead {
  readonly runSlug: string | null;
  readonly access: BrandAccess;
}

/** A short, one-way name for the link in caches and keys: the token itself never leaves the request. */
export function linkFingerprint(token: string): string {
  return sha256Hex(`fs.brand-link:${token}`).slice(0, 16);
}

/** Refusals of the credential itself (expired, revoked, not a brand link). */
export function isRefusal(error: unknown): boolean {
  return isApiClientError(error, "UNAUTHENTICATED", "FORBIDDEN", "FRAME_TOKEN_EXPIRED");
}

export function useBrandBundle(token: string): BrandRead {
  const adapter = useAdapter();
  const snapshot = useSnapshot().data;
  const session = useJudgeSession().session;
  const runSlug = session?.runSlug ?? snapshot?.run.runSlug ?? null;
  const fingerprint = useMemo(() => linkFingerprint(token), [token]);
  const queryKey = useMemo(() => ["brand-proof", runSlug, fingerprint] as const, [runSlug, fingerprint]);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => adapter.api.proof({ params: { runSlug: runSlug ?? "" }, token, signal }),
    enabled: runSlug !== null,
    staleTime: 60_000,
    retry: false,
  });
  const { refetch } = query;
  const notFound = isApiClientError(query.error, "NOT_FOUND");
  // No run to read yet: is the link the brand's at all? Asked only then, with the same fingerprinted key.
  const link = useQuery({
    queryKey: ["brand-link", fingerprint] as const,
    queryFn: ({ signal }) => judgeRoutes(adapter.api).whoami({ token, signal }),
    enabled: notFound,
    staleTime: 60_000,
    retry: false,
  });
  const { refetch: recheck } = link;
  // The public tier (member IDs only) is what any visitor gets: the link earned nothing more.
  const publicOnly = query.data?.redacted === true;
  const linkAccess: BrandAccess = link.isPending
    ? "checking"
    : link.data?.kind === "brand_link"
      ? "granted"
      : link.error && !isRefusal(link.error)
        ? "failed"
        : "refused";
  const access: BrandAccess =
    runSlug === null || query.isPending
      ? "checking"
      : publicOnly
        ? "refused"
        : notFound
          ? linkAccess
          : query.error
            ? isRefusal(query.error)
              ? "refused"
              : "failed"
            : "granted";
  return useMemo(
    () => ({
      runSlug,
      access,
      bundle: publicOnly ? null : (query.data?.bundle ?? null),
      provenance: publicOnly ? null : (query.data?.provenance ?? null),
      isPending: access === "checking",
      error: notFound && link.error ? link.error : query.error,
      queryKey,
      refetch: () => {
        void refetch();
        if (notFound) void recheck();
      },
    }),
    [runSlug, access, publicOnly, query.data, query.error, notFound, link.error, queryKey, refetch, recheck],
  );
}
