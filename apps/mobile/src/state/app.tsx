/**
 * App state: language and theme (first run), the paired session, the API (live fs-api or labelled demo data),
 * connectivity, and the clerk's outbox. One provider, no global store library.
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
import { AppState as RNAppState } from "react-native";
import { createHttpApi, type FairSplitApi } from "../_shims/api-client";
import type { CaptureSyncedPayload, Lang } from "../_shims/contracts";
import { LANGS } from "../_shims/contracts";
import type { ThemeName } from "../_shims/tokens.native";
import { type CaptureRecord, Outbox } from "../lib/outbox";
import { type PairedSession, sessionValid } from "../lib/pairing";
import { uuidv7 } from "../lib/uuidv7";
import { type FrameGrant, listenForFrameGrant } from "../platform/frame-bridge";
import { prefs, secrets } from "../platform/kv";
import { onConnectivity, useOnline } from "../platform/network";
import { openOutboxStore } from "../platform/outbox-store";
import { webQuery } from "../platform/query";
import { randomBytes } from "../platform/random";
import { streamingFetch } from "../platform/streaming-fetch";
import { createUploader } from "../platform/uploader";
import { createDemoApi, type DemoController, demoSession } from "../services/demo-api";
import type { DemoStage } from "../services/demo-fixtures";
import { themeFromQuery } from "../theme/theme";

const K = {
  lang: "fs.lang",
  theme: "fs.theme",
  langChosen: "fs.firstRun.lang",
  themeChosen: "fs.firstRun.theme",
  session: "fs.session",
} as const;

/**
 * `EXPO_PUBLIC_API_ORIGIN`: an https origin, or `same-origin` when fs-api serves this web export at /app.
 * Unset means demo mode, with every screen labelled "Demo data".
 */
function apiOrigin(): string | null {
  const v = process.env.EXPO_PUBLIC_API_ORIGIN?.trim();
  if (!v) return null;
  if (v === "same-origin")
    return typeof window !== "undefined" && window.location ? window.location.origin : null;
  return v;
}

export interface OutboxHandle {
  outbox: Outbox;
  records: CaptureRecord[];
}

interface AppValue {
  ready: boolean;
  lang: Lang;
  setLang(l: Lang): void;
  theme: ThemeName;
  setTheme(t: ThemeName): void;
  langChosen: boolean;
  themeChosen: boolean;
  completeFirstRun(step: "lang" | "theme"): void;
  session: PairedSession | null;
  setSession(s: PairedSession | null): void;
  api: FairSplitApi;
  demo: DemoController | null;
  online: boolean;
  outbox: OutboxHandle | null;
  /** Last time the statement or co-sign data came from the server (for "Katapusang kopya, 10:21"). */
  lastSync: string | null;
  markSynced(): void;
}

