// Who a payout item is sent to. Receiver addresses never live in the repository or the database: members carry
// a `receiver_ref` (their member number), and the address comes from env (S3.6.1):
//
//   PP_RECEIVERS           a JSON map member number → sandbox e-mail ({"M-014": "…"}), or "M-014=…,M-007=…"
//   PP_UNCLAIMED_RECEIVER  the address with no PayPal account (Rhea, OD-11): her item parks UNCLAIMED
//
// In simulator mode (ADR-0002) a member without a configured address gets the seed's labelled `.example`
// alias, so the simulated rail can run the whole batch; in sandbox mode an unknown member has no receiver
// and stays off the batch (the sandbox guard only ever pays known sandbox accounts).
import { getMember } from "@fairsplit/seed";
import type { ApiEnv } from "../env.js";

export interface ReceiverDirectory {
  /** The address for a member's PayPal line, or null when none is known. */
  receiverFor(memberNo: string): string | null;
  /** The sandbox guard: only known receivers are ever paid. */
  allowed(receiver: string): boolean;
  /** "env" when every address came from configuration; "seeded_alias" when a simulated alias filled a gap. */
  sourceOf(memberNo: string): "env" | "seeded_alias" | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseReceivers(raw: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw) return out;
  const text = raw.trim();
  if (text.startsWith("{")) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if (/^M-\d{3}$/.test(k) && typeof v === "string" && EMAIL.test(v.trim())) out.set(k, v.trim());
      }
    } catch {
      // unreadable JSON: no receivers (boot logs the variable name only)
    }
    return out;
  }
  for (const pair of text.split(",")) {
    const [k, v] = pair.split("=").map((s) => s.trim());
    if (k && v && /^M-\d{3}$/.test(k) && EMAIL.test(v)) out.set(k, v);
  }
  return out;
}

/** The seed's labelled alias (`m014@members.fairsplit.example`), used only on the simulated rail. */
export function seededAlias(memberNo: string): string | null {
  const m = getMember(memberNo);
  if (m?.rail !== "PAYPAL") return null;
  if (m.receiverAlias) return m.receiverAlias;
  const local = memberNo.toLowerCase().replace("-", "");
  return m.receiverKind === "NO_PAYPAL_ACCOUNT"
    ? `${local}.no-account@unclaimed.fairsplit.example`
    : `${local}@members.fairsplit.example`;
}

export function receiverDirectory(paypal: ApiEnv["paypal"]): ReceiverDirectory {
  const configured = parseReceivers(paypal.receivers);
  const unclaimed =
    paypal.unclaimedReceiver && EMAIL.test(paypal.unclaimedReceiver) ? paypal.unclaimedReceiver : null;
  const simulated = paypal.mode === "simulator";
  const resolve = (memberNo: string): { address: string; source: "env" | "seeded_alias" } | null => {
    const env = configured.get(memberNo);
    if (env) return { address: env, source: "env" };
    if (getMember(memberNo)?.receiverKind === "NO_PAYPAL_ACCOUNT" && unclaimed) {
      return { address: unclaimed, source: "env" };
    }
    if (simulated) {
      const alias = seededAlias(memberNo);
      if (alias) return { address: alias, source: "seeded_alias" };
    }
    return null;
  };
  const known = new Set<string>(
    [...configured.values(), ...(unclaimed ? [unclaimed] : [])].map((e) => e.toLowerCase()),
  );
  return {
    receiverFor: (memberNo) => resolve(memberNo)?.address ?? null,
    allowed(receiver) {
      const r = receiver.toLowerCase();
      if (known.has(r)) return true;
      // the simulated rail also knows the seed's labelled aliases
      return (
        simulated && (r.endsWith("@members.fairsplit.example") || r.endsWith("@unclaimed.fairsplit.example"))
      );
    },
    sourceOf: (memberNo) => resolve(memberNo)?.source ?? null,
  };
}
