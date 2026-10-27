/**
 * Cash day for the clerk (plan: Jessie "attests cash with a Nadawat photo"): the cash list, kept fresh by run events
 * rather than polling, cached on the phone so an offline bodega still shows the last list ("Katapusang listahan,
 * 10:21"), and merged with the receipts this phone has filed. A receipt is filed through the same offline outbox as
 * a slip: the photo of the signed "Nadawat" box and the clerk's stamp travel together, or not at all.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ApiErrorCode } from "../../_shims/contracts";
import { heroLine } from "../../_shims/seed";
import type { AddResult } from "../../lib/outbox";
import { prefs } from "../../platform/kv";
import type { ProcessedPage } from "../../platform/scanner";
import { useApp } from "../../state/app";
import { type CashDayDTO, isCashDayOpen, mergeRoster, type RosterEntry } from "./cash-day";
import {
  type CashPort,
  type DemoCashPort,
  demoCashPort,
  demoLineId,
  httpCashPort,
  parseCashDay,
} from "./cash-port";
import { useOutbox } from "./outbox-provider";
import { storeKey } from "./persisted-store";
import { originOf } from "./upload-protocol";

export interface CashHandle {
  status: "loading" | "ready" | "error";
  day: CashDayDTO | null;
  entries: RosterEntry[];
  /** Cash day has begun in Calinan; before it, receipts cannot be filed. */
  open: boolean;
  /** When the list on screen came from the co-op. */
  fetchedAt: number | null;
  /** The list on screen is the last copy (offline, or the last refresh failed). */
  stale: boolean;
  error: ApiErrorCode | null;
  reload(): void;
  /** Files the receipt for one line: the photo of the signed box and the clerk's stamp, together. */
  attest(
    entry: RosterEntry,
    page: ProcessedPage,
    attestedBy: string,
    station: string,
  ): Promise<AddResult | null>;
}

const CashContext = createContext<CashHandle | null>(null);

/** Line events can arrive in bursts (a fan-out); one reload covers them. */
const RELOAD_DEBOUNCE_MS = 400;

interface Cached {
  day: CashDayDTO;
  at: number;
}

export function CashDayProvider({ children }: { children: ReactNode }) {
  const { session, api, demo, online } = useApp();
  const { outbox, records, subscribe } = useOutbox();
  const workspaceId = session?.role === "clerk" ? session.workspaceId : null;
  const [day, setDay] = useState<CashDayDTO | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<CashHandle["status"]>("loading");
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const [stale, setStale] = useState(false);
  const bearerRef = useRef<string | null>(null);
  bearerRef.current = session?.bearer ?? null;
  const loading = useRef(false);
  const reloadAgain = useRef(false);

  const port = useMemo<CashPort | DemoCashPort>(
    () =>
      api.mode === "demo"
        ? demoCashPort({ now: () => Date.now(), stage: () => demo?.stage() ?? null })
        : httpCashPort({ origin: originOf(api.captureUrl()), getBearer: () => bearerRef.current }),
    [api, demo],
  );
  const cacheKey = workspaceId ? `fs.clerk.cashDay.${storeKey(workspaceId)}` : null;

  /** Single-flight; a reload asked for mid-load (a line event, say) runs once more after it, never dropped. */
  const load = useCallback(async () => {
    if (!workspaceId) return;
    if (loading.current) {
      reloadAgain.current = true;
      return;
    }
    loading.current = true;
    try {
      do {
        reloadAgain.current = false;
        const r = await port.load();
        if (r.ok) {
          const at = Date.now();
          setDay(r.value);
          setFetchedAt(at);
          setStale(false);
          setError(null);
          setStatus("ready");
          if (cacheKey) void prefs.set(cacheKey, JSON.stringify({ day: r.value, at } satisfies Cached));
        } else {
          setError(r.code);
          setStale(true);
          setStatus((s) => (s === "ready" ? "ready" : "error"));
        }
      } while (reloadAgain.current);
    } finally {
      loading.current = false;
    }
  }, [workspaceId, port, cacheKey]);

  // The last list first (an offline bodega still has it), then the co-op's.
  useEffect(() => {
    // A phone paired to another co-op starts from nothing, never from the last co-op's list.
    setDay(null);
    setFetchedAt(null);
    setStale(false);
    setError(null);
    setStatus("loading");
    if (!workspaceId || !cacheKey) return;
    let alive = true;
    (async () => {
      const raw = await prefs.get(cacheKey);
      if (alive && raw) {
        try {
          const c = JSON.parse(raw) as Partial<Cached>;
          const cached = parseCashDay(c.day);
          if (cached && typeof c.at === "number") {
            setDay((d) => d ?? cached);
            setFetchedAt((f) => f ?? (c.at as number));
            setStale(true);
            setStatus("ready");
          }
        } catch {
          // A damaged cache is ignored; the co-op's list replaces it.
        }
      }
      if (alive) void load();
    })();
    return () => {
      alive = false;
    };
  }, [workspaceId, cacheKey, load]);

  // Back online: refresh.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) void load();
    wasOnline.current = online;
  }, [online, load]);

  // Line events and this phone's own receipts reaching the co-op.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), RELOAD_DEBOUNCE_MS);
    };
    const off = subscribe((e) => {
      if (e.type === "run") {
        if (e.event.type === "line.state") soon();
        return;
      }
      const receipts = e.records.filter((r) => r.kind === "nadawat" && r.nadawat);
      if (!receipts.length) return;
      if ("record" in port) {
        for (const r of receipts) {
          if (!r.nadawat) continue;
          port.record(r.nadawat.lineId, r.createdAt, r.nadawat.attestedBy);
          // The demo's storyline: the clerk recording Nang Celing's cash moves her statement to "Nadawat".
          if (r.nadawat.lineId === demoLineId(heroLine.memberNo) && demo?.stage() === "cash-due") {
            demo.advance("cash-received");
          }
        }
      }
      soon();
    });
    const offDemo = demo?.subscribe(soon);
    return () => {
      if (timer) clearTimeout(timer);
      off();
      offDemo?.();
    };
  }, [subscribe, load, port, demo]);

  const attest = useCallback<CashHandle["attest"]>(
    async (entry, page, attestedBy, station) => {
      if (!outbox || !day) return null;
      const res = await outbox.add({
        kind: "nadawat",
        nadawat: {
          lineId: entry.line.lineId,
          memberNo: entry.line.memberNo,
          memberName: entry.line.name,
          cents: entry.line.cents,
          phpPerUsd: day.phpPerUsd,
          attestedBy,
        },
        sha256: page.sha256,
        fileUri: page.uri,
        thumbUri: page.thumbUri,
        mime: page.mime,
        bytes: page.bytes,
        width: page.width,
        height: page.height,
        station,
        memberHint: entry.line.memberNo,
        source: page.source,
      });
      void outbox.sync();
      return res;
    },
    [outbox, day],
  );

  const entries = useMemo(() => (day ? mergeRoster(day.lines, records) : []), [day, records]);
  const value = useMemo<CashHandle>(
    () => ({
      status,
      day,
      entries,
      open: day ? isCashDayOpen(day.cashDay, Date.now()) : false,
      fetchedAt,
      stale: stale || (!online && day !== null),
      error,
      reload: () => void load(),
      attest,
    }),
    [status, day, entries, fetchedAt, stale, online, error, load, attest],
  );
  return <CashContext.Provider value={value}>{children}</CashContext.Provider>;
}

export function useCashDay(): CashHandle {
  const v = useContext(CashContext);
  if (!v) throw new Error("useCashDay outside CashDayProvider");
  return v;
}
