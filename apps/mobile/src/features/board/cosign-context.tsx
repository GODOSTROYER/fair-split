/**
 * One co-sign request, shared by M-BD-01 (the request) and M-BD-02 (the sign sheet) so they agree on what was opened:
 * one fetch, one SSE stream, one recomputed hash (I4). The phone recomputes `batchSha256` from the items the moment
 * they arrive, remembers the hash the Chair first saw, and checks the server's approval payload against it before
 * any key is touched. Key 1's signature, the treasurer's presence and any change to the batch arrive over SSE
 * (`run:<runSlug>`); a declined, changed or expired request is never signable.
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
import type { ApprovalPayload, ApprovalSignedPayload, PresencePayload } from "../../_shims/contracts";
import {
  checkApprovalPayload,
  checkCosignRequest,
  type ExpectedBatch,
  payloadStale,
  type RequestCheck,
} from "../../lib/signing";
import { useApp } from "../../state/app";
import {
  type ChangeReason,
  changeReason,
  type Presence,
  type RequestStatus,
  requestStatus,
  sealKeysFor,
  treasurerPresence,
} from "./cosign-model";

/** How often the screen re-reads the clock for expiry and presence freshness. */
const TICK_MS = 15_000;

export type FreshPayload =
  | { ok: true; payload: ApprovalPayload; expected: ExpectedBatch }
  | { ok: false; reason: "offline" | "mismatch" | "error" };

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
  /** A payload valid for the next fingerprint step, fetched again when the one in hand is nearly expired. */
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

export function CosignProvider({ runSlug, children }: { runSlug: string; children: ReactNode }) {
  const { api, online, markSynced } = useApp();
  const [dto, setDto] = useState<CosignRequestDTO | null>(null);
  const [check, setCheck] = useState<RequestCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<"offline" | "none" | "error" | null>(null);
  const [payload, setPayload] = useState<ApprovalPayload | null>(null);
  const [payloadOk, setPayloadOk] = useState<boolean | null>(null);
  const [openedHash, setOpenedHash] = useState<string | null>(null);
  const [key1Live, setKey1Live] = useState(false);
  const [chairSigned, setChairSigned] = useState(false);
  const [sentBack, setSentBack] = useState(false);
  const [engrave, setEngrave] = useState(false);
  const [livePresence, setLivePresence] = useState<Presence | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  const opened = useRef<string | null>(null);

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

  const fetchPayload = useCallback(
    async (expected: ExpectedBatch): Promise<FreshPayload> => {
      const p = await api.getApprovalPayload(runSlug, "CHAIR");
      if (!alive.current) return { ok: false, reason: "error" };
      if (!p.ok) return { ok: false, reason: loadErrorFor(p) === "offline" ? "offline" : "error" };
      const c = checkApprovalPayload(p.value, expected, new Date());
      if (!c.ok) {
        // An expired payload is simply replaced next time; any other difference means it is not this batch.
        if (c.problem !== "expired") setPayloadOk(false);
        return { ok: false, reason: c.problem === "expired" ? "error" : "mismatch" };
      }
      setPayload(c.payload);
      setPayloadOk(true);
      return { ok: true, payload: c.payload, expected };
    },
    [api, runSlug],
  );

  const load = useCallback(
    async (adopt = false) => {
      const r = await api.getCosignRequest(runSlug);
      if (!alive.current) return;
      setLoading(false);
      if (!r.ok) {
        setLoadError(loadErrorFor(r));
        return;
      }
      markSynced();
      setLoadError(null);
      const c = checkCosignRequest(r.value);
      setDto(r.value);
      setCheck(c);
      setNow(Date.now());
      if (r.value.state === "signed") setChairSigned(true);
      if (c.ok && (adopt || opened.current === null)) {
        opened.current = c.recomputed.batchSha256;
        setOpenedHash(c.recomputed.batchSha256);
        if (adopt) setPayloadOk(null);
      }
      const unchanged = c.ok && c.recomputed.batchSha256 === opened.current;
      const signable = r.value.state === "request" || r.value.state === "override";
      if (c.ok && unchanged && signable && r.value.treasurerSigned) await fetchPayload(c.expected);
    },
    [api, runSlug, markSynced, fetchPayload],
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
          if (p.role === "TREASURER") {
            setKey1Live(true);
            void load();
          } else if (p.role === "CHAIR") {
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
    [api, runSlug, load],
  );

  const freshPayload = useCallback(async (): Promise<FreshPayload> => {
    if (!check?.ok) return { ok: false, reason: "mismatch" };
    if (payload && payloadOk && !payloadStale(payload, new Date())) {
      return { ok: true, payload, expected: check.expected };
    }
    return fetchPayload(check.expected);
  }, [check, payload, payloadOk, fetchPayload]);

  const dropPayload = useCallback(() => {
    setPayload(null);
  }, []);

  const markSigned = useCallback(() => {
    setEngrave(true);
    setChairSigned(true);
  }, []);

  const sendBack = useCallback(
    async (reason: string) => {
      const r = await api.declineApproval(runSlug, { role: "CHAIR", reason });
      if (r.ok && alive.current) setSentBack(true);
      return r.ok;
    },
    [api, runSlug],
  );

  const value = useMemo<CosignValue>(() => {
    const snapshot = {
      loading,
      loadError,
      dto,
      check,
      payloadOk,
      openedHash,
      online,
      now,
      sentBack,
      chairSigned,
    };
    const key1 = key1Live || !!dto?.treasurerSigned;
    const presenceFromDto = dto?.presence ?? null;
    const latest =
      livePresence && (!presenceFromDto || Date.parse(livePresence.at) >= Date.parse(presenceFromDto.at))
        ? livePresence
        : presenceFromDto;
    return {
      runSlug,
      status: requestStatus(snapshot),
      dto,
      check,
      change: changeReason(snapshot),
      key1,
      chairSigned,
      keys: chairSigned ? 2 : key1 ? 1 : sealKeysFor(dto, false),
      engrave,
      presence: treasurerPresence(latest, now),
      now,
      reload: load,
      freshPayload,
      dropPayload,
      markSigned,
      sendBack,
    };
  }, [
    loading,
    loadError,
    dto,
    check,
    payloadOk,
    openedHash,
    online,
    now,
    sentBack,
    chairSigned,
    key1Live,
    livePresence,
    engrave,
    runSlug,
    load,
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
