// E-19 public-copy lint: the phrase rules and their allowances (schedule replan-1031 §3 Q2 and §6, ADR-0002,
// and the plan's E-19 word list in S5.7.1). A rule reads one sentence at a time, case-insensitively.
//
// Each rule says why it exists and, where the schedule names one, what evidence would lift it. Lifting a ban
// is a change to this file in the PR that ships the evidence, never an allowance: an allowance is for one
// known sentence in one file that is waiting on a named work package.

/** A sentence that names the simulator is qualified (ADR-0002: "Simulated PayPal sandbox"). */
const SIMULATED = /\bsimulat(?:ed|or|ors|ion|es)\b/i;
/** A sentence that says PayPal's own sandbox has not been tried. */
const UNTESTED = /\buntested\b|\bunverified\b|\bnot\s+(?:been\s+|yet\s+)?tested\b/i;

const either = (...res: readonly RegExp[]): RegExp => new RegExp(res.map((r) => r.source).join("|"), "i");

const MONTH = String.raw`(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?`;
/**
 * Where copy writes a run's date: a placeholder ("{date}", "{recorded}", "${d}"; the scanner reads a template
 * literal's substitution as "{}"), "29 Oct", "Oct 29" or "2026-10-29". The seed's recordedOn fills these, and no
 * copy may present it as a Claude run's date (§6, seed constants.ts:121).
 */
const DATE = String.raw`(?:\$?\{[^}]*\}|\d{1,2}\s+${MONTH}(?:\s+\d{4})?|${MONTH}\s+\d{1,2}(?:,?\s+\d{4})?|\d{4}-\d{2}-\d{2})`;
const re = (source: string): RegExp => new RegExp(source, "i");
/**
 * Not right after a negation in the same clause: "no live payouts", "not certified", "is not yet production-ready",
 * "Nothing here is certified". At most two words may sit between, and punctuation ends the reach, so "No fees, and
 * live payouts" still fires.
 */
const NOT_NEGATED = String.raw`(?<!\b(?:no|not|never|nothing|isn['’]t|aren['’]t|wasn['’]t|weren['’]t)\s+(?:[\w-]+\s+){0,2})`;

export interface CopyRule {
  readonly id: string;
  /** Why the phrase is banned or must be qualified; printed with every finding. */
  readonly reason: string;
  /** Fires when this matches a sentence. */
  readonly pattern: RegExp;
  /** A sentence that also matches this is qualified, so the rule stays quiet. */
  readonly unless?: RegExp;
  /** The rule stays quiet when the same file matches this anywhere (a variant that lives beside it). */
  readonly unlessInFile?: RegExp;
  /** Also checked in literals without whitespace (product names); sentence rules skip single tokens. */
  readonly token?: boolean;
  /** The evidence that would lift the ban, as the schedule names it. Documentation only. */
  readonly liftedBy?: string;
}

