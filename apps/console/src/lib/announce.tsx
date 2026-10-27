// One announcer for the console (S1.12): a polite aria-live region, throttled to one summary every 5 s
// ("3 of 8 confirmed"), so a burst of webhooks reads as one sentence. Visualisations stay hidden from
// screen readers and mirrored in Data mode; this is how their changes are heard.

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

export const ANNOUNCE_THROTTLE_MS = 5000;

type Announce = (message: string) => void;

const AnnounceContext = createContext<Announce>(() => undefined);

export function AnnouncerProvider({
  children,
  throttleMs = ANNOUNCE_THROTTLE_MS,
}: {
  readonly children: ReactNode;
  readonly throttleMs?: number;
}) {
  const [message, setMessage] = useState("");
  const pending = useRef<string | null>(null);
  const lastAt = useRef(Number.NEGATIVE_INFINITY);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    timer.current = null;
    if (pending.current === null) return;
    setMessage(pending.current);
    pending.current = null;
    lastAt.current = Date.now();
  }, []);

  const announce = useCallback<Announce>(
    (next) => {
      pending.current = next;
      const wait = lastAt.current + throttleMs - Date.now();
      if (wait <= 0) flush();
      else if (!timer.current) timer.current = setTimeout(flush, wait);
    },
    [flush, throttleMs],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const value = useMemo(() => announce, [announce]);
  return (
    <AnnounceContext.Provider value={value}>
      {children}
      <div className="fs-sr" role="status" aria-live="polite" aria-atomic="true" data-testid="announcer">
        {message}
      </div>
    </AnnounceContext.Provider>
  );
}

/** Speaks a short summary politely; the latest message within 5 s wins. */
export function useAnnounce(): Announce {
  return useContext(AnnounceContext);
}
