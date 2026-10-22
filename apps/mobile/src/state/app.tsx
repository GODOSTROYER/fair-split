/**
 * The shell's state, one provider for every role: language and theme, first run, the member's read-or-listen choice,
 * the paired session, the API (live fs-api or labelled demo data), connectivity, and the judge stage's frame
 * preferences. No global store library. Role-specific state lives in the role's own provider (the clerk's outbox is
 * mounted by the clerk layout), so the shell never imports a slice.
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
import { createHttpApi, type FairSplitApi } from "../_shims/api-client";
import type { FramePrefs, Lang } from "../_shims/contracts";
import { LANGS } from "../_shims/contracts";
import type { ThemeName } from "../_shims/tokens.native";
import { prefs, secrets } from "../platform/kv";
import { webQuery } from "../platform/query";
import { randomBytes } from "../platform/random";
import { streamingFetch } from "../platform/streaming-fetch";
import { apiOrigin, BUILD } from "../services/build";
import { useOnline } from "../services/connectivity";
import { createDemoApi, type DemoController, demoSession } from "../services/demo-api";
import { DEMO_STAGES, type DemoStage } from "../services/demo-fixtures";
import { DEFAULT_FRAME_PREFS, inFrame, startFrameBridge } from "../services/frame-bridge";
import { DEMO_BEARER, type PairedSession, parseSession } from "../services/session";
import { themeFromQuery } from "../theme/theme";

/** Preference keys (non-secret values in `prefs`; the device bearer only ever in `secrets`). */
export const PREF = {
  lang: "fs.lang",
  theme: "fs.theme",
  onboarded: "fs.onboarded",
  listenFirst: "fs.listenFirst",
  session: "fs.session",
} as const;

export interface FrameState {
  /** True inside a judge stage phone frame (web export only). */
  inFrame: boolean;
  /** The stage's `fs.prefs`; defaults until it sends them. Null outside a frame. */
  prefs: FramePrefs | null;
}

export interface AppValue {
  /** Preferences and any stored session have been read; the splash stays up until then. */
  ready: boolean;
  /** UI and statement language (ceb by default; the first run sets it; the member may switch any time). */
  lang: Lang;
  setLang(l: Lang): void;
  /** Adlaw by default (register §1). */
  theme: ThemeName;
  setTheme(t: ThemeName): void;
  /** First run done (language and whatever else onboarding asks). Pairing is separate: see `session`. */
  onboarded: boolean;
  completeOnboarding(): void;
  /**
   * S1.9 "Basahon o Paminawon una?": null until the member answers; stored on this device only, changeable from the
   * statement, never inferred from age or literacy.
   */
  listenFirst: boolean | null;
  setListenFirst(v: boolean): void;
  session: PairedSession | null;
  /** Saves a paired session (device bearer → secure store; demo → preferences; frame → memory only). */
  setSession(s: PairedSession | null): void;
  /** Forgets the session (unpair). First-run choices stay. */
  signOut(): void;
  api: FairSplitApi;
  /** Demo mode's controller (labelled simulated PayPal events), or null against a live fs-api. */
  demo: DemoController | null;
  online: boolean;
  /** Last time a screen got fresh data from the server (for "Katapusang kopya, 10:21"). */
  lastSync: string | null;
  markSynced(): void;
  frame: FrameState;
  /** English under each Cebuano or Filipino statement sentence (judge frames, `fs.prefs.gloss`). */
  gloss: boolean;
}

const AppContext = createContext<AppValue | null>(null);

