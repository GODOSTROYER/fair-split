/**
 * The member's statement, held once for every member screen (Bayad, Resibo, Pangutana and the Paminawa modal share
 * one read and one live subscription; `app/(member)/_layout.tsx` mounts the provider).
 *
 * - Read once, cached on this phone for offline ("Katapusang kopya, 10:21"), refreshed when the signal returns.
 * - Kept current by `item.updated` on the member's own `line:<lineId>` stream (C-05): statuses only move forward,
 *   duplicates and stale events change nothing (I5, `reduceItemEvent`), and a fresh read never moves the item back
 *   (`mergeTrack`). A `line.state` event (the line moved to the bodega) re-reads the statement.
 * - Reports PayPal's confirmation (`paid`, with the event's id) so MM-1 plays only for a real, verified event.
 * - Remembers this phone's "Ipasusi pag-usab" request and the English gloss choice.
 *
 * Outside the provider (the board's Pangutana) `useStatement()` runs its own read.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { StatementDTO } from "../../_shims/api-client";
import type { ItemUpdatedPayload, RunEvent } from "../../_shims/contracts";
import {
  type CapsuleState,
  capsuleFor,
  EMPTY_TRACK,
  type ItemTrack,
  reduceItemEvent,
} from "../../lib/item-status";
import { mergeTrack } from "../../lib/statement";
import { prefs } from "../../platform/kv";
import { webQuery } from "../../platform/query";
import { useApp } from "../../state/app";
import { previewLine } from "./preview";
import { parseReview, type ReviewRecord, reviewPrefKey, serializeReview } from "./review";

/** PayPal's confirmation as it arrived: the SSE event that moved the item to SUCCESS. */
export interface PaidSignal {
  eventId: string;
  /** The event's own time (server clock). */
  at: string;
  /** When this phone applied it. */
  receivedAt: number;
}

export interface StatementValue {
  status: "loading" | "ready" | "error";
  dto: StatementDTO | null;
  capsule: CapsuleState | null;
  track: ItemTrack;
  paid: PaidSignal | null;
  /** Showing the copy saved on this phone, not a fresh read. */
  fromCache: boolean;
  cachedAt: string | null;
  /** Online, but the last refresh failed: the copy may be old. */
  refreshFailed: boolean;
  reload(): Promise<void>;
  /** Set for the read-only `/s/:token` view. */
  linkToken: string | null;
  review: ReviewRecord | null;
  recordReview(r: ReviewRecord): void;
  /** English under each Cebuano or Filipino sentence: the stage frame's `gloss`, or this phone's choice. */
  gloss: boolean;
  /** The stage asked for the gloss, so the member cannot turn it off here. */
  glossForced: boolean;
  setGloss(on: boolean): void;
}

const GLOSS_PREF = "fs.member.gloss";
const StatementContext = createContext<StatementValue | null>(null);

