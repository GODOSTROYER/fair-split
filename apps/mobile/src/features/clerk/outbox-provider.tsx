/**
 * The clerk's offline outbox (M-CL-01): opened when a clerk phone is paired, recovers interrupted uploads, and syncs
 * whenever the phone is online, comes back to the foreground, or every 15 s while the app is open. `capture.synced`
 * events mark each slip read ("4 rows read"). Mounted by the clerk layout, so only clerk phones open the database.
 */
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { CaptureSyncedPayload } from "../../_shims/contracts";
import { type CaptureRecord, Outbox } from "../../lib/outbox";
import { uuidv7 } from "../../lib/uuidv7";
import { openOutboxStore } from "../../platform/outbox-store";
import { randomBytes } from "../../platform/random";
import { createUploader } from "../../platform/uploader";
import { onConnectivity } from "../../services/connectivity";
import { useApp } from "../../state/app";

export interface OutboxHandle {
  outbox: Outbox;
  records: CaptureRecord[];
}

const OutboxContext = createContext<OutboxHandle | null>(null);

/** Sync cadence while the app is open (connectivity changes and returning to the foreground also sync). */
const SYNC_EVERY_MS = 15_000;

export function OutboxProvider({ children }: { children: ReactNode }) {
  const { session, api, online } = useApp();
  const [handle, setHandle] = useState<OutboxHandle | null>(null);
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const bearerRef = useRef<string | null>(null);
  bearerRef.current = session?.bearer ?? null;

  useEffect(() => {
    if (session?.role !== "clerk") {
      setHandle(null);
      return;
    }
    let alive = true;
    let ob: Outbox | null = null;
    const refresh = async () => {
      if (!ob || !alive) return;
      const records = await ob.list();
      if (alive && ob) setHandle({ outbox: ob, records });
    };
    (async () => {
      const store = await openOutboxStore();
      ob = new Outbox({
        store,
        uploader: createUploader(api, () => bearerRef.current),
        now: () => Date.now(),
        newId: () => uuidv7(Date.now(), randomBytes),
        isOnline: () => onlineRef.current,
        onChange: () => void refresh(),
      });
      await ob.init();
      await refresh();
      void ob.sync();
    })();
    const offNet = onConnectivity((isOnline) => {
      if (isOnline) void ob?.sync();
    });
    const tick = setInterval(() => void ob?.sync(), SYNC_EVERY_MS);
    const appState = AppState.addEventListener("change", (s) => {
      if (s === "active") void ob?.sync();
    });
    const offEvents = api.subscribe(`ws:${session.workspaceId}`, (e) => {
      if (e.type !== "capture.synced" || !ob) return;
      const p = e.payload as CaptureSyncedPayload;
      void ob.markRead(p.captureId, { documentId: p.documentId, rowsRead: p.rowsRead, serial: p.serial });
    });
    return () => {
      alive = false;
      offNet();
      clearInterval(tick);
      appState.remove();
      offEvents();
    };
  }, [session?.role, session?.workspaceId, api]);

  return <OutboxContext.Provider value={handle}>{children}</OutboxContext.Provider>;
}

/** The outbox and its records, or null while it opens (and on phones that are not paired as the clerk). */
export function useOutbox(): OutboxHandle | null {
  return useContext(OutboxContext);
}
