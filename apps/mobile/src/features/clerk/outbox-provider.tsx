/**
 * The clerk's offline outbox (M-CL-01), opened for the paired workspace when a clerk phone is in use. It recovers
 * uploads a killed app left behind, and syncs when the phone comes online, returns to the foreground, a retry falls
 * due (to the second, so the countdown the clerk reads is the one the outbox keeps) and once a minute while the app
 * is open. `capture.synced` marks a page read; other run events go on to the cash list and the rescan requests.
 *
 * Every capture is filed under the clerk paired now (`clerkFiler`), and only that clerk's pairing sends it: the
 * uploader gets a bearer only for the paired clerk's own captures (`clerkBearerFor`, read as each request is built).
 * When the phone is paired again as the same clerk, what an expired token had refused goes out by itself under new
 * keys; paired as another clerk, the first clerk's captures wait, each saying who filed it, until that clerk pairs
 * again or a person sends one as theirs ("Ipadala isip ako", `takeOver`). Mounted by the clerk layout and read with
 * `useOutbox()`.
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
import { refusedSince, settledSince } from "./capture-view";
import { clerkBearerFor, clerkFiler } from "./clerk-site";
import { pluralKey } from "./messages";
import { sampleBySha } from "./samples";
import { useT } from "./use-t";

export type ClerkEvent =
  | { type: "settled"; records: CaptureRecord[] }
  | { type: "refused"; records: CaptureRecord[] }
  | { type: "run"; event: RunEvent };

export interface OutboxHandle {
  status: "opening" | "ready" | "error";
  outbox: Outbox | null;
  /** Newest first. */
  records: CaptureRecord[];
  /** The persona of the clerk paired now (null: none): rows compare each capture's filer with it. */
  me: string | null;
  /** Tries to open the outbox again after an error. */
  reopen(): void;
  sendNow(id: string): void;
  sendAll(): void;
  /**
   * "Ipadala isip ako", after the confirm that named who filed it (`seen`: that persona, null for unknown): the
   * capture becomes this clerk's and goes under this pairing. False when nothing changed.
   */
  takeOver(id: string, seen: string | null): Promise<boolean>;
  /** Removes a refused capture from the phone; false when it is no longer refused (or no longer here). */
  discard(id: string): Promise<boolean>;
  /**
   * Captures that just reached the co-op or were refused by it, and the workspace's run events (the cash list and
   * the rescan requests listen).
   */
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
  me: null,
  reopen: () => {},
  sendNow: () => {},
  sendAll: () => {},
  takeOver: async () => false,
  discard: async () => false,
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
  // One session object for both who is paired and the bearer, so the two are always read together.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const trRef = useRef(tr);
  trRef.current = tr;
  const listeners = useRef(new Set<(e: ClerkEvent) => void>());
  const workspaceId = session?.role === "clerk" ? session.workspaceId : null;
  const me = clerkFiler(session, workspaceId)?.persona ?? null;

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
      const at = nextWakeAt(
        records,
        Date.now(),
        clerkFiler(sessionRef.current, workspaceId)?.persona ?? null,
      );
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
          const refused = refusedSince(prev, records);
          prev = records;
          setState({ status: "ready", outbox: ob, records });
          scheduleWake(records);
          if (settled.length) {
            emit({ type: "settled", records: settled });
            announceSent(settled.length);
            demoRead(settled);
          }
          if (refused.length) emit({ type: "refused", records: refused });
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
          uploader: createUploader({
            api,
            bearerFor: (filedBy) => clerkBearerFor(sessionRef.current, workspaceId, filedBy),
          }),
          now: () => Date.now(),
          newId: () => uuidv7(Date.now(), randomBytes),
          isOnline: () => onlineRef.current,
          filer: () => clerkFiler(sessionRef.current, workspaceId),
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

  // Paired again with the same co-op (a new bearer): the outbox resends what an expired token refused, for the clerk
  // paired now only; another clerk's captures wait for their filer or a person (`Outbox.afterPairing`).
  const bearer = session?.bearer ?? null;
  const pairing = useRef({ bearer, workspaceId });
  useEffect(() => {
    const before = pairing.current;
    pairing.current = { bearer, workspaceId };
    const repaired =
      bearer && before.bearer && bearer !== before.bearer && workspaceId === before.workspaceId;
    if (outbox && repaired) void outbox.afterPairing();
  }, [bearer, workspaceId, outbox]);

  const value = useMemo<OutboxHandle>(
    () => ({
      ...state,
      me,
      reopen,
      subscribe,
      sendNow: (id) => void outbox?.sendNow(id),
      sendAll: () => void outbox?.sendAll(),
      takeOver: async (id, seen) => (outbox ? (await outbox.takeOver(id, seen)) !== null : false),
      discard: async (id) => (outbox ? outbox.discard(id) : false),
    }),
    [state, me, outbox, reopen, subscribe],
  );
  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>;
}

/** The outbox and its records ("opening" until the store is open, and on phones not paired as the clerk). */
export function useOutbox(): OutboxHandle {
  return useContext(OutboxContext) ?? OPENING;
}
