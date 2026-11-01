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
  "webhook-verified-says-simulated": "PayPal, webhook, signature verified",
  "pr107-evidence": "Payouts v1 typed tool, evidence on PR #107.",
  "pr107-merged": "Our Payouts tool follows PR #107, which PayPal merged.",
  "live-payouts": "Live payouts land on members' phones.",
  "recorded-claude-run": "Slip reading replays a recorded Claude run (29 Oct).",
  "replay-of-dated-run": "Reading 12 photos. Replay of the 29 Oct run.",
  "replay-as-claude-reading": "Funded. Claude's reading of the slips replays next.",
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

/**
 * More forms a rule must catch beyond its one planted sentence: the placeholders and dates copy fills in (§6
 * "Console copy.ts:36" and "Stage.tsx:99–102", and seed constants.ts:121, whose recordedOn no copy may present as a
 * Claude run's date), the paused agent's draft, a recording of Claude, and a replay presented as Claude's reading
 * (the forms ws/console's What's real and season copy use). Each is checked as a markdown paragraph and as a
 * TypeScript string literal.
 */
export const PLANTED_FORMS: readonly (readonly [rule: string, text: string])[] = [
  ["recorded-claude-run", "Claude wrote the line labels in the recorded {recorded} run."],
  ["recorded-claude-run", "Claude wrote the line labels in the recorded 29 Oct run."],
  ["recorded-claude-run", "Slip reading replays a recorded {d} Claude run."],
  // biome-ignore lint/suspicious/noTemplateCurlyInString: planted copy that prints a template placeholder as text
  ["recorded-claude-run", "Slip reading replays a recorded ${d} Claude run."],
  ["recorded-claude-run", "Slip reading replays a recorded 2026-10-29 Claude run."],
  ["recorded-claude-run", "MM-2 plays the 28 Oct recording."],
  ["recorded-claude-run", "Replay of the recorded {date} run."],
  ["replay-of-dated-run", "Reading 12 photos. Replay of the {date} run."],
  ["replay-of-dated-run", "invoiceEqualsQuote, replay of the {recorded} run"],
  ["replay-of-dated-run", "Read by Claude (claude-opus-5-5), replay of the 29 Oct run"],
  ["replay-of-dated-run", "Slip reading replays the Oct 29 Claude run."],
  ["replay-of-dated-run", "Replayed from the 2026-10-29 run."],
  ["replay-of-dated-run", "A replay of the {date} recording."],
  // The paused audit agent's draft, in every form the console and film use (WS-AGENT; §6 "No evidence today").
  ["claudes-draft", "Claude's drafts overcharge Lantern Bay."],
  ["claudes-draft", "The audit agent's invoice draft, checked again by the policy lattice."],
  ["claudes-draft", "The audit agent’s draft, checked again by the policy lattice."],
  ["claudes-draft", "Policy refused it (invoiceEqualsQuote). Claude is drafting again."],
  ["claudes-draft", "The Claude-drafted invoice."],
  ["claudes-draft", "An agent-drafted invoice."],
  ["claudes-draft", "The invoice was drafted by Claude through PayPal's Agent Toolkit."],
  ["claudes-draft", "The invoice was drafted by the audit agent."],
  ["claudes-draft", "Drafted by the agent, checked by the policy lattice."],
  // A recording of Claude that does not exist (§6 What's real; fs-api agent/replay.ts:82).
  ["recorded-claude-run", "The invoice draft, from the same recording, checked again by the policy lattice."],
  ["recorded-claude-run", "Replays a recording of Claude's run."],
  ["recorded-claude-run", "A reading recorded by Claude on 29 Oct."],
  ["recorded-claude-run", "A reading recorded by Claude on {date}."],
  ["recorded-claude-run", "Replay, recorded 2026-10-24 (placeholder)."],
  ["recorded-claude-run", "Replay, recorded {recordedOn} (placeholder)"],
  ["recorded-claude-run", "Recorded {} (placeholder)."],
  // A replay presented as Claude reading the slips (§6; J1 labels them "Seed stand-in, not a Claude recording").
  [
    "replay-as-claude-reading",
    "Claude's reading of them replays now; each photo ticks once its slips are read.",
  ],
  [
    "replay-as-claude-reading",
    "Photo B waits on the desk. Claude's reading replays once the invoice is paid.",
  ],
  ["replay-as-claude-reading", "Claude’s reading of the slips is replayed, sped up."],
  ["replay-as-claude-reading", "A replay of Claude's reading."],
  ["replay-as-claude-reading", "Replays Claude's reading of the slips."],
  [
    "replay-as-claude-reading",
    "12 photos in Jessie's block capitals. Claude reads them once the money is in.",
  ],
  ["replay-as-claude-reading", "Claude reads the slips."],
  ["replay-as-claude-reading", "Claude reads the handwritten weigh slips twice."],
  ["replay-as-claude-reading", "Claude's handwritten slip reading replays now."],
  ["replay-as-claude-reading", "The replay of Claude reading the slips."],
  ["replay-as-claude-reading", "Claude reads the 12 photos."],
  ["replay-as-claude-reading", "Claude reads photo B."],
  ["replay-as-claude-reading", "Claude reads {count} slips."],
  ["replay-as-claude-reading", "Claude reads it once the money is in."],
  // The seed stand-in shown as Claude reading now, or as what Claude read (ws/console reading/model.ts:417, :437,
  // :443; byhand/copy.ts:7, :9, :11; reading/copy.ts:62, :65; ratecard/copy.ts:7).
  ["replay-as-claude-reading", "Photo C waits its turn. Claude is reading photo B."],
  ["replay-as-claude-reading", "Claude is reading the slips."],
  ["replay-as-claude-reading", "Claude is now reading photo B."],
  ["replay-as-claude-reading", "Claude was reading photo B when the connection dropped."],
  ["replay-as-claude-reading", "Claude read the slips twice."],
  // Provenance footers also claim what Claude read (ratecard/copy.ts:10-11, describe.ts:274, provenance.ts:39).
  ["replay-as-claude-reading", "Read by Claude (claude-opus-5-5)"],
  [
    "replay-as-claude-reading",
    "A water stain covers one digit of the gross weight. Claude read {reading} ({score}).",
  ],
  [
    "replay-as-claude-reading",
    "Claude read these rules from its pages; the Secretary and the Chair signed them.",
  ],
  ["replay-as-claude-reading", "Claude read them twice."],
  ["replay-as-claude-reading", "Slip 0462, Lito. Claude wasn't sure of the gross weight and read {reading}."],
  ["replay-as-claude-reading", "Slip 0462 needs a person to confirm what Claude wasn’t sure of."],
  ["replay-as-claude-reading", "Claude was not sure of the tare."],
  ["replay-as-claude-reading", "Slip 0462 needs nothing by hand: Claude's two reads agreed on every field."],
  [
    "replay-as-claude-reading",
    "The two readings were {display}; Claude's zoom read {value}, which agrees with one of them.",
  ],
  ["replay-as-claude-reading", "Confirm {value} on slip 0462, as Claude’s zoom read it"],
  ["replay-as-claude-reading", "Slip 0462: Claude's zoom read agrees with one of the two readings."],
  // A negation lets these rules through only when it sits just before the phrase, in the same clause.
  ["live-payouts", "No fees, and live payouts land on members' phones."],
  ["live-payouts", "There is no doubt we make live payouts."],
  ["certified", "Certified by Fairtrade."],
  ["certified", "Not a pilot: certified by Fairtrade."],
  ["production-ready", "Not a demo: production-ready payroll for co-ops."],
  ["production-ready", "Fair Split is production-ready."],
  ["pr107-merged", "PR #107 was merged upstream."],
  ["pr107-merged", "Not a fork: PayPal merged PR #107."],
  ["real-farmers", "Real farmers in Davao use it."],
  ["real-farmers", "Not a mock-up: real farmers use it every season."],
  // The product AI_NOTE in each language the statement speaks (apps/api templates.ts, the app's _shims/seed.ts).
  ["read-twice-by-ai-seeded", "Your slips were read twice by an AI."],
  ["read-twice-by-ai-seeded", "Ang inyong mga resibo gibasa sa makaduha sa AI (Claude)."],
  ["read-twice-by-ai-seeded", "Binasa nang makalawa ng AI (Claude) ang inyong mga resibo."],
  ["read-twice-by-ai-seeded", "Dalawang beses binasa ng AI (Claude) ang inyong mga resibo."],
  // The console's footer on the replayed rows says the same (ws/console reading/copy.ts:37).
  ["read-twice-by-ai-seeded", "Read twice by Claude"],
  ["read-twice-by-ai-seeded", "Each slip was read twice by Claude."],
  // A verified signature beside PayPal or a webhook (§6 film 0:00 "…SUCCEEDED, signature verified"; MM-1).
  ["webhook-verified-says-simulated", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED, signature verified by PayPal."],
  ["webhook-verified-says-simulated", "Webhook, signature verified"],
  ["webhook-verified-says-simulated", "PayPal's signature-verified webhook marks the item paid."],
  ["webhook-verified-says-simulated", "Within 100 ms of the verified webhook, the statement turns."],
  ["webhook-verified-says-simulated", "Verified item webhooks flip statements."],
  ["webhook-verified-says-simulated", "Each verified PayPal webhook is stored."],
];

/** Template literals with dates, models and other placeholders (the scanner reads each substitution as "{}"). */
export const PLANTED_TEMPLATES: readonly (readonly [rule: string, source: string])[] = [
  ["replay-as-claude-reading", "export const footer = `Read by Claude (claude-opus-5-5)`;"],
  [
    "replay-as-claude-reading",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source code with a template literal
    "export const footer = (model: string) => `Read by Claude (${model})`;",
  ],
  [
    "recorded-claude-run",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source code with a template literal
    "export const draftNote = (recorded: string) => `Claude wrote the line labels in the recorded ${recorded} run.`;",
  ],
  [
    "recorded-claude-run",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source code with a template literal
    "export const note = (d: string) => `Slip reading replays a recorded ${d} Claude run.`;",
  ],
  [
    "replay-of-dated-run",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source code with a template literal
    "export const label = (read: string, on: string) => `${read}, replay of the ${format.dateShort(on)} run`;",
  ],
  [
    "replay-of-dated-run",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source code with a template literal
    "export const rows = (recorded: string) => [`invoiceEqualsQuote, replay of the ${recorded} run`];",
  ],
  [
    "replay-as-claude-reading",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source code with a template literal
    "export const deskNote = (count: number) => `${count} photos, four slips each. Claude reads them once the money is in.`;",
  ],
  [
    "replay-as-claude-reading",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source code with a template literal
    "export const status = (id: string, p: string) => `Photo ${id} waits its turn. Claude is reading photo ${p}.`;",
  ],
  [
    "replay-as-claude-reading",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source code with a template literal
    "export const prompt = (serial: string, reading: string) => `Slip ${serial}. A water stain covers one digit. Claude read ${reading}.`;",
  ],
  [
    "replay-as-claude-reading",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source code with a template literal
    "export const confirmReads = (d: string, v: string) => `The two readings were ${d}; Claude's zoom read ${v}, which agrees with one of them.`;",
  ],
  [
    "recorded-claude-run",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source code with a template literal
    "export const label = (on: string) => `Replay, recorded ${on} (placeholder)`;",
  ],
];

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
  "webhook-verified-says-simulated": [
    "Simulator-signed, signature verified.",
    "Simulated PayPal sandbox, webhook, simulator-signed, signature verified",
    "Webhook, signature checked (simulator)",
    "The simulator's signed webhooks are verified and recorded.",
    "Both signatures verify over the batch hash.",
    "The treasurer's signature verified against her registered key.",
  ],
  "pr107-evidence": ["Our typed Payouts tool, built on PR #107's schemas."],
  "pr107-merged": [
    "Claude Code agents wrote, reviewed and merged the code.",
    "Our typed Payouts tool follows PR #107's names.",
    "Our typed Payouts tool, built on PR #107's schemas, which is not merged upstream.",
    "PR #107 has not yet been merged.",
    "PR #107 was never merged.",
    "PR #107 isn’t merged.",
  ],
  "live-payouts": [
    "Payouts run on the simulated PayPal sandbox.",
    "Claude's live reads were last run on 22 Oct.",
    "We make no live payouts.",
    "No live payouts: every payout runs on the simulated PayPal sandbox.",
    "There are never live payouts in this build.",
  ],
  "recorded-claude-run": [
    "Line labels: a placeholder written with the seed (no Claude recording in this build).",
    "Placeholder, seed-written (not a Claude recording).",
    "Recorded by the co-op, {time}.",
    "Cash received at the bodega, recorded {time}.",
    "The payment was recorded, then the invoice read back as paid.",
    "A labelled replay of the step; the cash was recorded on 29 Oct.",
    "The README was recorded by Claude Code agents in the run log.",
    "Replays from the same seed stand-in, labelled.",
  ],
  "replay-of-dated-run": [
    "Reading 12 photos. Replay of a labelled seed stand-in.",
    "MM-2: replay of a seed stand-in.",
    "Replay of the {date} run, a labelled seed stand-in.",
    "A labelled replay of the step, never a refusal.",
  ],
  "replay-as-claude-reading": [
    "The seeded stand-in replays now; each photo ticks once its slips are read.",
    "We built to have Claude read every slip twice.",
    "Claude is built to read the slips; this replay is a labelled stand-in.",
    "In a live run, Claude reads the slips twice.",
    "Claude reads them in a live run; here the slips replay a labelled stand-in.",
    "Claude's live reads were last run on 22 Oct on code-drawn test slips.",
    "Judge Mode replays a labelled seed stand-in for the slip reading; Claude's live reads were last run on 22 Oct.",
    "Claude reads nothing live; a labelled stand-in plays.",
    "Claude is built to read photo B twice.",
    "In a live run, Claude is reading photo B while photo C waits its turn.",
    "In a live run, Claude's two reads agree on every field.",
    "In a live run, Claude read {reading}; here the slip is a labelled stand-in.",
    "The two readings agreed on every field.",
    "Slip 0462 needs a person to confirm the unsure digit.",
    "Claude Code is reading the repository.",
    "Claude Code read the ADRs and wrote the lint.",
    "The README was read by Claude Code agents.",
    "Read by Claude Code agents",
    "In a live run, read by Claude",
    "Read by the clerk, entered by hand.",
    "Claude readiness is the operator's read here.",
  ],
  "claudes-draft": [
    "Make the invoice draft overcharge Lantern Bay.",
    "Placeholder draft (seed-written), checked by the live policy lattice.",
    "Seed-written draft, created through PayPal’s Agent Toolkit on the simulated PayPal sandbox.",
    "The audit agent is paused; the invoice draft is seed-written.",
    "Claude Code agents drafted, reviewed and merged the code.",
    "The README was drafted by Claude Code agents.",
    "A Claude Code agent drafted this ADR.",
    "Draft a proposal for the rate card.",
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
    "Niini nga demo, ang mga basa sa resibo puli nga may label para sa makaduha nga pagbasa ni Claude; ang mga basa nga dili sigurado gisusi sa tawo.",
    "Sa demo na ito, ang mga basa sa resibo ay pamalit na may label para sa makalawang pagbasa ni Claude; sinuri ng tao ang mga basang hindi tiyak.",
    "The ADRs were read twice by Claude Code agents.",
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
  certified: [
    "Fairtrade's Standard for Cocoa requires per-member premium receipts.",
    "Not certified by Fairtrade.",
    "Nothing here is certified by anyone.",
    "Fair Split isn't certified.",
    "The co-op's premiums aren't certified by an auditor.",
  ],
  "eudr-compliant": ["Plot coordinates are shared with Lantern Bay under the data-sharing agreement."],
  "real-farmers": [
    "A prototype on a simulated PayPal sandbox, with synthetic people: no real farmer was paid.",
    "No real farmers were paid.",
    "Real farmers are not involved; every person is synthetic.",
    "Never real farmers: every person is synthetic.",
  ],
  "production-ready": [
    "In production to the Philippines, 2% = {production}.",
    "Fair Split is not production-ready; it is a hackathon prototype.",
    "It isn't yet production-ready.",
    "This is never production-ready code.",
  ],
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
  "Reading 12 photos. Replay of a labelled seed stand-in.",
  "Confirmed by the simulated PayPal sandbox on {date}.",
  "Sends {n} payouts through the simulated PayPal sandbox. No real money moves.",
  "A status check confirms each item (simulated).",
  "In this demo, the slip readings are a labelled stand-in for Claude's double reading; a person checked the unsure ones, and Treasurer {{TREASURER}} approved this pay.",
  "Simulator-signed, signature verified.",
  "Simulated PayPal sandbox, webhook, simulator-signed, signature verified",
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