const AppContext = createContext<AppValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [lang, setLangState] = useState<Lang>("ceb");
  const [theme, setThemeState] = useState<ThemeName>("adlaw");
  const [langChosen, setLangChosen] = useState(false);
  const [themeChosen, setThemeChosen] = useState(false);
  const [session, setSessionState] = useState<PairedSession | null>(null);
  const [outbox, setOutbox] = useState<OutboxHandle | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const online = useOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const bearerRef = useRef<string | null>(null);
  bearerRef.current = session?.bearer ?? null;

  const { api, demo } = useMemo(() => {
    const origin = apiOrigin();
    if (origin) {
      return {
        api: createHttpApi({ origin, getBearer: () => bearerRef.current, streamingFetch }),
        demo: null,
      };
    }
    const d = createDemoApi({ now: () => new Date(), randomBytes });
    return { api: d as FairSplitApi, demo: d.demo };
  }, []);

  // Restore preferences and the session.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [l, t, lc, tc, sRaw, sDemo] = await Promise.all([
        prefs.get(K.lang),
        prefs.get(K.theme),
        prefs.get(K.langChosen),
        prefs.get(K.themeChosen),
        secrets.get(K.session),
        prefs.get(K.session),
      ]);
      if (!alive) return;
      if (l && (LANGS as readonly string[]).includes(l)) setLangState(l as Lang);
      const qt = themeFromQuery();
      if (qt) setThemeState(qt);
      else if (t === "adlaw" || t === "tablea") setThemeState(t);
      setLangChosen(lc === "1");
      setThemeChosen(tc === "1" || qt !== null);
      // Demo links for review and the stage frames before fs-api exists: ?demo=member|board|clerk&stage=sent|paid.
      const demoRole = demo ? webQuery("demo") : null;
      if (demo && (demoRole === "member" || demoRole === "board" || demoRole === "clerk")) {
        setSessionState(demoSession(demoRole, new Date()));
        setLangChosen(true);
        setThemeChosen(true);
        const stage = webQuery("stage");
        if (stage === "sent" || stage === "paid" || stage === "unclaimed") demo.advance(stage as DemoStage);
        setReady(true);
        return;
      }
      for (const raw of [sRaw, sDemo]) {
        if (!raw) continue;
        try {
          const s = JSON.parse(raw) as PairedSession;
          if (sessionValid(s, new Date())) {
            setSessionState(s);
            break;
          }
        } catch {
          // A corrupt session is the same as none: pair again.
        }
      }
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Judge stage frames receive their token by postMessage and skip the first run (S1.8).
  useEffect(
    () =>
      listenForFrameGrant((g: FrameGrant) => {
        setSessionState({
          kind: "frame",
          bearer: g.token,
          expiresAt: g.expiresAt,
          workspaceId: g.workspaceId,
          persona: g.persona,
          role: g.role,
          memberNo: g.memberNo,
          displayName: g.displayName,
          lang: null,
          pairedAt: new Date().toISOString(),
        });
        setLangChosen(true);
        setThemeChosen(true);
      }),
    [],
  );

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    void prefs.set(K.lang, l);
  }, []);
  const setTheme = useCallback((t: ThemeName) => {
    setThemeState(t);
    void prefs.set(K.theme, t);
  }, []);
  const completeFirstRun = useCallback((step: "lang" | "theme") => {
    if (step === "lang") {
      setLangChosen(true);
      void prefs.set(K.langChosen, "1");
    } else {
      setThemeChosen(true);
      void prefs.set(K.themeChosen, "1");
    }
  }, []);
  const setSession = useCallback((s: PairedSession | null) => {
    setSessionState(s);
    if (!s) {
      void secrets.del(K.session);
      void prefs.del(K.session);
      return;
    }
    // Demo sessions hold no secret; real bearer tokens only ever go to the secure store.
    if (s.bearer === "demo-session") void prefs.set(K.session, JSON.stringify(s));
    else void secrets.set(K.session, JSON.stringify(s));
  }, []);
  const markSynced = useCallback(() => setLastSync(new Date().toISOString()), []);

  // The clerk's outbox: open, recover interrupted uploads, sync whenever the phone is online.
  useEffect(() => {
    if (session?.role !== "clerk") {
      setOutbox(null);
      return;
    }
    let alive = true;
    let ob: Outbox | null = null;
    const refresh = async () => {
      if (!ob || !alive) return;
      const records = await ob.list();
      if (alive && ob) setOutbox({ outbox: ob, records });
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
    const tick = setInterval(() => void ob?.sync(), 15_000);
    const appState = RNAppState.addEventListener("change", (s) => {
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

  const value = useMemo<AppValue>(
    () => ({
      ready,
      lang,
      setLang,
      theme,
      setTheme,
      langChosen,
      themeChosen,
      completeFirstRun,
      session,
      setSession,
      api,
      demo,
      online,
      outbox,
      lastSync,
      markSynced,
    }),
    [
      ready,
      lang,
      setLang,
      theme,
      setTheme,
      langChosen,
      themeChosen,
      completeFirstRun,
      session,
      setSession,
      api,
      demo,
      online,
      outbox,
      lastSync,
      markSynced,
    ],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppValue {
  const v = useContext(AppContext);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
