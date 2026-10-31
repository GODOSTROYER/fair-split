// Planted copy for the E-19 rules: one violation per rule, near misses each rule must let through, and the
// schedule's own replacement wording (§6 "Must say"), which must pass every rule. This is test data, not copy:
// the lint never scans packages/test-kit.
import type { Beat } from "./script.js";

/** One sentence per rule that must make it fire. */
export const PLANTED: Readonly<Record<string, string>> = {
  "sandbox-says-simulated": "Payouts run in PayPal's sandbox on US test accounts.",
  "paypal-confirms-says-simulated": "It is paid once PayPal confirms payment.",
  "live-paypal-says-simulated": "PayPal calls run live against the US test accounts.",
  "real-sandbox": "Real PayPal sandbox calls on US test accounts.",
  "debug-ids": "Every payout carries PayPal's debug IDs for the judges.",
  "pr107-evidence": "Payouts v1 typed tool, evidence on PR #107.",
  "pr107-merged": "Our Payouts tool follows PR #107, which PayPal merged.",
  "live-payouts": "Live payouts land on members' phones.",
  "recorded-claude-run": "Slip reading replays a recorded Claude run (29 Oct).",
  "claudes-draft": "Make Claude's draft overcharge Lantern Bay.",
  "insufficient-funds-test-value":
    "Send PayPal's insufficient-funds test value: a one-item batch it rejects at once.",
  "showcase-cash-receipts": "Seeded: the showcase run's cash receipts.",
  "webhooks-move-payouts": "Webhooks move each payout to paid.",
  apimatic: "Grounded with the APIMatic Context Plugin.",
  "pp-ocrv5": "A 40-case eval against PP-OCRv5.",
  kokoro: "Narration by Kokoro, an open voice.",
  "claude-reads-every-slip": "Claude reads every slip twice, independently.",
  "read-twice-by-ai-seeded": "Your slips were read twice by AI (Claude).",
  "codex-made-photos": "The twelve Codex-made photos A–L of the season.",
  "pays-every-member": "PayPal Payouts pays each member.",
  "drive-every-state": "Verified notices drive every state.",
  certified: "A certified payroll for cacao co-ops.",
  "eudr-compliant": "Every lot is EUDR-compliant.",
  "real-farmers": "Built with real farmers in Davao.",
  "production-ready": "A production-ready payroll for co-ops.",
  "instant-gcash": "Members get instant GCash transfers.",
  "carbon-claims": "Each payout is carbon-neutral.",
  "this-moves-money": "{n} payouts, {amount}, by PayPal. This moves money.",
  "nightly-reconciliation": "Reconciliation with PayPal's Transaction Search runs nightly.",
  "one-variable-switch": "Switching PayPal modes is one environment variable.",
  "user-reviewed-merged": "Claude Code wrote the code; the user reviewed and merged.",
};

