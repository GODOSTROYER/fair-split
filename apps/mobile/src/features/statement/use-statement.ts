/**
 * The member's statement: fetched once, cached for offline ("Katapusang kopya, 10:21"), then kept current by
 * `item.updated` over SSE (forward-only, duplicates ignored). Reports a fresh PayPal confirmation so the screen can
 * play MM-1 only for a real, verified event.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { StatementDTO } from "../../_shims/api-client";
import type { ItemUpdatedPayload, RunEvent } from "../../_shims/contracts";
import {
  type CapsuleState,
  capsuleFor,
  EMPTY_TRACK,
  type ItemTrack,
  reduceItemEvent,
} from "../../lib/item-status";
import { prefs } from "../../platform/kv";
import { useApp } from "../../state/app";

const CACHE = "fs.statement.cache";

export interface PaidSignal {
  eventId: string;
  at: string;
  receivedAt: number;
}

export function useStatement(opts: { linkToken?: string } = {}) {
  const { api, demo, online, markSynced } = useApp();
  const [dto, setDto] = useState<StatementDTO | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState(false);
  const [track, setTrack] = useState<ItemTrack>(EMPTY_TRACK);
  const [paid, setPaid] = useState<PaidSignal | null>(null);
  const trackRef = useRef(track);
  trackRef.current = track;

  const load = useCallback(async () => {
    const r = opts.linkToken ? await api.getStatementByLink(opts.linkToken) : await api.getStatement();
    if (r.ok) {
      setDto(r.value);
      setFromCache(false);
      setError(false);
      setTrack((cur) => ({
        ...cur,
        status: r.value.item?.status ?? null,
        updatedAt: r.value.item?.updatedAt ?? null,
      }));
      const at = new Date().toISOString();
      setCachedAt(at);
      markSynced();
      void prefs.set(CACHE, JSON.stringify({ at, dto: r.value }));
      return;
    }
    const raw = await prefs.get(CACHE);
    if (raw) {
      try {
        const c = JSON.parse(raw) as { at: string; dto: StatementDTO };
        setDto(c.dto);
        setCachedAt(c.at);
        setFromCache(true);
        setTrack((cur) => ({ ...cur, status: c.dto.item?.status ?? null }));
        return;
      } catch {
        // fall through
      }
    }
    setError(true);
  }, [api, markSynced, opts.linkToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Demo controls change the line; refetch so history and dates follow (the item status already came by event).
  useEffect(() => {
    if (!demo) return;
    const off = demo.subscribe(() => void load());
    return () => {
      off();
    };
  }, [demo, load]);

  // Reload when the connection returns, so the offline copy is replaced.
  useEffect(() => {
    if (online && fromCache) void load();
  }, [online, fromCache, load]);

  const runSlug = dto?.runSlug;
  const senderItemId = dto?.item?.senderItemId;
  useEffect(() => {
    if (!runSlug || !senderItemId) return;
    return api.subscribe(`run:${runSlug}`, (e) => {
      if (e.type !== "item.updated") return;
      const before = trackRef.current.status;
      const r = reduceItemEvent(
        trackRef.current,
        e as RunEvent<"item.updated", ItemUpdatedPayload>,
        senderItemId,
      );
      if (r.effect !== "applied") return; // duplicates and stale events change nothing, silently
      setTrack(r.track);
      if (r.track.status === "SUCCESS" && before !== "SUCCESS") {
        setPaid({ eventId: e.id, at: e.at, receivedAt: Date.now() });
      }
    });
  }, [api, runSlug, senderItemId]);

  const capsule: CapsuleState | null = dto
    ? capsuleFor({ lineState: dto.lineState, rail: dto.rail, itemStatus: track.status })
    : null;

  return { dto, capsule, track, paid, fromCache, cachedAt, error, reload: load };
}
