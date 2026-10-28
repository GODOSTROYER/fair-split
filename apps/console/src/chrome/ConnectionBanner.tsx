// While the run's stream is down, the screen keeps the last state it had and says so (S1.5: "Reconnecting.
// Showing changes up to 10:21:41."). The stream replays from Last-Event-ID when it is back.

import { Glyph } from "@fairsplit/ui-web";
import { useSyncExternalStore } from "react";
import type { StreamStatus } from "../data/adapter.js";
import { format } from "../lib/format.js";
import { CONNECTION } from "./copy.js";

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export function ConnectionBanner({ status }: { readonly status: StreamStatus }) {
  const online = useOnline();
  let text: string | null = null;
  if (!online) text = CONNECTION.offline;
  else if (status.kind === "reconnecting")
    text = CONNECTION.reconnecting(status.lastEventAt ? format.time(status.lastEventAt) : null);
  else if (status.kind === "closed" && status.reason === "unauthorized") text = CONNECTION.unauthorized;
  else if (status.kind === "closed" && status.reason === "expired") text = CONNECTION.expired;
  if (!text) return null;
  return (
    <p className="fsc-banner fs-t-label" role="status" data-testid="W-JG-01.connection">
      <Glyph name="ms:wifi-off" size={16} />
      <span>{text}</span>
    </p>
  );
}