/** Near misses: sentences close to each rule's phrase that the rule must let through. */
export const CLEAN: Readonly<Record<string, readonly string[]>> = {
  "sandbox-says-simulated": [
    "PayPal steps run on a simulated PayPal sandbox.",
    "Designed so one variable points it at PayPal's sandbox; this has not been tested.",
  ],
  "paypal-confirms-says-simulated": [
    "It is paid once the simulated PayPal sandbox confirms payment.",
    "Sent, waiting for PayPal.",
  ],
  "live-paypal-says-simulated": [
    "The simulated PayPal sandbox answers live in the browser.",
    "Live Claude read of the hero slips.",
    "Where the PayPal and AI calls are made.",
  ],
  "real-sandbox": [
    "The PayPal rail is a simulator; a real sandbox app is untested.",
    "No real farmer was paid.",
  ],
  "debug-ids": ["Simulated run IDs (sim- debug IDs)."],
  "pr107-evidence": ["Our typed Payouts tool, built on PR #107's schemas."],
  "pr107-merged": [
    "Claude Code agents wrote, reviewed and merged the code.",
    "Our typed Payouts tool follows PR #107's names.",
  ],
  "live-payouts": [
    "Payouts run on the simulated PayPal sandbox.",
    "Claude's live reads were last run on 22 Oct.",
  ],
  "recorded-claude-run": [
    "Line labels: a placeholder written with the seed (no Claude recording in this build).",
    "Placeholder, seed-written (not a Claude recording).",
    "Recorded by the co-op, {time}.",
  ],
  "claudes-draft": [
    "Make the invoice draft overcharge Lantern Bay.",
    "Placeholder draft (seed-written), checked by the live policy lattice.",
  ],
  "insufficient-funds-test-value": [
    "Send the simulator's modelled ERRPYO005 (insufficient funds): a one-item batch the simulated PayPal rejects at once.",
  ],
  "showcase-cash-receipts": ["Cash at the bodega, received by the clerk."],
  "webhooks-move-payouts": [
    "Status checks move each payout; the simulator's signed webhooks are verified and recorded.",
  ],
  apimatic: ["PayPal AI-Toolkit plugin: PayPal docs and tools inside Claude Code."],
  "pp-ocrv5": ["A 40-case eval of the slip reader."],
  kokoro: ["Gemini TTS: member audio, labelled as a synthetic voice."],
  "claude-reads-every-slip": [
    "Claude is built to read every slip twice; this replay is a labelled stand-in.",
    "claude-opus-5-5 is built to read handwritten weigh-slips.",
  ],
  "read-twice-by-ai-seeded": [
    "In this demo, the slip readings are a labelled stand-in for Claude's double reading; a person checked the unsure ones, and Treasurer {{TREASURER}} approved this pay.",
  ],
  "codex-made-photos": [
    "The 10 hero slips (OpenAI's image model via Codex CLI); photos A–L are composed in code from them and code-drawn slips.",
    "Ten Codex-made hero slips.",
  ],
  "pays-every-member": [
    "Payouts v1 pays the 7 of 64 members who have PayPal, through a simulated PayPal sandbox; 57 are paid in cash on the same statement.",
    "Every member gets a receipt to check.",
  ],
  "drive-every-state": ["Status checks move each payout."],
  certified: ["Fairtrade's Standard for Cocoa requires per-member premium receipts."],
  "eudr-compliant": ["Plot coordinates are shared with Lantern Bay under the data-sharing agreement."],
  "real-farmers": [
    "A prototype on a simulated PayPal sandbox, with synthetic people: no real farmer was paid.",
    "No real farmers were paid.",
  ],
  "production-ready": ["In production to the Philippines, 2% = {production}."],
  "instant-gcash": ["Cash at the bodega, not GCash."],
  "carbon-claims": ["Claude writes in pencil. People sign in ink. PayPal makes it carbon."],
  "this-moves-money": [
    "Sends {n} payouts through the simulated PayPal sandbox. No real money moves.",
    "{label}, {amount}, moves money",
  ],
  "nightly-reconciliation": [
    "Our record of the simulator's signed notices, verified and stored; no nightly reconciliation in this build.",
  ],
  "one-variable-switch": [
    "Designed so one variable points it at PayPal's sandbox; this has not been tested.",
  ],
  "user-reviewed-merged": [
    "Claude Code agents wrote, reviewed and merged the code under an automated review-and-verify protocol; the user approved every outward step.",
  ],
};