export const RULES: readonly CopyRule[] = [
  // ------------------------------------------------------------------ ADR-0002: PayPal is simulated
  {
    id: "sandbox-says-simulated",
    reason:
      "ADR-0002: PayPal runs only on our simulator, so a sentence that says sandbox also says simulated (or that PayPal's own sandbox is untested)",
    pattern: /\bsandbox(?:es)?\b/i,
    unless: either(SIMULATED, UNTESTED),
  },
  {
    id: "paypal-confirms-says-simulated",
    reason: "ADR-0002: only the simulated PayPal sandbox confirms anything in this build",
    pattern: /\bPayPal(?:['’]s)?\s+(?:is\s+|has\s+)?confirm(?:s|ed|ing)?\b|\bconfirmed\s+by\s+PayPal\b/i,
    unless: SIMULATED,
  },
  {
    id: "live-paypal-says-simulated",
    reason: "ADR-0002: no PayPal call is live; 'live' next to PayPal needs 'simulated' in the same sentence",
    pattern: /\blive\b(?:\W+\w+){0,5}?\W+PayPal\b|\bPayPal\b(?:\W+\w+){0,5}?\W+live\b/i,
    unless: SIMULATED,
  },
  {
    id: "real-sandbox",
    reason: "ADR-0002: no real sandbox object exists; a real sandbox may be named only as untested",
    pattern: /\breal\s+(?:PayPal\s+)?sandbox\b/i,
    unless: UNTESTED,
  },
  {
    id: "debug-ids",
    reason: "ADR-0002: no PayPal debug ID exists; only the simulator's sim- debug IDs, labelled as simulated",
    pattern: /\bdebug[\s_-]?ids?\b/i,
    unless: either(SIMULATED, /\bsim-/i),
  },
  {
    id: "pr107-evidence",
    reason: "There is no PR #107 evidence; say 'our typed Payouts tool, built on PR #107's schemas' (§6)",
    pattern: /\bPR\s*#?\s*107(?:['’]s)?\s+evidence\b|\bevidence\s+(?:on|from|in|of)\s+PR\s*#?\s*107\b/i,
  },
  {
    id: "pr107-merged",
    reason: "PayPal's ai-toolkit PR #107 is not merged upstream; never put 'merged' beside it (plan E-19)",
    pattern: re(
      String.raw`\bPR\s*#?\s*107\b[^.;]*${NOT_NEGATED}\bmerged\b|${NOT_NEGATED}\bmerged\b[^.;]*\bPR\s*#?\s*107\b`,
    ),
  },
  {
    id: "live-payouts",
    reason: "ADR-0002 and plan E-19: no payout is live; payouts run on the simulated PayPal sandbox",
    pattern: re(String.raw`${NOT_NEGATED}\blive\s+payouts?\b`),
  },
  {
    id: "recorded-claude-run",
    reason:
      "No recorded Claude run exists (§6): seeded and replayed runs replay a labelled seed stand-in, never a Claude recording",
    pattern: either(
      re(String.raw`\brecorded\s+(?:${DATE}\s+)?(?:real\s+|live\s+)?(?:Claude\s+)?(?:run|reading|read)s?\b`),
      /\bClaude(?:['’]s)?\s+(?:\w+\s+){0,3}?(?:reading|run|reads?)\b[^.;]*?\brecorded\b/i,
      re(String.raw`(?<![\w-])${DATE}\s+(?:Claude\s+)?recordings?\b`),
      // "the audit agent's invoice draft, from the same recording" (§6 What's real: remove it)
      /\b(?:from|in|of|by)\s+the\s+same\s+recording\b/i,
      /\brecordings?\s+of\s+(?:the\s+|a\s+)?Claude(?:['’]s)?\s+(?:\w+\s+){0,2}?(?:run|reading|read)s?\b/i,
      /\brecorded\s+by\s+Claude\b(?!\s+Code)/i,
      // "Replay, recorded 2026-10-24 (placeholder)" (§6: fs-api agent/recording.ts:42, replay.ts:82)
      re(String.raw`\breplay\w*\b[^.;]*?\brecorded\s+(?:on\s+)?${DATE}`),
      re(String.raw`\brecorded\s+(?:on\s+)?${DATE}\s*\(placeholder\)`),
    ),
    unless: /\bno\s+Claude\s+recording\b|\bnot\s+a\s+Claude\s+recording\b/i,
    liftedBy: "R1 (a recorded read of the hero slips) with C5d's exhibit",
  },
  {
    id: "replay-of-dated-run",
    reason:
      "The seed's recordedOn is no run's date (§6, seed constants.ts:121): a replay is of a labelled seed stand-in, never 'the {date} run'",
    pattern: re(
      String.raw`\breplay(?:s|ed|ing)?\s+(?:of\s+|from\s+)?(?:the\s+|a\s+)?(?:recorded\s+)?${DATE}\s+(?:Claude\s+)?(?:run|reading|recording)s?\b`,
    ),
    unless: /\bstand-in\b|\bseed\b/i,
    liftedBy: "R2 (recordedOn replaced with R1's real date) with C5d's exhibit",
  },
  {
    id: "replay-as-claude-reading",
    reason:
      "A replay plays a labelled seed stand-in (J1: 'Seed stand-in, not a Claude recording'), never Claude's reading: say Claude 'is built to read' the slips, or what happens 'in a live run' (§6)",
    pattern: either(
      /\bClaude['’]s\s+(?:[\w-]+\s+)?(?:readings?|reads?|runs?)\b[^.;]{0,60}?\breplay(?:s|ed|ing)?\b/i,
      /\breplay(?:s|ed|ing)?\s+(?:of\s+)?(?:the\s+|a\s+)?Claude['’]s\s+(?:[\w-]+\s+)?(?:readings?|reads?|runs?)\b/i,
      /\bClaude\s+reads\s+(?:them|these|those|their\s+slips?|the\s+(?:[\w-]+\s+){0,2}?slips?)\b/i,
    ),
    unless: /\bbuilt\s+to\b|\bin\s+a\s+live\s+run\b|\bstand-in\b/i,
    liftedBy: "C5d's exhibit of R1's real reading",
  },

  // ------------------------------------------------------------------ §6: banned or qualified
  {
    id: "claudes-draft",
    reason:
      "The audit agent is paused (WS-AGENT): there is no Claude or agent draft; say 'the invoice draft' or 'placeholder draft (seed-written)' (§6)",
    pattern: either(
      /\bClaude['’]s\s+(?:invoice\s+)?drafts?\b/i,
      /(?<!\bClaude\s+Code\s+)\b(?:audit\s+)?agent['’]s\s+(?:invoice\s+)?drafts?\b/i,
      /\b(?:Claude|the\s+(?:audit\s+)?agent)\s+(?:is|was)\s+(?:re-?)?drafting\b/i,
      /\bClaude\s+(?:re-?)?drafts\b/i,
      /(?<!\bClaude\s+Code\s+)\b(?:Claude|agent)[\s-](?:re-?)?drafted\b/i,
      /\bdrafted\s+by\s+(?:Claude\b(?!\s+Code)|the\s+(?:audit\s+)?agent\b|an?\s+(?:AI\s+)?agent\b)/i,
    ),
  },
  {
    id: "insufficient-funds-test-value",
    reason:
      "PayPal's insufficient-funds control is unbuilt; name only the simulator's modelled ERRPYO005 (§6)",
    pattern: /\binsufficient[\s-]funds\s+test\s+value\b/i,
    liftedBy: "P2's ERRPYO005 control, reworded as the simulator's modelled error",
  },
  {
    id: "showcase-cash-receipts",
    reason: "The showcase run's cash receipts are not on the host (§6)",
    pattern: /\bshowcase\s+run(?:['’]s)?\s+cash\s+receipts?\b/i,
    liftedBy: "Z2",
  },
  {
    id: "webhooks-move-payouts",
    reason:
      "Webhook delivery is not stored (W1): status checks move each payout; the simulator's signed webhooks are verified and recorded",
    pattern: /\bwebhooks?\s+(?:drive|drives|driving|move|moves|moving)\b/i,
    liftedBy: "W1",
  },
  {
    id: "apimatic",
    reason: "No APIMatic SDK path ships (§6; the architecture map has no APIMatic box)",
    pattern: /\bAPIMatic\b/i,
    token: true,
    liftedBy: "D9",
  },
  {
    id: "pp-ocrv5",
    reason: "PP-OCRv5 and its eval are cut (§6)",
    pattern: /\bPP-?OCR(?:v\d+)?\b/i,
    token: true,
  },
  {
    id: "kokoro",
    reason: "Kokoro is not used; Gemini TTS is the only synthetic voice (§6)",
    pattern: /\bKokoro\b/i,
    token: true,
    liftedBy: "F4 using Kokoro",
  },
  {
    id: "claude-reads-every-slip",
    reason:
      "The judge path replays a labelled stand-in, not a live Claude reading: say Claude 'is built to read' every slip (§6)",
    pattern:
      /\bClaude\s+reads\s+(?:every|each|all(?:\s+the)?)\s+(?:[\w-]+\s+)?slips?\b|\bclaude-opus-[\w.-]+\s+reads\b/i,
    unless: /\bbuilt\s+to\b/i,
    liftedBy: "C5d's exhibit of R1's real reading",
  },
  {
    id: "read-twice-by-ai-seeded",
    reason:
      "Seeded runs carry T1's demo AI_NOTE: the product note ('read twice by AI') may exist only beside its seeded variant (§6)",
    pattern: /\bread\s+twice\s+by\s+AI\b/i,
    unlessInFile: /\bstand-in\s+for\s+Claude\b/i,
  },
  {
    id: "codex-made-photos",
    reason:
      "Photos A–L are composed in code from the hero flats and code-drawn slips, not made by Codex (§6, Z5)",
    pattern:
      /\bCodex[\s-]made\b[^.;]*\b(?:photos?|A\s*[–-]\s*L)\b|\b(?:photos?|A\s*[–-]\s*L)\b[^.;]*\bCodex[\s-]made\b/i,
  },

  // ------------------------------------------------------------------ the plan's E-19 word list (S5.7.1)
  {
    id: "pays-every-member",
    reason:
      "PayPal pays only the 7 of 64 members who have it, through a simulated sandbox; 57 are paid in cash (plan E-19, DR-3)",
    pattern:
      /\bpays?\s+(?:every|each|all(?:\s+the)?)\s+(?:\d+\s+)?(?:members?|farmers?)\b|\b(?:every|each)\s+(?:member|farmer)\s+(?:is|gets|was)\s+paid\b|\ball\s+(?:\d+\s+)?(?:the\s+)?(?:members|farmers)\s+(?:are|were|get)\s+paid\b/i,
  },
  {
    id: "drive-every-state",
    reason: "Plan E-19: webhooks do not drive every state",
    pattern: /\bdrives?\s+every\s+state\b/i,
  },
  {
    id: "certified",
    reason: "Plan E-19: Fair Split claims no certification",
    pattern: re(String.raw`${NOT_NEGATED}\bcertified\b`),
    token: true,
  },
  {
    id: "eudr-compliant",
    reason: "Plan E-19: Fair Split claims no EUDR compliance",
    pattern: /\bEUDR[\s-]compli(?:ant|ance)\b/i,
    token: true,
  },
  {
    id: "real-farmers",
    reason: "Plan E-19: every person is synthetic; only 'no real farmer was paid' may name real farmers",
    pattern: re(String.raw`${NOT_NEGATED}\breal\s+farmers\b(?!\s+(?:are|were)\s+(?:not|never)\b)`),
  },
  {
    id: "production-ready",
    reason: "Plan E-19: a hackathon prototype on a simulated rail is not production-ready",
    pattern: re(String.raw`${NOT_NEGATED}\bproduction[\s-]ready\b`),
    token: true,
  },
  {
    id: "instant-gcash",
    reason: "Plan E-19: nothing is paid to GCash, instantly or otherwise",
    pattern: /\binstant\s+GCash\b/i,
  },
  {
    id: "carbon-claims",
    reason: "Plan E-19: Fair Split makes no carbon or climate claim",
    pattern:
      /\bcarbon[\s-](?:neutral|negative|positive|offsets?|credits?|footprint|zero|free|sequest\w*)\b|\bnet[\s-]zero\b|\blow[\s-]carbon\b|\bCO2e?\b|\bdecarboni[sz]\w*/i,
    token: true,
  },

  // ------------------------------------------------------------------ claims §6 rewords outright
  {
    id: "this-moves-money",
    reason: "ADR-0002: payouts go through the simulated PayPal sandbox; say 'No real money moves' (§6)",
    pattern: /\bthis\s+moves\s+(?:real\s+)?money\b/i,
    unless: /\bno\s+real\s+money\b/i,
  },
  {
    id: "nightly-reconciliation",
    reason:
      "No Transaction Search reconciliation runs in this build; say 'no nightly reconciliation' (§6, plate 6)",
    pattern:
      /\b(?:reconcil\w*|Transaction\s+Search)\b[^.;]*\bnightly\b|\bnightly\b[^.;]*\b(?:reconcil\w*|Transaction\s+Search)\b/i,
    unless: /\bno\s+nightly\s+reconciliation\b/i,
  },
  {
    id: "one-variable-switch",
    reason: "Switching to PayPal's own sandbox has never been tried; say that it is untested (§6)",
    pattern: /\bone\s+(?:environment\s+)?variable\b/i,
    unless: UNTESTED,
  },
  {
    id: "user-reviewed-merged",
    reason:
      "Claude Code agents reviewed and merged the code under the review-and-verify protocol; the user approved every outward step (§6)",
    pattern: /\bthe\s+user\s+reviewed\s+and\s+merged\b/i,
  },
];

/** The rule for figures: every money or kilo figure equals one in IC-03 (packages/seed). */
export const FIGURES_RULE = {
  id: "figures-equal-ic03",
  reason: "Every money or kilo figure in public copy equals one in IC-03 (packages/seed's snapshot)",
} as const;

/** One known sentence in one file that a rule lets through. */
export interface Allowance {
  readonly rule: string;
  /** Repo-relative path, forward slashes. */
  readonly file: string;
  /** A phrase of the flagged sentence (a case-insensitive substring). */
  readonly phrase: string;
  readonly why: string;
  /**
   * The work package whose merge removes the need. Once it lands the sentence no longer fires, the allowance
   * goes stale and the lint fails until the entry is deleted. Absent: a lasting exception, still stale-checked.
   */
  readonly pending?: "C5a";
}

/**
 * Lasting exceptions: sentences that trip a rule's words but make none of the claims it bans. Each must still
 * match its sentence, so a reworded line drops its exception.
 */
export const EXCEPTIONS: readonly Allowance[] = [
  {
    rule: "certified",
    file: "apps/console/src/features/ratecard/copy.ts",
    phrase: "Certified by",
    why: "the rate card's signature block (the Secretary certifies the Board resolution), not a certification claim",
  },
  {
    rule: FIGURES_RULE.id,
    file: "apps/console/src/features/proof/copy.ts",
    phrase: "capped at ₱50",
    why: "PayPal Philippines' published payout fee cap, quoted as a production cost, not a season figure",
  },
  {
    rule: FIGURES_RULE.id,
    file: "apps/console/src/features/ratecard/copy.ts",
    phrase: "₱150",
    why: "MM-4's sample deduction, typed into the bolted rate card so the server refuses it; never computed or paid",
  },
];

/**
 * Console copy waiting on C5a (console honesty copy, ws/console; schedule §3 C5a and §6), one named entry per
 * file, listed from ws/console's tip e5c5806 and re-checked at 42a9338 and e7757ad. Q2 does not edit
 * apps/console. While ws/console is unmerged these files are absent and the entries are dormant; once it merges
 * each must match, and each one C5a rewords goes stale and must be deleted here.
 */
const PENDING_C5A: Readonly<Record<string, readonly (readonly [rule: string, phrase: string])[]>> = {
  "apps/console/src/chrome/copy.ts": [
    ["sandbox-says-simulated", "PayPal sandbox calls"],
    ["recorded-claude-run", "replays a recorded Claude run"],
    ["sandbox-says-simulated", "sandbox is pacing us"],
    ["recorded-claude-run", "The recorded run still plays"],
    ["sandbox-says-simulated", "The sandbox balance is low"],
    ["sandbox-says-simulated", "points them at PayPal's sandbox instead"],
    ["sandbox-says-simulated", "PayPal sandbox"],
    ["recorded-claude-run", "Claude's reading of {} slips"],
    ["showcase-cash-receipts", "showcase run's cash receipts"],
    ["sandbox-says-simulated", "Sandbox accounts"],
    ["claudes-draft", "Make Claude's draft overcharge"],
    ["insufficient-funds-test-value", "insufficient-funds test value"],
    ["claudes-draft", "The audit agent's invoice draft"],
    ["recorded-claude-run", "from the same recording"],
  ],
  "apps/console/src/data/describe.ts": [
    ["paypal-confirms-says-simulated", "confirmed by PayPal's postback"],
    ["recorded-claude-run", "the recorded run still plays"],
    ["replay-of-dated-run", "replay of the {} run"],
  ],
  "apps/console/src/data/errors.ts": [
    ["sandbox-says-simulated", "Only the sandbox is allowed here"],
    ["sandbox-says-simulated", "sandbox is pacing us"],
    ["recorded-claude-run", "The recorded run still plays"],
    ["debug-ids", "PayPal debug ID"],
  ],
  "apps/console/src/features/brand/BrandHeader.tsx": [
    ["paypal-confirms-says-simulated", "once PayPal confirms payment"],
    ["paypal-confirms-says-simulated", "confirmed by PayPal"],
  ],
  "apps/console/src/features/ops/OpsPage.tsx": [["sandbox-says-simulated", "PayPal sandbox"]],
  "apps/console/src/features/ops/opsModel.ts": [
    ["sandbox-says-simulated", "PayPal sandbox"],
    ["recorded-claude-run", "the recorded run still plays"],
  ],
  "apps/console/src/features/ops/sections.ts": [
    ["debug-ids", "debug ID"],
    ["nightly-reconciliation", "Nightly Transaction Search"],
  ],
  "apps/console/src/features/proof/Chain.tsx": [
    ["nightly-reconciliation", "corroborated nightly by Transaction Search"],
  ],
  "apps/console/src/features/proof/ProofView.tsx": [
    ["paypal-confirms-says-simulated", "confirmed by PayPal"],
  ],
  "apps/console/src/features/proof/copy.ts": [
    ["sandbox-says-simulated", "in PayPal's sandbox"],
    ["sandbox-says-simulated", "PayPal sandbox"],
    ["paypal-confirms-says-simulated", "confirmed by PayPal"],
    ["sandbox-says-simulated", "marked as paid in sandbox"],
  ],
  "apps/console/src/features/reading/copy.ts": [
    ["recorded-claude-run", "recorded run"],
    ["recorded-claude-run", "stand-in for the {} recording"],
  ],
  "apps/console/src/features/reading/model.ts": [
    ["replay-as-claude-reading", "Claude's reading replays once"],
  ],
  "apps/console/src/features/season/copy.ts": [
    ["recorded-claude-run", "in the recorded {} run"],
    ["claudes-draft", "Claude's draft"],
    ["claudes-draft", "Claude drafted the invoice"],
    ["paypal-confirms-says-simulated", "Nothing starts until PayPal confirms"],
    ["sandbox-says-simulated", "Marked as paid in sandbox"],
    ["sandbox-says-simulated", "in PayPal's sandbox"],
    ["claudes-draft", "Claude is drafting again"],
    ["replay-as-claude-reading", "Claude's reading of the slips replays next"],
    ["replay-as-claude-reading", "Claude's reading of them replays now"],
    ["replay-as-claude-reading", "Claude reads them once the money is in"],
  ],
  "apps/console/src/features/split/shared/copy.ts": [["paypal-confirms-says-simulated", "PayPal confirms"]],
  "apps/console/src/lib/provenance.ts": [["replay-of-dated-run", "replay of the {} run"]],
  "apps/console/src/stage/Stage.tsx": [
    ["claudes-draft", "Claude drafted"],
    ["replay-of-dated-run", "invoiceEqualsQuote, replay of the {} run"],
    ["sandbox-says-simulated", "Invoicing v2, PayPal sandbox"],
  ],
};

/** The file whose arrival means ws/console has merged: from then on every console allowance must match. */
export const CONSOLE_MERGED_SENTINEL = "apps/console/src/chrome/copy.ts";

/** Every allowance: the lasting exceptions, then the entries pending C5a. */
export const ALLOWANCES: readonly Allowance[] = [
  ...EXCEPTIONS,
  ...Object.entries(PENDING_C5A).flatMap(([file, entries]) =>
    entries.map(([rule, phrase]) => ({
      rule,
      file,
      phrase,
      why: "C5a rewords the console's honesty copy (schedule §3 C5a, §6)",
      pending: "C5a" as const,
    })),
  ),
];
