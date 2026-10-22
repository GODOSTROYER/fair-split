// Screen IDs and routes from decision register §4. These IDs are canonical; design aliases
// (J1, C1, …) are kept for cross-reference only. Test hooks: data-testid="{screenId}.{element}".
import type { RunSlug, SeasonLabel } from "./primitives.js";

export type Surface = "web" | "app";

export interface ScreenDef {
  readonly id: string;
  readonly alias: string | null;
  readonly name: string;
  readonly surface: Surface;
  /** Route pattern(s) exactly as the register writes them. */
  readonly routes: readonly string[];
}

export const SCREENS = {
  "W-JG-01": { id: "W-JG-01", alias: "J1", name: "Judge stage", surface: "web", routes: ["/judge"] },
  "W-AU-01": {
    id: "W-AU-01",
    alias: null,
    name: "Sign in (real accounts)",
    surface: "web",
    routes: ["/sign-in"],
  },
  "W-TR-01": { id: "W-TR-01", alias: "C1", name: "Season", surface: "web", routes: ["/season/:seasonCode"] },
  "W-TR-02": {
    id: "W-TR-02",
    alias: "C2",
    name: "Rate card",
    surface: "web",
    routes: ["/season/:seasonCode/rate-card"],
  },
  "W-TR-03": {
    id: "W-TR-03",
    alias: "C3",
    name: "Reading room",
    surface: "web",
    routes: ["/season/:seasonCode/reading"],
  },
  "W-TR-04": {
    id: "W-TR-04",
    alias: "C4",
    name: "By hand",
    surface: "web",
    routes: ["/season/:seasonCode/by-hand/:slipNo"],
  },
  "W-TR-05": {
    id: "W-TR-05",
    alias: "C5",
    name: "Split review",
    surface: "web",
    routes: ["/runs/:runSlug/split"],
  },
  "W-TR-06": {
    id: "W-TR-06",
    alias: "C6",
    name: "Hold drawer",
    surface: "web",
    routes: ["/runs/:runSlug/split?hold=:holdId"],
  },
  "W-TR-07": {
    id: "W-TR-07",
    alias: "C7",
    name: "Approve",
    surface: "web",
    routes: ["/runs/:runSlug/approve"],
  },
  "W-TR-08": {
    id: "W-TR-08",
    alias: "C8",
    name: "Run: fan-out and log",
    surface: "web",
    routes: ["/runs/:runSlug/fanout"],
  },
  "W-TR-09": {
    id: "W-TR-09",
    alias: "C9",
    name: "Member line; 80 mm print",
    surface: "web",
    routes: ["/runs/:runSlug/split?member=:memberNo", "/runs/:runSlug/members/:memberNo/print"],
  },
  "W-TR-10": {
    id: "W-TR-10",
    alias: "C10",
    name: "Command menu, shortcuts, Data mode",
    surface: "web",
    routes: [],
  },
  "W-PF-01": {
    id: "W-PF-01",
    alias: "P1",
    name: "Proof (public)",
    surface: "web",
    routes: ["/proof/:runSlug"],
  },
  "W-BR-01": {
    id: "W-BR-01",
    alias: "B1",
    name: "Proof with the brand header",
    surface: "web",
    routes: ["/proof/:runSlug"],
  },
  "W-OP-01": {
    id: "W-OP-01",
    alias: null,
    name: "Ops (read-only for judges)",
    surface: "web",
    routes: ["/ops"],
  },
  "W-DP-01": {
    id: "W-DP-01",
    alias: null,
    name: "Design prototype (gate G1)",
    surface: "web",
    routes: ["/prototype"],
  },
  "M-ON-01": {
    id: "M-ON-01",
    alias: "A0",
    name: "First run: language, theme, pairing",
    surface: "app",
    routes: ["/onboarding/language", "/onboarding/theme", "/onboarding/pair"],
  },
  "M-MB-01": {
    id: "M-MB-01",
    alias: "M1",
    name: "Bayad (statement)",
    surface: "app",
    routes: ["/(member)/bayad"],
  },
  "M-MB-02": {
    id: "M-MB-02",
    alias: "M2",
    name: "Resibo (slips)",
    surface: "app",
    routes: ["/(member)/resibo"],
  },
  "M-MB-03": {
    id: "M-MB-03",
    alias: "M3",
    name: "Paminawa (listen) sheet",
    surface: "app",
    routes: ["/(member)/paminawa"],
  },
  "M-MB-04": {
    id: "M-MB-04",
    alias: "M4",
    name: "Pangutana (questions)",
    surface: "app",
    routes: ["/(member)/pangutana"],
  },
  "M-CL-01": {
    id: "M-CL-01",
    alias: "K1",
    name: "Scan and outbox",
    surface: "app",
    routes: ["/(clerk)/scan", "/(clerk)/outbox"],
  },
  "M-BD-01": {
    id: "M-BD-01",
    alias: "D1",
    name: "Co-sign request",
    surface: "app",
    routes: ["/(board)/pirma/[runSlug]"],
  },
  "M-BD-02": {
    id: "M-BD-02",
    alias: "D2",
    name: "Sign",
    surface: "app",
    routes: ["/(board)/pirma/[runSlug]/sign"],
  },
} as const satisfies Record<string, ScreenDef>;

