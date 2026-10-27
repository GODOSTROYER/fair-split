/**
 * The clerk's offline outbox (M-CL-01), opened for the paired workspace when a clerk phone is in use. It recovers
 * uploads a killed app left behind, and syncs when the phone comes online, returns to the foreground, a retry falls
 * due (to the second, so the countdown the clerk reads is the one the outbox keeps) and once a minute while the app
 * is open. `capture.synced` marks a page read; other run events go on to the cash list. Mounted by the clerk layout
 * and read with `useOutbox()`.
 *
 * Demo mode labels everything "Demo data"; there, a sample slip is "read" a moment after it lands (one row, its own
 * serial), the way fs-api's reader answers, so the whole lifecycle can be seen without a server. A real photo in
 * demo mode stays "Sent": nothing pretends to have read it.
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
import { AppState } from "react-native";
import type { CaptureSyncedPayload, RunEvent } from "../../_shims/contracts";
import { type CaptureRecord, nextWakeAt, Outbox } from "../../lib/outbox";
import { uuidv7 } from "../../lib/uuidv7";
import { openOutboxStore } from "../../platform/outbox-store";
import { randomBytes } from "../../platform/random";
import { deleteCaptureFile } from "../../platform/scanner";
import { createUploader } from "../../platform/uploader";
import { onConnectivity } from "../../services/connectivity";
import { useApp } from "../../state/app";
import { announce } from "../../ui/a11y";
import { settledSince } from "./capture-view";
import { pluralKey } from "./messages";
import { sampleBySha } from "./samples";
import { useT } from "./use-t";

export type ClerkEvent = { type: "settled"; records: CaptureRecord[] } | { type: "run"; event: RunEvent };

export interface OutboxHandle {
  status: "opening" | "ready" | "error";
  outbox: Outbox | null;
  /** Newest first. */
  records: CaptureRecord[];
  /** Tries to open the outbox again after an error. */
  reopen(): void;
  sendNow(id: string): void;
  sendAll(): void;
  /** Captures that just reached the co-op, and the workspace's run events (the cash list listens). */
  subscribe(cb: (e: ClerkEvent) => void): () => void;
}

/** A safety net under the event-driven syncs (connectivity, foreground, exact retry times). */
const SAFETY_SYNC_MS = 60_000;
/** Demo only: how long the stand-in reader takes to "read" a sample slip after it lands. */
const DEMO_READ_MS = 1400;
/** S1.12: at most one spoken summary every 5 s. */
const ANNOUNCE_EVERY_MS = 5000;

const OutboxContext = createContext<OutboxHandle | null>(null);

const OPENING: OutboxHandle = {
  status: "opening",
  outbox: null,
  records: [],
  reopen: () => {},
  sendNow: () => {},
  sendAll: () => {},
  subscribe: () => () => {},
};

