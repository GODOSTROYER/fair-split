// Everything W-PF-01 (and the brand view on top of it) reads, assembled once: the served Proof bundle (IC-01
// `proof`, or the brand tier's `proofExport`), the public aggregate stream ("3 of 8 confirmed"), and, when the
// viewer is the judge whose session this run is, that run's own live view over its SSE stream. State that moves
// arrives as events; nothing here polls, and a progress picture only moves forward (I5).

import { isApiClientError } from "@fairsplit/api-client";
import {
  type MemberLineState,
  PAY_RUN_RANK,
  type ProofBundle,
  type Provenance,
  type SeasonSnapshot,
} from "@fairsplit/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAdapter, useJudgeSession, useRunStream, useRunView, useSnapshot } from "../../data/hooks.js";
import type { RunView } from "../../data/run-view.js";
import {
  deriveFigures,
  type FeeFigures,
  type ProofFigures,
  ServedHoldMetrics,
  seededFees,
} from "./metrics.js";
import {
  advanceProgress,
  countItems,
  isSettled,
  type LedgerFacts,
  type LineStates,
  type LiveItem,
  ledgerFacts,
  liveItems,
  mergeItems,
  type ProgressCounts,
  type ProofItemView,
  receiversWithheld,
} from "./model.js";
import { progressFromMessage } from "./progress.js";

export type ProofPhase = "loading" | "error" | "none" | "ready";

/** What the bundle read gives the page: the served record, or why there is none. */
export interface BundleRead {
  readonly bundle: ProofBundle | null;
  readonly provenance: Provenance | null;
  readonly isPending: boolean;
  readonly error: unknown;
  /** The API's own query key, so a settled picture can refresh the bundle once. */
  readonly queryKey: readonly unknown[];
  refetch(): void;
}

export interface ProofPage {
  readonly phase: ProofPhase;
  readonly error: unknown;
  readonly retry: () => void;
  readonly runSlug: string;
  readonly bundle: ProofBundle | null;
  readonly provenance: Provenance | null;
  /** The public tier: payout receivers withheld (C-23). */
  readonly withheld: boolean;
  readonly items: readonly ProofItemView[];
  readonly lineStates: LineStates;
  readonly progress: ProgressCounts;
  /** The SSE id of the newest event that moved the progress (moments and announcements need evidence). */
  readonly progressEvent: string | null;
  /** The viewer is the judge whose session this run is: statuses come from the run's own stream. */
  readonly live: boolean;
  /** That live run has not been posted yet, so no Proof exists for it. */
  readonly notPosted: boolean;
  readonly facts: LedgerFacts | null;
  readonly figures: ProofFigures | null;
  readonly fees: FeeFigures | null;
  readonly snapshot: SeasonSnapshot | undefined;
  readonly runView: RunView | undefined;
}

/** A run reaches Proof once its batch is posted (the API answers 404 NOT_FOUND before). */
export function isPosted(view: Pick<RunView, "state">): boolean {
  const rank = PAY_RUN_RANK[view.state];
  return rank < 99 && rank >= PAY_RUN_RANK.POSTING;
}

function liveMap(view: RunView | undefined): Map<string, LiveItem> {
  const map = new Map<string, LiveItem>();
  if (!view) return map;
  for (const item of Object.values(view.items)) {
    map.set(item.senderItemId, {
      status: item.status,
      provenance: item.provenance,
      payoutItemId: item.payoutItemId,
      eventId: item.eventId,
      source: item.source,
      at: item.at,
    });
  }
  return map;
}

function statesOf(view: RunView | undefined): LineStates {
  if (!view) return {};
  const out: Record<string, MemberLineState> = {};
  for (const line of Object.values(view.lines)) out[line.memberNo] = line.state;
  return out;
}

/**
 * Assembles the page from a bundle read (the public `proof` query, or the brand tier's export). The public
 * aggregate stream only runs for viewers outside this run's judge session: inside it, the run's own stream is
 * the faster truth (one `item.updated` feeds every surface within 100 ms, C-05).
 */