/** The schedule's replacement wording (§6 "Must say", without W1, R1 or C5d): every rule lets it through. */
export const HONEST: readonly string[] = [
  "Fair Split pays the 7 of 64 members who have PayPal, through a simulated PayPal sandbox; 57 are paid in cash on the same statement.",
  "Status checks move each payout; the simulator's signed webhooks are verified and recorded.",
  "PayPal calls run against a simulated PayPal sandbox (contract-tested against PayPal's OpenAPI specs), not PayPal's own sandbox.",
  "Judge Mode replays a labelled seed stand-in for the slip reading; Claude's live reads were last run on 22 Oct on code-drawn test slips.",
  "Claude Code agents wrote, reviewed and merged the code under an automated review-and-verify protocol; the user approved every outward step.",
  "Designed so one variable points it at PayPal's sandbox; this has not been tested.",
  "Mark Lantern Bay's invoice paid (simulated PayPal sandbox)",
  "The simulated PayPal sandbox is pacing us (PayPal's documented limit, modelled).",
  "PayPal fees: simulated sandbox fee {sandboxEach}, estimate.",
  "Line labels: a placeholder written with the seed (no Claude recording in this build).",
  "The simulated balance is low.",
  "Make the invoice draft overcharge Lantern Bay.",
  "Send the simulator's modelled ERRPYO005 (insufficient funds): a one-item batch the simulated PayPal rejects at once.",
  "The 10 hero slips (OpenAI's image model via Codex CLI); photos A–L are composed in code from them and code-drawn slips.",
  "Placeholder draft (seed-written), checked by the live policy lattice.",
  "12 photo hashes (composed in code from the hero flats and code-drawn slips).",
  "Our record of the simulator's signed notices, verified and stored; each payout's status comes from a status check; no nightly reconciliation in this build.",
  "Placeholder, seed-written (not a Claude recording).",
  "Confirmed by the simulated PayPal sandbox on {date}.",
  "Sends {n} payouts through the simulated PayPal sandbox. No real money moves.",
  "A status check confirms each item (simulated).",
  "In this demo, the slip readings are a labelled stand-in for Claude's double reading; a person checked the unsure ones, and Treasurer {{TREASURER}} approved this pay.",
  "Simulator-signed, signature verified.",
  "One invoice through PayPal's Agent Toolkit, on a simulated PayPal sandbox. Nothing starts until it reads paid.",
  "Claude is built to read every slip twice; this replay is a labelled stand-in.",
  "The simulated PayPal accepts the batch.",
  "Our typed Payouts tool, built on PR #107's schemas.",
  "A prototype on a simulated PayPal sandbox, with synthetic people: no real farmer was paid.",
  "Simulated PayPal sandbox; untested against PayPal's own sandbox.",
  "PayPal Payouts (simulated sandbox) pays the members who have PayPal.",
  "The PayPal rail is a simulator; a real sandbox app is untested.",
  "Simulated run IDs (sim- debug IDs).",
  "Simulator-reported fees.",
];

/** Figures that are not in IC-03, and figures that are. */
export const FIGURES = {
  planted: [
    "Lantern Bay pays US$4,999.00 for the season.",
    "On the scale: 150.5 kg.",
    "About ₱99,999 in cash.",
  ],
  clean: [
    "Invoice US$4,333.50, about ₱270,844 (estimate).",
    "Premium 43.69, rule R0, 148.0 kg: US$43.69.",
    "₱62.50 per US$; PayPal fees $0.25 × 8 = $2.00, or 2% = $7.37 in production.",
    "Lot LB-PH-2026-03 shipped 9,625 kg; CBU up to ₱5,000; hauling ₱1.50 a kg.",
    "A batch over US$300 needs the Chair.",
  ],
} as const;

/** A script that breaks both limits, and one inside them (the beat sheet's shape, S5.6.2). */
export const SCRIPTS: { readonly over: readonly Beat[]; readonly within: readonly Beat[] } = {
  over: [
    {
      label: "fast",
      start: 0,
      end: 10,
      say: "Sixty-four cacao farmers, two hundred sixty-four handwritten slips, one premium, and a long run of words that no narrator could say inside ten seconds without rushing it.",
    },
    ...Array.from({ length: 10 }, (_, i) => ({
      label: `filler ${i + 1}`,
      start: 10 + i * 14,
      end: 24 + i * 14,
      say: "Twenty-four words of narration fill this beat at a calm pace, so only the total runs past the film's budget of two hundred forty words.",
    })),
  ],
  within: Array.from({ length: 10 }, (_, i) => ({
    label: `beat ${i + 1}`,
    start: i * 14,
    end: 14 + i * 14,
    say: "Twenty-three words of narration fill this beat at a calm pace, well under one hundred forty words a minute for the film.",
  })),
};
