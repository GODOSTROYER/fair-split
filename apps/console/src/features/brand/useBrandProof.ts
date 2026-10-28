// The brand tier's read (W-BR-01, S3.8, S3.12): the signed brand link `/b/:token` is the credential. It goes with
// one request, IC-01 `proof` (GET /v1/proof/:runSlug, which "returns whatever the credential allows": the full
// tier for a brand link of the workspace), as a bearer token, and is never shown, logged, stored or put in a
// query key (the key holds a short fingerprint). `proofExport` is an acting command (frame_or_session) that
// fs-api refuses to every signed link, so it is never the brand's read. A link that only earns the public tier
// (redacted) did not grant the brand tier: that reads as refused. The link names a workspace, not a run: the
// brand sees the run this console holds, the judge session's own run or else the season's run.

import { isApiClientError } from "@fairsplit/api-client";
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
  // The public tier (member IDs only) is what any visitor gets: the link earned nothing more.
  const publicOnly = query.data?.redacted === true;
  const access: BrandAccess =
    runSlug === null || query.isPending
      ? "checking"
      : publicOnly
        ? "refused"
        : query.error && !notFound
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
      isPending: runSlug === null || query.isPending,
      error: query.error,
      queryKey,
      refetch: () => void refetch(),
    }),
    [runSlug, access, publicOnly, query.data, query.isPending, query.error, queryKey, refetch],
  );
}