function useStatementSource(opts: { enabled: boolean; linkToken: string | null; linkLineId: string | null }) {
  const { api, demo, online, markSynced, session, gloss: frameGloss } = useApp();
  const { enabled, linkToken, linkLineId } = opts;
  const [dto, setDto] = useState<StatementDTO | null>(null);
  const [status, setStatus] = useState<StatementValue["status"]>("loading");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [track, setTrack] = useState<ItemTrack>(EMPTY_TRACK);
  const [paid, setPaid] = useState<PaidSignal | null>(null);
  const [review, setReview] = useState<ReviewRecord | null>(null);
  const [localGloss, setLocalGloss] = useState(false);
  const trackRef = useRef(track);
  trackRef.current = track;
  const dtoRef = useRef(dto);
  dtoRef.current = dto;
  const loading = useRef(false);
  const again = useRef(false);

  // One phone may be paired to a different member later, and a link view must never overwrite her own copy.
  const cacheKey = linkToken
    ? `fs.statement.link.${linkLineId ?? "unknown"}`
    : `fs.statement.cache.${session?.persona ?? "member"}`;
  // Read once: the index redirect drops the query string right after the first render.
  const [linePreview] = useState(() => webQuery("line"));
  const preview = demo ? linePreview : null;

  const load = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    // A change that lands while a read is in flight reads again afterwards, so the last word is never lost.
    if (loading.current) {
      again.current = true;
      return;
    }
    loading.current = true;
    // "Try again" after a failed first read shows the read starting over, not the failure it is replacing.
    if (!dtoRef.current) setStatus("loading");
    try {
      const r = linkToken ? await api.getStatementByLink(linkToken) : await api.getStatement();
      if (r.ok) {
        // Demo previews patch labelled demo data only (`?line=`); live statements are never touched.
        const fresh = preview ? previewLine(r.value, preview) : r.value;
        const at = new Date().toISOString();
        setDto(fresh);
        setStatus("ready");
        setFromCache(false);
        setRefreshFailed(false);
        setCachedAt(at);
        setTrack((t) => mergeTrack(t, fresh.item));
        markSynced();
        void prefs.set(cacheKey, JSON.stringify({ at, dto: fresh }));
        return;
      }
      // A read failed: keep what is on screen, or fall back to this phone's last copy.
      setRefreshFailed(true);
      if (dtoRef.current) return;
      const cached = parseCache(await prefs.get(cacheKey));
      if (cached) {
        setDto(cached.dto);
        setCachedAt(cached.at);
        setFromCache(true);
        setTrack((t) => mergeTrack(t, cached.dto.item));
        setStatus("ready");
        return;
      }
      setStatus("error");
    } finally {
      loading.current = false;
      if (again.current) {
        again.current = false;
        void load();
      }
    }
  }, [api, cacheKey, enabled, linkToken, markSynced, preview]);

  useEffect(() => {
    void load();
  }, [load]);

  // Demo controls change the line; re-read so the history and dates follow (the item status already came by event).
  // Starting the demo over also forgets the demo's re-check request.
  useEffect(() => {
    if (!demo || !enabled) return;
    return demo.subscribe(() => {
      if (demo.stage() === "checking" && dtoRef.current) {
        setReview(null);
        void prefs.del(reviewPrefKey(dtoRef.current.lineId));
      }
      void load();
    });
  }, [demo, enabled, load]);

  // The signal came back: replace the offline copy.
  useEffect(() => {
    if (online && (fromCache || refreshFailed)) void load();
  }, [online, fromCache, refreshFailed, load]);

  // The member's own stream. A link view has no credential for it (it stays a snapshot), except on demo data.
  const lineId = dto?.lineId ?? null;
  const senderItemId = dto?.item?.senderItemId ?? null;
  const live = enabled && !!lineId && (!linkToken || !!demo) && (!!session || !!demo);
  useEffect(() => {
    if (!live || !lineId) return;
    return api.subscribe(`line:${lineId}`, (e) => {
      if (e.type === "line.state") {
        const p = e.payload as { lineId?: string } | null;
        if (!p?.lineId || p.lineId === lineId) void load();
        return;
      }
      if (e.type !== "item.updated" || !senderItemId) return;
      const before = trackRef.current.status;
      const r = reduceItemEvent(
        trackRef.current,
        e as RunEvent<"item.updated", ItemUpdatedPayload>,
        senderItemId,
      );
      if (r.effect !== "applied") return; // a repeat or a stale event changes nothing, silently
      trackRef.current = r.track;
      setTrack(r.track);
      if (r.track.status === "SUCCESS" && before !== "SUCCESS") {
        setPaid({ eventId: e.id, at: e.at, receivedAt: Date.now() });
      }
    });
  }, [api, live, lineId, senderItemId, load]);

  // This phone's re-check request for the line.
  useEffect(() => {
    if (!lineId || !enabled) return;
    let alive = true;
    void prefs.get(reviewPrefKey(lineId)).then((raw) => {
      if (alive) setReview(parseReview(raw));
    });
    return () => {
      alive = false;
    };
  }, [lineId, enabled]);
  const recordReview = useCallback(
    (r: ReviewRecord) => {
      setReview(r);
      if (lineId) void prefs.set(reviewPrefKey(lineId), serializeReview(r));
    },
    [lineId],
  );

  useEffect(() => {
    let alive = true;
    void prefs.get(GLOSS_PREF).then((v) => {
      if (alive) setLocalGloss(v === "1");
    });
    return () => {
      alive = false;
    };
  }, []);
  const setGloss = useCallback((on: boolean) => {
    setLocalGloss(on);
    void prefs.set(GLOSS_PREF, on ? "1" : "0");
  }, []);

  const capsule: CapsuleState | null = dto
    ? capsuleFor({ lineState: dto.lineState, rail: dto.rail, itemStatus: track.status })
    : null;

  return {
    status,
    dto,
    capsule,
    track,
    paid,
    fromCache,
    cachedAt,
    refreshFailed,
    reload: load,
    linkToken,
    review,
    recordReview,
    gloss: frameGloss || localGloss,
    glossForced: frameGloss,
    setGloss,
  } satisfies StatementValue;
}

function parseCache(raw: string | null): { at: string; dto: StatementDTO } | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as { at?: unknown; dto?: StatementDTO };
    if (typeof c.at !== "string" || !c.dto || typeof c.dto.lineId !== "string") return null;
    return { at: c.at, dto: c.dto };
  } catch {
    return null;
  }
}

export function StatementProvider({
  children,
  linkToken = null,
  linkLineId = null,
}: {
  children: ReactNode;
  linkToken?: string | null;
  linkLineId?: string | null;
}) {
  const value = useStatementSource({ enabled: true, linkToken, linkLineId });
  return <StatementContext.Provider value={value}>{children}</StatementContext.Provider>;
}

/** The statement for this screen: the member area's shared copy, or a read of its own outside it. */
export function useStatement(opts: { enabled?: boolean } = {}): StatementValue {
  const shared = useContext(StatementContext);
  const own = useStatementSource({
    enabled: shared === null && (opts.enabled ?? true),
    linkToken: null,
    linkLineId: null,
  });
  return shared ?? own;
}