export function useProofPage(runSlug: string, read: BundleRead): ProofPage {
  const adapter = useAdapter();
  const client = useQueryClient();
  const snapshot = useSnapshot().data;
  const session = useJudgeSession().session;
  const live = session?.runSlug === runSlug;
  useRunStream(live ? runSlug : null);
  const runView = useRunView(runSlug).data;
  const bundle = read.bundle;
  const servedMetrics = useQuery({
    queryKey: ["proof-metrics", runSlug, bundle?.checkpoint.entryHash],
    enabled: adapter.source === "http" && bundle !== null,
    queryFn: async () => {
      const metrics = await adapter.api.request({
        path: "/v1/proof/:runSlug/metrics",
        params: { runSlug },
        schema: ServedHoldMetrics,
        name: "proofMetrics",
      });
      if (metrics.runSlug !== runSlug) throw new Error("Proof metrics belong to another run.");
      return metrics.holds;
    },
  }).data;
  const notFound = isApiClientError(read.error, "NOT_FOUND");

  // The public aggregate stream, for viewers who are not inside this run's session.
  const [stream, setStream] = useState<{ counts: ProgressCounts; eventId: string | null } | null>(null);
  const settledOnce = useRef(false);
  const served = bundle !== null;
  useEffect(() => {
    setStream(null);
    settledOnce.current = false;
    if (live || !served) return;
    const subscription = adapter.api.subscribe(
      { kind: "proof", runSlug },
      {
        onMessage: (message) => {
          const next = progressFromMessage(message);
          if (!next) return;
          setStream((prev) => {
            const counts = advanceProgress(prev?.counts ?? null, next.counts);
            return counts === prev?.counts ? prev : { counts, eventId: next.eventId };
          });
        },
      },
    );
    return () => subscription.close();
    // The bundle's arrival opens the stream once; a refetch of the same run does not reopen it.
  }, [adapter, runSlug, live, served]);

  // When the public picture settles, the served bundle is refreshed once so the plates rest on PayPal's last word.
  const { queryKey } = read;
  useEffect(() => {
    if (!stream || settledOnce.current || !isSettled(stream.counts)) return;
    settledOnce.current = true;
    void client.invalidateQueries({ queryKey: [...queryKey] });
  }, [stream, client, queryKey]);

  const assembled = useMemo(() => {
    if (!bundle) return null;
    const facts = ledgerFacts(bundle.ledger);
    const items = live
      ? liveItems(bundle.batch.items, liveMap(runView))
      : mergeItems(bundle.batch.items, liveMap(runView));
    const lineStates = statesOf(runView);
    // A judge session runs on a workspace cloned from the season's showcase (S3.9), so its holds and what they
    // kept are the season's.
    const own = snapshot?.run.runSlug === runSlug || live;
    const holds = live ? Object.values(runView?.holds ?? {}) : own && snapshot ? snapshot.holds : null;
    const localFigures = deriveFigures({
      bundle,
      items,
      lineStates,
      facts,
      holds,
      seeded: own && snapshot ? snapshot.figures : null,
    });
    const figures =
      adapter.source === "http"
        ? {
            ...localFigures,
            holds: servedMetrics
              ? {
                  caught: servedMetrics.caught,
                  keptCents: servedMetrics.keptForMembers.cents,
                  duplicateCents: null,
                  creditCents: null,
                }
              : null,
          }
        : localFigures;
    return { facts, items, lineStates, figures };
  }, [bundle, live, runView, snapshot, runSlug, adapter.source, servedMetrics]);

  const itemCounts = useMemo(() => countItems((assembled?.items ?? []).map((i) => i.status)), [assembled]);
  const progress = live ? itemCounts : advanceProgress(itemCounts, stream?.counts ?? itemCounts);
  const notPosted = live && runView !== undefined && !isPosted(runView);

  const phase: ProofPhase = notPosted
    ? "none"
    : read.isPending
      ? "loading"
      : notFound
        ? "none"
        : read.error
          ? "error"
          : bundle
            ? "ready"
            : "loading";

  return {
    phase,
    error: notFound ? null : read.error,
    retry: read.refetch,
    runSlug,
    bundle,
    provenance: read.provenance,
    withheld: bundle ? receiversWithheld(bundle) : false,
    items: assembled?.items ?? [],
    lineStates: assembled?.lineStates ?? {},
    progress,
    progressEvent: live ? (runView?.lastEventId ?? null) : (stream?.eventId ?? null),
    live,
    notPosted,
    facts: assembled?.facts ?? null,
    figures: assembled?.figures ?? null,
    fees: seededFees(snapshot, runSlug),
    snapshot,
    runView,
  };
}
