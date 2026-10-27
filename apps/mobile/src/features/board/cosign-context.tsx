/**
 * One co-sign request, shared by M-BD-01 (the request) and M-BD-02 (the sign sheet) so they agree on what was opened:
 * one fetch, one SSE stream, one recomputed hash (I4). With WS-CORE's functions the phone recomputes `batchSha256` from
 * the items and `linesDigest` from every member line the moment they arrive, and remembers the batch the Chair first
 * saw. Before any key is touched, the approval payload is recomputed from its own items and lines and checked against
 * that batch. Key 1's signature, the treasurer's presence and any change to the batch arrive over SSE
 * (`run:<runSlug>`); a declined, changed or expired request is never signable.
 *
 * What the gate in front of the key reads (the request, the opened batch, the payload) is also kept in refs that are
 * written in the same tick as the state, so a release that lands before React has re-rendered is still judged on the
 * latest batch, never on the one the slab was drawn with. The rules themselves are pure (`cosign-model.ts`).
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
import type { CosignRequestDTO } from "../../_shims/api-client";
import type { ApprovalSignedPayload, PresencePayload } from "../../_shims/contracts";
import { checkApprovalPayload, type ExpectedBatch, type RequestCheck } from "../../lib/signing";
import { prefs } from "../../platform/kv";
import { useApp } from "../../state/app";
import {
  type ChangeReason,
  type CommitRefusal,
  type CosignSnapshot,
  changeReason,
  commitRefusal,
  EMPTY_MEMORY,
  type FreshPayload,
  forgetPayload,
  type Presence,
  payloadPlan,
  prefetchFor,
  type RequestMemory,
  type RequestStatus,
  rememberPayload,
  rememberRequest,
  requestStatus,
  sealKeysFor,
  treasurerPresence,
} from "./cosign-model";
import { LAST_RUN_KEY } from "./open-run";

/** How often the screen re-reads the clock for expiry and presence freshness. */
const TICK_MS = 15_000;

export type { FreshPayload } from "./cosign-model";

export interface CosignValue {
  runSlug: string;
  status: RequestStatus;
  dto: CosignRequestDTO | null;
  check: RequestCheck | null;
  change: ChangeReason | null;
  key1: boolean;
  chairSigned: boolean;
  keys: 0 | 1 | 2;
  /** Rings engrave only for a key that goes in while the Chair watches; a cold load draws them still. */
  engrave: boolean;
  presence: Presence | null;
  now: number;
  /** Fetches the request again; `adopt` makes the new batch the one the Chair has now opened. */
  reload(adopt?: boolean): Promise<void>;
  /**
   * Why the key may not be asked for at this instant (I4: the batch changed, no signal, nothing open), read from the
   * latest state rather than the last render; null when it may.
   */
  commitRefusal(): CommitRefusal | null;
  /** A payload for the opened batch, valid for the next fingerprint step; fetched again when nearly expired. */
  freshPayload(): Promise<FreshPayload>;
  /** Forgets the payload in hand (its nonce was used or refused); the next signature fetches a fresh one. */
  dropPayload(): void;
  markSigned(): void;
  sendBack(reason: string): Promise<boolean>;
}

const Ctx = createContext<CosignValue | null>(null);

function loadErrorFor(r: { code: string; status?: number }): "offline" | "none" | "error" {
  if (r.code === "NETWORK" && r.status === undefined) return "offline";
  if (r.status === 404 || r.status === 410) return "none";
  return "error";
}

/** State plus a ref written in the same call, for readers that must not wait for a render. */
function useLatest<T>(initial: T): [T, (next: T) => void, { readonly current: T }] {
  const [value, setValue] = useState(initial);
  const ref = useRef(initial);
  const set = useCallback((next: T) => {
    ref.current = next;
    setValue(next);
  }, []);
  return [value, set, ref];
}

