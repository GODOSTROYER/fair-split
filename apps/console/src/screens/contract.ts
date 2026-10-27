// The frozen contract between the route files (shared, WS-CONSOLE) and the screen modules (slices). Each
// `src/screens/<SCREEN-ID>/index.tsx` exports the components named here with exactly these props; the
// routes pass path params and the register's search params (`?photo=`, `?hold=`, `?member=`) and nothing
// else. A screen reads everything else through the data hooks. `contract.test.ts` checks the exports.

/** W-JG-01 `/judge`: the first view (the stage chrome around it is shared). */
export type JudgeScreenProps = Record<string, never>;

/** W-JG-01's always-mounted stage extras: "Play it for me", its cursor, "Try to break it" (via ChromePortal). */
export type StageExtrasProps = Record<string, never>;

/** W-TR-01 `/season/:seasonCode`, W-TR-02 `/season/:seasonCode/rate-card`. */
export interface SeasonScreenProps {
  /** The season label as routed: "2026-A". */
  readonly seasonCode: string;
}

/** W-TR-03 `/season/:seasonCode/reading?photo=B`. */
export interface ReadingScreenProps extends SeasonScreenProps {
  /** A–L or P01–P54, when the URL names one. */
  readonly photo?: string;
}

/** W-TR-04 `/season/:seasonCode/by-hand/:slipNo`. */
export interface ByHandScreenProps extends SeasonScreenProps {
  readonly slipNo: string;
}

/** W-TR-05 `/runs/:runSlug/split`, also told which drawer or line is open so it can make room. */
export interface SplitScreenProps {
  readonly runSlug: string;
  /** `?hold=H1`: W-TR-06 is open on this hold (a label or an ID). */
  readonly hold?: string;
  /** `?member=M-014`: W-TR-09's member line is open. */
  readonly member?: string;
}

/** W-TR-06 the hold drawer, rendered beside the split when `?hold=` is set. */
export interface HoldDrawerProps {
  readonly runSlug: string;
  readonly holdId: string;
}

/** W-TR-09 the member line, rendered beside the split when `?member=` is set. */
export interface MemberLineProps {
  readonly runSlug: string;
  readonly memberNo: string;
}

/** W-TR-09 `/runs/:runSlug/members/:memberNo/print`, the 80 mm statement. */
export interface PrintScreenProps {
  readonly runSlug: string;
  readonly memberNo: string;
}

/** W-TR-07 `/runs/:runSlug/approve`, W-TR-08 `/runs/:runSlug/fanout`. */
export interface RunScreenProps {
  readonly runSlug: string;
}

/** W-TR-10, mounted once at the root and opened with "?" (or the rail and pill menus). */
export interface ShortcutSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** W-PF-01 `/proof/:runSlug` (W-BR-01's brand header joins it when the brand tier applies). */
export interface ProofScreenProps {
  readonly runSlug: string;
}

/** W-BR-01's entry `/b/:token`: the signed brand link. */
export interface BrandEntryProps {
  readonly token: string;
}

/** W-OP-01 `/ops`. */
export type OpsScreenProps = Record<string, never>;
