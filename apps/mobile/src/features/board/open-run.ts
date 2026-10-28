/**
 * Which co-sign request the Pirma tab opens (M-BD-01), the pure half. fs-api does not name the open request yet
 * (orchestrator: an open-request endpoint, or the run slug in the pairing response or the push data), so the tab
 * tries, in order, the run a push or link last opened on this phone for this workspace, then the seed's run as a
 * stand-in, and opens the first one that is actually waiting for the Chair. When none is, the tab says there is
 * nothing to sign rather than opening a run that is not waiting for him.
 */
import type { ApiResult, CosignRequestDTO } from "../../_shims/api-client";
import { RUN_SLUG_RE } from "../../_shims/contracts";
import { requestExpired } from "./cosign-model";

/** What one candidate run says when asked. */
export type RunProbe = "open" | "closed" | "missing" | "offline" | "error";

export type PirmaTarget =
  | { kind: "open"; runSlug: string }
  | { kind: "none" }
  | { kind: "offline" }
  | { kind: "error" };

/** The runs to ask, most specific first, each once, and only ones that look like a run (`2026A-r37`). */
export function runCandidates(remembered: string | null | undefined, seedRun: string): string[] {
  const out: string[] = [];
  for (const slug of [remembered, seedRun]) {
    if (slug && RUN_SLUG_RE.test(slug) && !out.includes(slug)) out.push(slug);
  }
  return out;
}

/** Open means waiting for the Chair's key now: a request or an override that has not expired. */
export function probeRequest(r: ApiResult<CosignRequestDTO>, now: number): RunProbe {
  if (!r.ok) {
    if (r.code === "NETWORK" && r.status === undefined) return "offline";
    return r.status === 404 || r.status === 410 ? "missing" : "error";
  }
  const open = (r.value.state === "request" || r.value.state === "override") && !requestExpired(r.value, now);
  return open ? "open" : "closed";
}

/** The first open run wins; with none open, no signal or a failure says so, and otherwise there is nothing to sign. */
export function pickTarget(probes: readonly { runSlug: string; probe: RunProbe }[]): PirmaTarget {
  const open = probes.find((p) => p.probe === "open");
  if (open) return { kind: "open", runSlug: open.runSlug };
  if (probes.some((p) => p.probe === "offline")) return { kind: "offline" };
  if (probes.some((p) => p.probe === "error")) return { kind: "error" };
  return { kind: "none" };
}

/** The run a push or link opened last, remembered per workspace (a re-paired phone never reuses another's run). */
export interface RememberedRun {
  ws: string;
  runSlug: string;
}

export const LAST_RUN_KEY = "fs.board.lastRun";

export function parseRememberedRun(raw: string | null, ws: string | null): string | null {
  if (!raw || !ws) return null;
  try {
    const v = JSON.parse(raw) as Partial<RememberedRun>;
    return v.ws === ws && typeof v.runSlug === "string" && RUN_SLUG_RE.test(v.runSlug) ? v.runSlug : null;
  } catch {
    return null;
  }
}