export function CosignProvider({ runSlug, children }: { runSlug: string; children: ReactNode }) {
  const { api, online, markSynced, session } = useApp();
  const workspace = useRef<string | null>(null);
  workspace.current = session?.workspaceId ?? null;
  /** The Pirma tab asks this run first next time (`open-run.ts`), until fs-api names the open request. */
  const remembered = useRef<string | null>(null);
  const [memory, setMemory, memoryRef] = useLatest<RequestMemory>(EMPTY_MEMORY);
  const [loading, setLoading, loadingRef] = useLatest(true);
  const [loadError, setLoadError, loadErrorRef] = useLatest<"offline" | "none" | "error" | null>(null);
  const [chairSigned, setChairSigned, chairSignedRef] = useLatest(false);
  const [sentBack, setSentBack, sentBackRef] = useLatest(false);
  const [key1Live, setKey1Live] = useState(false);
  const [engrave, setEngrave] = useState(false);
  const [livePresence, setLivePresence] = useState<Presence | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  const onlineRef = useRef(online);
  onlineRef.current = online;
  /** Each fetch's number: only the latest answers, so a slow old response never replaces a newer batch. */
  const loads = useRef(0);
  /** "Review again" was asked for: the next fetch to answer becomes the opened batch. */
  const adoptNext = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const update = useCallback(
    (f: (m: RequestMemory) => RequestMemory) => setMemory(f(memoryRef.current)),
    [setMemory, memoryRef],
  );

  const fetchPayload = useCallback(
    async (expected: ExpectedBatch): Promise<FreshPayload> => {
      const p = await api.getApprovalPayload(runSlug, "chair");
      if (!alive.current) return { ok: false, reason: "error" };
      if (!p.ok) return { ok: false, reason: loadErrorFor(p) === "offline" ? "offline" : "error" };
      // I4: the payload's own items and lines must give its digests, and they must be the batch he opened.
      const checked = checkApprovalPayload(p.value, expected, new Date());
      update((m) => rememberPayload(m, expected, checked));
      if (!checked.ok) return { ok: false, reason: checked.problem === "expired" ? "error" : "mismatch" };
      return { ok: true, approval: checked.dto, expected };
    },
    [api, runSlug, update],
  );

  const load = useCallback(
    async (adopt = false) => {
      if (adopt) adoptNext.current = true;
      const seq = ++loads.current;
      const r = await api.getCosignRequest(runSlug);
      if (!alive.current || seq !== loads.current) return;
      const take = adoptNext.current;
      adoptNext.current = false;
      setLoading(false);
      if (!r.ok) {
        setLoadError(loadErrorFor(r));
        return;
      }
      markSynced();
      setLoadError(null);
      const ws = workspace.current;
      if (ws && remembered.current !== `${ws}/${runSlug}`) {
        remembered.current = `${ws}/${runSlug}`;
        void prefs.set(LAST_RUN_KEY, JSON.stringify({ ws, runSlug }));
      }
      update((m) => rememberRequest(m, r.value, take));
      setNow(Date.now());
      if (r.value.state === "signed") setChairSigned(true);
      const expected = prefetchFor(memoryRef.current);
      if (expected) await fetchPayload(expected);
    },
    [api, runSlug, markSynced, update, memoryRef, fetchPayload, setLoading, setLoadError, setChairSigned],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // A connection coming back refreshes what is on screen (and is the only way a stale copy becomes signable).
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) void load();
    wasOnline.current = online;
  }, [online, load]);

  useEffect(
    () =>
      api.subscribe(`run:${runSlug}`, (e) => {
        if (!alive.current) return;
        if (e.type === "approval.signed") {
          const p = e.payload as ApprovalSignedPayload;
          setEngrave(true);
          if (p.role === "treasurer") {
            setKey1Live(true);
            void load();
          } else if (p.role === "chair") {
            setChairSigned(true);
          }
        } else if (e.type === "presence") {
          const p = e.payload as PresencePayload;
          setLivePresence({ persona: p.persona, view: p.view, at: e.at });
          setNow(Date.now());
        } else if (
          e.type === "approval.declined" ||
          e.type === "run.state" ||
          e.type === "line.state" ||
          e.type === "hold.raised" ||
          e.type === "hold.resolved"
        ) {
          void load();
        }
      }),
    [api, runSlug, load, setChairSigned],
  );

  const latest = useCallback(
    (): CosignSnapshot => ({
      ...memoryRef.current,
      loading: loadingRef.current,
      loadError: loadErrorRef.current,
      online: onlineRef.current,
      now: Date.now(),
      sentBack: sentBackRef.current,
      chairSigned: chairSignedRef.current,
    }),
    [memoryRef, loadingRef, loadErrorRef, sentBackRef, chairSignedRef],
  );

  const refusalNow = useCallback(() => commitRefusal(latest()), [latest]);

  const freshPayload = useCallback(async (): Promise<FreshPayload> => {
    const plan = payloadPlan(memoryRef.current, new Date());
    if (plan.kind === "refuse") return { ok: false, reason: "mismatch" };
    if (plan.kind === "cached") return { ok: true, approval: plan.approval, expected: plan.expected };
    return fetchPayload(plan.expected);
  }, [memoryRef, fetchPayload]);

  const dropPayload = useCallback(() => update(forgetPayload), [update]);

  const markSigned = useCallback(() => {
    setEngrave(true);
    setChairSigned(true);
  }, [setChairSigned]);

  const sendBack = useCallback(
    async (reason: string) => {
      const r = await api.declineApproval(runSlug, { role: "chair", reason });
      if (r.ok && alive.current) setSentBack(true);
      return r.ok;
    },
    [api, runSlug, setSentBack],
  );

  const value = useMemo<CosignValue>(() => {
    const snapshot: CosignSnapshot = {
      ...memory,
      loading,
      loadError,
      online,
      now,
      sentBack,
      chairSigned,
    };
    const dto = memory.dto;
    const key1 = key1Live || !!dto?.treasurerSigned;
    const presenceFromDto = dto?.presence ?? null;
    const freshest =
      livePresence && (!presenceFromDto || Date.parse(livePresence.at) >= Date.parse(presenceFromDto.at))
        ? livePresence
        : presenceFromDto;
    return {
      runSlug,
      status: requestStatus(snapshot),
      dto,
      check: memory.check,
      change: changeReason(snapshot),
      key1,
      chairSigned,
      keys: chairSigned ? 2 : key1 ? 1 : sealKeysFor(dto, false),
      engrave,
      presence: treasurerPresence(freshest, now),
      now,
      reload: load,
      commitRefusal: refusalNow,
      freshPayload,
      dropPayload,
      markSigned,
      sendBack,
    };
  }, [
    memory,
    loading,
    loadError,
    online,
    now,
    sentBack,
    chairSigned,
    key1Live,
    livePresence,
    engrave,
    runSlug,
    load,
    refusalNow,
    freshPayload,
    dropPayload,
    markSigned,
    sendBack,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCosign(): CosignValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCosign outside CosignProvider");
  return v;
}