export function OutboxProvider({ children }: { children: ReactNode }) {
  const { session, api, online } = useApp();
  const tr = useT();
  const [state, setState] = useState<Pick<OutboxHandle, "status" | "outbox" | "records">>({
    status: "opening",
    outbox: null,
    records: [],
  });
  const [attempt, setAttempt] = useState(0);
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const bearerRef = useRef<string | null>(null);
  bearerRef.current = session?.bearer ?? null;
  const trRef = useRef(tr);
  trRef.current = tr;
  const listeners = useRef(new Set<(e: ClerkEvent) => void>());
  const workspaceId = session?.role === "clerk" ? session.workspaceId : null;

  useEffect(() => {
    if (!workspaceId) {
      setState({ status: "opening", outbox: null, records: [] });
      return;
    }
    let alive = true;
    let ob: Outbox | null = null;
    let prev: CaptureRecord[] = [];
    let refreshing = false;
    let again = false;
    let wake: ReturnType<typeof setTimeout> | null = null;
    let lastAnnounce = 0;
    let pendingSent = 0;
    let announceTimer: ReturnType<typeof setTimeout> | null = null;
    const demoTimers = new Set<ReturnType<typeof setTimeout>>();
    const emit = (e: ClerkEvent) => {
      for (const l of listeners.current) l(e);
    };

    const scheduleWake = (records: readonly CaptureRecord[]) => {
      if (wake) clearTimeout(wake);
      wake = null;
      const at = nextWakeAt(records, Date.now());
      if (at !== null) wake = setTimeout(() => void ob?.sync(), Math.max(0, at - Date.now()) + 50);
    };

    const announceSent = (n: number) => {
      pendingSent += n;
      const say = () => {
        announceTimer = null;
        lastAnnounce = Date.now();
        const count = pendingSent;
        pendingSent = 0;
        if (alive && count) announce(trRef.current(pluralKey("M-CL-02.sent", count), { n: count }));
      };
      const wait = ANNOUNCE_EVERY_MS - (Date.now() - lastAnnounce);
      if (wait <= 0) say();
      else announceTimer ??= setTimeout(say, wait);
    };

    const demoRead = (settled: readonly CaptureRecord[]) => {
      if (api.mode !== "demo") return;
      for (const r of settled) {
        if (r.kind !== "slip" || r.state !== "uploaded") continue;
        const sample = sampleBySha(r.sha256);
        if (!sample) continue;
        const timer = setTimeout(() => {
          demoTimers.delete(timer);
          void ob?.markRead(r.id, { documentId: r.documentId ?? "demo", rowsRead: 1, serial: sample.serial });
        }, DEMO_READ_MS);
        demoTimers.add(timer);
      }
    };

    const refresh = async () => {
      if (!ob || !alive) return;
      if (refreshing) {
        again = true;
        return;
      }
      refreshing = true;
      try {
        do {
          again = false;
          const records = await ob.list();
          if (!alive) return;
          const settled = settledSince(prev, records);
          prev = records;
          setState({ status: "ready", outbox: ob, records });
          scheduleWake(records);
          if (settled.length) {
            emit({ type: "settled", records: settled });
            announceSent(settled.length);
            demoRead(settled);
          }
        } while (again && alive);
      } finally {
        refreshing = false;
      }
    };

    (async () => {
      try {
        const store = await openOutboxStore(workspaceId);
        if (!alive) return;
        ob = new Outbox({
          store,
          uploader: createUploader({ api, getBearer: () => bearerRef.current }),
          now: () => Date.now(),
          newId: () => uuidv7(Date.now(), randomBytes),
          isOnline: () => onlineRef.current,
          onChange: () => void refresh(),
          deleteFile: deleteCaptureFile,
        });
        await ob.init();
        prev = await ob.list();
        await refresh();
        void ob.sync();
      } catch {
        if (alive) setState({ status: "error", outbox: null, records: [] });
      }
    })();

    const offNet = onConnectivity((isOnline) => {
      onlineRef.current = isOnline;
      if (isOnline) void ob?.sync();
    });
    const tick = setInterval(() => void ob?.sync(), SAFETY_SYNC_MS);
    const appState = AppState.addEventListener("change", (s) => {
      if (s === "active") void ob?.sync();
    });
    const offEvents = api.subscribe(`ws:${workspaceId}`, (e) => {
      if (e.type === "capture.synced") {
        const p = e.payload as CaptureSyncedPayload;
        void ob?.markRead(p.captureId, { documentId: p.documentId, rowsRead: p.rowsRead, serial: p.serial });
      }
      emit({ type: "run", event: e });
    });
    return () => {
      alive = false;
      ob?.dispose();
      offNet();
      clearInterval(tick);
      appState.remove();
      offEvents();
      if (wake) clearTimeout(wake);
      if (announceTimer) clearTimeout(announceTimer);
      for (const timer of demoTimers) clearTimeout(timer);
    };
  }, [workspaceId, api, attempt]);

  const reopen = useCallback(() => setAttempt((n) => n + 1), []);
  const subscribe = useCallback((cb: (e: ClerkEvent) => void) => {
    listeners.current.add(cb);
    return () => {
      listeners.current.delete(cb);
    };
  }, []);
  const { outbox } = state;
  const value = useMemo<OutboxHandle>(
    () => ({
      ...state,
      reopen,
      subscribe,
      sendNow: (id) => void outbox?.sendNow(id),
      sendAll: () => void outbox?.sendAll(),
    }),
    [state, outbox, reopen, subscribe],
  );
  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>;
}

/** The outbox and its records ("opening" until the store is open, and on phones not paired as the clerk). */
export function useOutbox(): OutboxHandle {
  return useContext(OutboxContext) ?? OPENING;
}
