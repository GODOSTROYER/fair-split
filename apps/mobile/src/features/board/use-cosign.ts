/**
 * The Chair's view of one co-sign request (M-BD-01/02). The phone recomputes the batch digest from the items it
 * shows (I4) and checks the server's approval payload against it; key 1's signature and the treasurer's presence
 * arrive over SSE. Presence is posted every 10 s while the request is open (S3.7).
 */
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CosignRequestDTO } from "../../_shims/api-client";
import type { ApprovalPayload, ApprovalSignedPayload, PresencePayload } from "../../_shims/contracts";
import { batchMatchesItems, checkApprovalPayload, type ExpectedBatch } from "../../lib/signing";
import { useApp } from "../../state/app";

export type CosignState = "loading" | "request" | "changed" | "expired" | "signed" | "offline" | "none";

export function expectedFor(dto: CosignRequestDTO): ExpectedBatch {
  return {
    runId: dto.runId,
    rateCardSha256: dto.rateCardSha256,
    batchSha256: dto.batchSha256,
    linesDigest: dto.linesDigest,
    itemCount: dto.itemCount,
    totalCents: dto.totalCents,
    role: "CHAIR",
  };
}

export function useCosign(runSlug: string) {
  const { api, online, markSynced } = useApp();
  const [dto, setDto] = useState<CosignRequestDTO | null>(null);
  const [payload, setPayload] = useState<ApprovalPayload | null>(null);
  const [state, setState] = useState<CosignState>("loading");
  const [presence, setPresence] = useState<string | null>(null);
  const [treasurerSigned, setTreasurerSigned] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const load = useCallback(async () => {
    const r = await api.getCosignRequest(runSlug);
    if (!alive.current) return;
    if (!r.ok) {
      setState(r.code === "NETWORK" ? "offline" : "none");
      return;
    }
    const d = r.value;
    setDto(d);
    setTreasurerSigned(!!d.treasurerSigned);
    if (d.presence) setPresence(d.presence.persona);
    markSynced();
    if (!batchMatchesItems(d)) {
      setState("changed");
      return;
    }
    if (d.state === "signed") {
      setState("signed");
      return;
    }
    if (Date.parse(d.expiresAt) <= Date.now() || d.state === "expired") {
      setState("expired");
      return;
    }
    const p = await api.getApprovalPayload(runSlug, "CHAIR");
    if (!alive.current) return;
    if (!p.ok) {
      setState(p.code === "NETWORK" ? "offline" : "none");
      return;
    }
    const check = checkApprovalPayload(p.value, expectedFor(d), new Date());
    if (!check.ok) {
      setState(check.problem === "expired" || check.problem === "too-far" ? "expired" : "changed");
      return;
    }
    setPayload(check.payload);
    setState("request");
  }, [api, runSlug, markSynced]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!dto) return;
    return api.subscribe(`run:${dto.runSlug}`, (e) => {
      if (e.type === "approval.signed") {
        const p = e.payload as ApprovalSignedPayload;
        if (p.role === "TREASURER") setTreasurerSigned(true);
        if (p.role === "CHAIR") setState("signed");
      } else if (e.type === "presence") {
        setPresence((e.payload as PresencePayload).persona);
      }
    });
  }, [api, dto]);

  // "Opening a hold emits presence": post it while this request is on screen (≤1 Hz; every 10 s here).
  useFocusEffect(
    useCallback(() => {
      if (!dto) return;
      const post = () => void api.postPresence({ view: `cosign:${dto.runSlug}` });
      post();
      const id = setInterval(post, 10_000);
      return () => clearInterval(id);
    }, [api, dto]),
  );

  return {
    dto,
    payload,
    state: !online && state === "request" ? ("offline" as const) : state,
    presence,
    treasurerSigned,
    reload: load,
    markSigned: () => setState("signed"),
  };
}
