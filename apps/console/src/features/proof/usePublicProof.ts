// The public tier's read: IC-01 `proof` (`GET /v1/proof/:runSlug`, anonymous). Member IDs only (C-23).

import { useMemo } from "react";
import { useCommandQuery } from "../../data/hooks.js";
import { queryKeys } from "../../data/query.js";
import { type BundleRead, type ProofPage, useProofPage } from "./useProof.js";

export function usePublicBundle(runSlug: string): BundleRead {
  const input = useMemo(() => ({ params: { runSlug } }), [runSlug]);
  const proof = useCommandQuery("proof", input, { staleTime: 60_000 });
  const queryKey = useMemo(() => queryKeys.command("proof", input), [input]);
  const { refetch } = proof;
  return useMemo(
    () => ({
      bundle: proof.data?.bundle ?? null,
      provenance: proof.data?.provenance ?? null,
      isPending: proof.isPending,
      error: proof.error,
      queryKey,
      refetch: () => void refetch(),
    }),
    [proof.data, proof.isPending, proof.error, queryKey, refetch],
  );
}

export function usePublicProof(runSlug: string): ProofPage {
  return useProofPage(runSlug, usePublicBundle(runSlug));
}