function isDemoStage(v: string | null): v is DemoStage {
  return v !== null && (DEMO_STAGES as readonly string[]).includes(v);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [lang, setLangState] = useState<Lang>("ceb");
  const [theme, setThemeState] = useState<ThemeName>("adlaw");
  const [onboarded, setOnboarded] = useState(false);
  const [listenFirst, setListenFirstState] = useState<boolean | null>(null);
  const [session, setSessionState] = useState<PairedSession | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [framePrefs, setFramePrefs] = useState<FramePrefs | null>(inFrame ? DEFAULT_FRAME_PREFS : null);
  const online = useOnline();
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
      const [l, t, ob, lf, sSecret, sDemo] = await Promise.all([
        prefs.get(PREF.lang),
        prefs.get(PREF.theme),
        prefs.get(PREF.onboarded),
        prefs.get(PREF.listenFirst),
        secrets.get(PREF.session),
        prefs.get(PREF.session),
      ]);
      if (!alive) return;
      if (l && (LANGS as readonly string[]).includes(l)) setLangState(l as Lang);
      const qt = themeFromQuery();
      if (qt) setThemeState(qt);
      else if (t === "adlaw" || t === "tablea") setThemeState(t);
      setOnboarded(ob === "1" || inFrame);
      if (lf === "1" || lf === "0") setListenFirstState(lf === "1");
      // Labelled demo links for review and the stage frames before fs-api exists:
      // ?demo=member|board|clerk&stage=checking|sent|paid|unclaimed|cash-due|cash-received
      const demoRole = demo ? webQuery("demo") : null;
      if (demo && (demoRole === "member" || demoRole === "board" || demoRole === "clerk")) {
        setSessionState(demoSession(demoRole, new Date()));
        setOnboarded(true);
        const stage = webQuery("stage");
        if (isDemoStage(stage)) demo.advance(stage);
        setReady(true);
        return;
      }
      // A stage frame waits for its `fs.token` instead of restoring a stored session.
      const now = new Date();
      if (!inFrame) setSessionState(parseSession(sSecret, now) ?? parseSession(sDemo, now));
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [demo]);

  // IC-12: judge stage frames receive their token and preferences by postMessage and skip the first run.
  useEffect(
    () =>
      startFrameBridge(
        {
          onSession: (s) => {
            setSessionState(s); // memory only: a frame token is never stored
            setOnboarded(true);
          },
          onPrefs: setFramePrefs,
          onReset: () => {
            setSessionState(null);
            demo?.advance("checking");
          },
        },
        BUILD.version,
      ),
    [demo],
  );

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    void prefs.set(PREF.lang, l);
  }, []);
  const setTheme = useCallback((t: ThemeName) => {
    setThemeState(t);
    void prefs.set(PREF.theme, t);
  }, []);
  const completeOnboarding = useCallback(() => {
    setOnboarded(true);
    void prefs.set(PREF.onboarded, "1");
  }, []);
  const setListenFirst = useCallback((v: boolean) => {
    setListenFirstState(v);
    void prefs.set(PREF.listenFirst, v ? "1" : "0");
  }, []);
  const setSession = useCallback((s: PairedSession | null) => {
    setSessionState(s);
    if (!s) {
      void secrets.del(PREF.session);
      void prefs.del(PREF.session);
      return;
    }
    if (s.bearer === DEMO_BEARER) void prefs.set(PREF.session, JSON.stringify(s));
    else if (s.kind === "device") void secrets.set(PREF.session, JSON.stringify(s));
    // Web frame tokens (a pairing QR opened in a browser) stay in memory for the tab's life.
  }, []);
  const signOut = useCallback(() => setSession(null), [setSession]);
  const markSynced = useCallback(() => setLastSync(new Date().toISOString()), []);

  const value = useMemo<AppValue>(
    () => ({
      ready,
      lang,
      setLang,
      theme,
      setTheme,
      onboarded,
      completeOnboarding,
      listenFirst,
      setListenFirst,
      session,
      setSession,
      signOut,
      api,
      demo,
      online,
      lastSync,
      markSynced,
      frame: { inFrame, prefs: framePrefs },
      gloss: framePrefs?.gloss ?? false,
    }),
    [
      ready,
      lang,
      setLang,
      theme,
      setTheme,
      onboarded,
      completeOnboarding,
      listenFirst,
      setListenFirst,
      session,
      setSession,
      signOut,
      api,
      demo,
      online,
      lastSync,
      markSynced,
      framePrefs,
    ],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppValue {
  const v = useContext(AppContext);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
