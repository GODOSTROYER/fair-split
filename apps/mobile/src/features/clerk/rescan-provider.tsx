/**
 * The treasurer's rescan requests for this phone (see `rescan.ts`): heard on the workspace's event stream, kept on
 * the phone per workspace, and open until a slip filed after each one answers it. Mounted by the clerk layout, so a
 * request that arrives while the clerk is on the Outbox tab is waiting on the Scan screen; read with `useRescans()`.
 */
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { prefs } from "../../platform/kv";
import { useApp } from "../../state/app";
import { announce } from "../../ui/a11y";
import { useOutbox } from "./outbox-provider";
import { storeKey } from "./persisted-store";
import { addRescan, openRescans, parseRescanEvent, parseStoredRescans, type RescanRequest } from "./rescan";
import { useT } from "./use-t";

const RescanContext = createContext<readonly RescanRequest[]>([]);

export function RescanProvider({ children }: { children: ReactNode }) {
  const { session } = useApp();
  const { records, subscribe } = useOutbox();
  const tr = useT();
  const trRef = useRef(tr);
  trRef.current = tr;
  const workspaceId = session?.role === "clerk" ? session.workspaceId : null;
  const key = workspaceId ? `fs.clerk.rescans.${storeKey(workspaceId)}` : null;
  const [requests, setRequests] = useState<RescanRequest[]>([]);
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  /** The workspace whose stored requests are loaded: nothing is written back before they are. */
  const [loaded, setLoaded] = useState<string | null>(null);

  useEffect(() => {
    setRequests([]);
    setLoaded(null);
    if (!key) return;
    let alive = true;
    void prefs.get(key).then((raw) => {
      if (!alive) return;
      const now = Date.now();
      // Requests heard while the store was opening join the stored ones.
      setRequests((heard) => heard.reduce((all, q) => addRescan(all, q, now), parseStoredRescans(raw, now)));
      setLoaded(key);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  useEffect(() => {
    if (key && loaded === key) void prefs.set(key, JSON.stringify(requests));
  }, [key, loaded, requests]);

  useEffect(() => {
    if (!key) return;
    return subscribe((e) => {
      if (e.type !== "run") return;
      const q = parseRescanEvent(e.event, Date.now());
      if (!q || requestsRef.current.some((x) => x.id === q.id)) return; // a redelivered event is the same request
      setRequests((cur) => addRescan(cur, q, Date.now()));
      const t = trRef.current;
      announce(
        q.requestedBy
          ? t("M-CL-01.rescanAsked", { name: q.requestedBy, photo: q.photo })
          : t("M-CL-01.rescanAskedAnon", { photo: q.photo }),
      );
    });
  }, [key, subscribe]);

  const open = useMemo(() => openRescans(requests, records, Date.now()), [requests, records]);
  return <RescanContext.Provider value={open}>{children}</RescanContext.Provider>;
}

/** Open rescan requests, oldest first. */
export function useRescans(): readonly RescanRequest[] {
  return useContext(RescanContext);
}