export type ScreenId = keyof typeof SCREENS;
export const SCREEN_IDS = Object.keys(SCREENS) as ScreenId[];

/** `data-testid` value for an element on a screen (register §4). */
export function testId(screen: ScreenId, element: string): string {
  return `${screen}.${element}`;
}

const enc = encodeURIComponent;

/** Web route builders (one Vite SPA, same origin as the API). */
export const webRoutes = {
  judge: () => "/judge",
  signIn: () => "/sign-in",
  season: (season: SeasonLabel) => `/season/${enc(season)}`,
  rateCard: (season: SeasonLabel) => `/season/${enc(season)}/rate-card`,
  reading: (season: SeasonLabel, photo?: string) =>
    `/season/${enc(season)}/reading${photo ? `?photo=${enc(photo)}` : ""}`,
  byHand: (season: SeasonLabel, slipNo: string) => `/season/${enc(season)}/by-hand/${enc(slipNo)}`,
  split: (runSlug: RunSlug) => `/runs/${enc(runSlug)}/split`,
  holdDrawer: (runSlug: RunSlug, holdId: string) => `/runs/${enc(runSlug)}/split?hold=${enc(holdId)}`,
  approve: (runSlug: RunSlug) => `/runs/${enc(runSlug)}/approve`,
  fanout: (runSlug: RunSlug) => `/runs/${enc(runSlug)}/fanout`,
  memberLine: (runSlug: RunSlug, memberNo: string) => `/runs/${enc(runSlug)}/split?member=${enc(memberNo)}`,
  memberPrint: (runSlug: RunSlug, memberNo: string) => `/runs/${enc(runSlug)}/members/${enc(memberNo)}/print`,
  proof: (runSlug: RunSlug) => `/proof/${enc(runSlug)}`,
  ops: () => "/ops",
  prototype: () => "/prototype",
  /** The member's signed link; redirects to `/app/s/:token`. */
  memberLink: (token: string) => `/s/${enc(token)}`,
} as const;

/** Fair Split app (Expo Router) routes. The web export is served under `/app` (C-11). */
export const appRoutes = {
  webBase: "/app",
  deepLinkScheme: "fairsplit://",
  onboardingLanguage: () => "/onboarding/language",
  onboardingTheme: () => "/onboarding/theme",
  onboardingPair: () => "/onboarding/pair",
  bayad: () => "/(member)/bayad",
  resibo: () => "/(member)/resibo",
  paminawa: () => "/(member)/paminawa",
  pangutana: () => "/(member)/pangutana",
  scan: () => "/(clerk)/scan",
  outbox: () => "/(clerk)/outbox",
  pirma: (runSlug: RunSlug) => `/(board)/pirma/${enc(runSlug)}`,
  sign: (runSlug: RunSlug) => `/(board)/pirma/${enc(runSlug)}/sign`,
  /** Pairing QR, single use, 10 minutes. */
  pair: (token: string) => `/app/pair?t=${enc(token)}`,
  memberLink: (token: string) => `/app/s/${enc(token)}`,
} as const;

/** Role tabs in the app (register §4, App navigation). */
export const APP_TABS = {
  member: ["bayad", "resibo", "pangutana"],
  clerk: ["scan", "outbox"],
  board: ["pirma", "bayad", "pangutana"],
} as const;

/** Keyboard shortcuts on the console (W-TR-10). */
export const CONSOLE_SHORTCUTS = { commandMenu: "Mod+K", shortcuts: "?", dataMode: "D" } as const;
