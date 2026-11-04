// S2: the Devpost text, rendered from IC-03 (packages/seed's snapshot) and the film script (video/script.ts).
//
//   corepack pnpm exec tsx tools/devpost-text.ts           # writes docs/devpost.md
//   corepack pnpm exec tsx tools/devpost-text.ts --check   # exit 1 if docs/devpost.md differs from a fresh render
//
// Every season figure and count comes from the snapshot, and the disclosures from the script, so the text cannot
// drift from them: apps/tasks/test/devpost-text.test.ts regenerates the file and compares. The words follow
// replan-1031 §6 and ADR-0002/0010: PayPal runs only on our simulator, the judge path replays a labelled seed
// stand-in for the slip reading, the audit agent is paused. E-19 (packages/test-kit) lints the result.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SeasonSnapshot } from "@fairsplit/contracts";
import { getSnapshot } from "@fairsplit/seed";
import { isMain } from "../apps/tasks/src/main.js";
import { REPO_ROOT } from "./lib/blueprint.js";

export const PROJECT_NAME = "Fair Split: audited co-op payroll on PayPal";
export const DEVPOST_PATH = "docs/devpost.md";
export const REPO_URL = "https://github.com/GODOSTROYER/fair-split";

/** Devpost's "Built with": 25 tags (the form's maximum), each a tool this build ships with. */
export const TAGS = [
  "paypal",
  "paypal-invoicing",
  "paypal-payouts",
  "paypal-webhooks",
  "paypal-agent-toolkit",
  "anthropic",
  "claude",
  "claude-code",
  "typescript",
  "node.js",
  "hono",
  "postgresql",
  "drizzle-orm",
  "vite",
  "react",
  "tanstack-router",
  "tailwindcss",
  "ag-grid",
  "expo",
  "react-native",
  "zod",
  "vitest",
  "playwright",
  "gemini-tts",
  "openai-image-generation",
] as const;

/**
 * Tags the plan named or a reader might expect that this build does not ship: never Next.js or AG Studio
 * (register §10), and §6 drops postman, render, maestro and apimatic unless shipped. The Server SDK is used
 * only in the simulator's tests.
 */
export const EXCLUDED_TAGS = [
  "nextjs",
  "ag-studio",
  "apimatic",
  "postman",
  "render",
  "maestro",
  "paypal-server-sdk",
  "kokoro",
] as const;

/** What the film script contributes: its disclosures, word for word. */
export interface FilmDisclosures {
  readonly descriptionDisclosure: string;
}

export interface DevpostInput {
  readonly snapshot: SeasonSnapshot;
  readonly film: FilmDisclosures;
}

/**
 * The film script's disclosures. video/ (WS-MEDIA) has no package.json, so TypeScript would read the script as
 * CommonJS: it is loaded at run time, as E-19 loads it, and its one field checked here.
 */
export async function loadFilm(
  url: URL = new URL("../video/script.ts", import.meta.url),
): Promise<FilmDisclosures> {
  const mod = (await import(url.href)) as { FILM?: { descriptionDisclosure?: unknown } };
  const disclosure = mod.FILM?.descriptionDisclosure;
  if (typeof disclosure !== "string" || disclosure.trim() === "")
    throw new Error("video/script.ts exports no FILM.descriptionDisclosure");
  return { descriptionDisclosure: disclosure };
}

/** IC-03's snapshot (validated by @fairsplit/seed) and the film script's disclosures. */
export async function loadInput(): Promise<DevpostInput> {
  return { snapshot: getSnapshot(), film: await loadFilm() };
}

const usd = (cents: number): string => {
  const dollars = cents / 100;
  return `US$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
};

/** The season's facts, every one read from the snapshot. */
function facts(s: SeasonSnapshot) {
  const f = s.figures;
  const d = f.display;
  const hold = (label: string): string => {
    const h = s.holds.find((x) => x.label === label);
    if (!h?.engineLine) throw new Error(`IC-03 has no ${label} hold`);
    return h.engineLine;
  };
  const hero = s.checkpoints.resolved.lines.find((l) => l.memberNo === "M-014");
  const heroMember = s.members.find((m) => m.memberNo === "M-014");
  const rhea = s.members.find((m) => m.memberNo === "M-031");
  if (!hero || !heroMember || !rhea) throw new Error("IC-03 hero members are missing");
  const replay = new Set(s.photos.filter((p) => p.set === "REPLAY").map((p) => p.photoId));
  return {
    d,
    members: f.members,
    paid: f.endPaidMembers,
    cash: f.endCashMembers,
    items: f.batchItemCount,
    slipImages: f.slipImages,
    photos: f.photos,
    replayPhotos: replay.size,
    replaySlips: s.slips.filter((x) => replay.has(x.photoId)).length,
    coop: s.coop.name,
    locality: s.coop.locality,
    payer: s.payer.name,
    payerShort: s.payer.shortName,
    payerCity: s.payer.city,
    lot: s.lot.lotCode,
    season: s.season.label,
    rateCard: s.rateCard.canonical.resolutionNo,
    cosign: usd(s.rateCard.canonical.rules.cosign.batchOverCents),
    h1: hold("H1"),
    h2: hold("H2"),
    h3: hold("H3"),
    hero: {
      name: heroMember.consoleName,
      premium: usd(hero.premiumCents),
      bonus: usd(hero.bonusCents),
      deductions: usd(hero.deductionsCents),
      net: usd(hero.netCents),
    },
    rhea: rhea.displayName.split(" ")[0] ?? rhea.displayName,
  };
}

export interface DevpostSections {
  readonly name: string;
  readonly pitch: string;
  /** The first 300 characters: the story's opening paragraph, and the YouTube description's (F6). */
  readonly opening: string;
  readonly story: string;
  readonly tags: string;
  readonly tryIt: string;
  readonly sponsors: string;
  readonly prize: string;
  readonly aiTools: string;
  readonly testing: string;
  readonly disclosures: string;
}

const lines = (...xs: readonly string[]): string => xs.join("\n");

/**
 * A markdown table with its columns padded the way the repo's formatter (Biome) writes them, so the generated
 * file passes `biome ci` unchanged. Paragraphs run straight into the lists that follow them for the same reason.
 */
function table(rows: readonly (readonly string[])[]): string[] {
  const width = (s: string) => [...s].length;
  const cols = Math.max(...rows.map((r) => r.length));
  const w = Array.from({ length: cols }, (_, i) => Math.max(3, ...rows.map((r) => width(r[i] ?? ""))));
  const row = (r: readonly string[]) =>
    `| ${w.map((n, i) => `${r[i] ?? ""}${" ".repeat(n - width(r[i] ?? ""))}`).join(" | ")} |`;
  const [head = [], ...body] = rows;
  return [row(head), `| ${w.map((n) => "-".repeat(n)).join(" | ")} |`, ...body.map(row)];
}

export function devpostSections(input: DevpostInput): DevpostSections {
  const x = facts(input.snapshot);
  const { d } = x;

  const pitch =
    "Co-op payroll from handwritten slips: Claude is built to read them, code audits every line, two officers sign, and PayPal Payouts (simulated sandbox) pays members on PayPal; the rest get cash.";

  const opening = `Fair Split: co-op payroll. claude-opus-5-5 is built to read a cacao co-op's handwritten slips, claude-sonnet-5-5 to check deductions, claude-haiku-5-5 to screen text. Invoicing v2 (Agent Toolkit 1.11.0), Payouts v1 and Webhooks run on a simulated PayPal sandbox; ${x.paid} of ${x.members} paid there, ${x.cash} in cash.`;

  const story = lines(
    opening,
    "",
    `**The PayPal rail is a simulator.** PayPal runs only on our own contract-faithful simulator of PayPal's REST APIs, labelled "Simulated PayPal sandbox" wherever a PayPal value appears: the developer is in India and could not open the US PayPal accounts the sandbox needs. The PayPal client code is real (PayPal's Agent Toolkit 1.11.0 for Invoicing), but it is untested against PayPal's own sandbox. Every person, slip and document is synthetic, and no real money moves.`,
    "",
    "### Inspiration",
    "",
    `A cacao co-op's season of pay starts on paper. A clerk writes a weigh-slip for every delivery; months later one buyer pays one premium for the whole lot, and the treasurer splits it across dozens of members by hand. Most members cannot check their share, and the buyer cannot show that the premium reached them. Fairtrade's cocoa standard already asks producer organisations in Côte d'Ivoire and Ghana to give each member a receipt for the premium paid (requirement 4.3.4) and to record those payments digitally (4.3.5). In the Philippines, half of adults owned a formal financial account in 2025 (BSP, Consumer Finance and Inclusion Survey), so a payroll tool for a co-op there has to serve cash members as well as PayPal members.`,
    "",
    "### What it does",
    "",
    `Fair Split is built around one synthetic season: ${x.coop} (${x.locality}; ${x.members} members) and its buyer, ${x.payer} of ${x.payerCity}. The model reads paper; code computes; people approve; PayPal executes, here on the simulator.`,
    `1. **Rules before facts.** The co-op's rate card (${x.rateCard}) is ratified and hashed before the first slip. Editing it later is refused, citing the hash.`,
    `2. **Fund.** ${x.payerShort} pays one invoice of ${d.invoice}: premium ${d.premiumPool}, quality bonus ${d.bonusPool} and disbursement costs ${d.disbursement}. Code computes the quote; the invoice is created and sent through PayPal's Agent Toolkit 1.11.0 on the simulated PayPal sandbox, with an AUTO_CANCEL rule, and the run is funded only when a fresh GET reads it paid. The invoice's line labels are a placeholder written with the seed: the audit agent that was meant to draft them is paused.`,
    `3. **Read.** Claude is built to read every slip twice and send anything unsure to a person. In Judge Mode the ${x.replaySlips} slips in ${x.replayPhotos} photos replay a labelled seed stand-in, not a Claude recording. Separately, R1 (a live run on 1 Nov 2026) put Claude on the 10 synthetic hero slips; its results are under Accomplishments.`,
    `4. **Compute and hold.** A deterministic engine computes all ${x.members} lines in integer cents and holds what it cannot justify:`,
    `   - H1: ${x.h1}`,
    `   - H2: ${x.h2}`,
    `   - H3: ${x.h3}`,
    "   - Slip 0462's stained digit is typed by a person, from the logbook.",
    `5. **Approve.** The treasurer and the Chair each sign one batch hash with an Ed25519 key; any batch over ${x.cosign} needs the Chair. Change one payout after both keys and the Payouts tool re-hashes the batch, refuses the change and voids both approvals.`,
    `6. **Pay.** Our typed Payouts tool posts ${x.items} items (${d.batchTotal}) to the simulated PayPal sandbox. Status checks and the simulator's signed webhooks confirm each item. ${x.rhea} has no PayPal account, so her item parks UNCLAIMED and is cancelled, and she is paid in cash. End state: ${x.paid} of ${x.members} members paid through the simulated PayPal sandbox (${d.endPaid}) and ${x.cash} in cash (${d.endCash}), on the same kind of statement; ${d.redirected} kept for members.`,
    `7. **Explain and prove.** A member's statement explains her number down to her slips, in Cebuano, Filipino or English, from hand-written templates (the model writes no statement). ${x.hero.name}'s line: premium ${x.hero.premium}, quality bonus ${x.hero.bonus}, CBU ${x.hero.deductions}, net ${x.hero.net}. Sentences with a verified Gemini TTS clip can be heard; the rest use the phone's own voice, labelled. ${x.payerShort} opens Proof and re-checks the rate card hash, both signatures, every line and the ledger's hash chain in its own browser.`,
    "",
    "### How we built it",
    "",
    "- **One origin.** A TypeScript monorepo on Node 24. fs-api (Hono, Postgres through Drizzle, server-sent events) serves the treasurer's console and Judge stage (Vite, React, TanStack Router, AG Grid Community 36.2.0), the Expo app's web export at /app, and the public Proof page.",
    "- **Code decides money.** `packages/domain` computes every line in integer cents (largest-remainder pool shares) and a policy lattice compares the whole invoice body with the engine's quote before any PayPal call. The model never writes a number into a line, invoice, payout or statement.",
    "- **Effects through an outbox.** Every PayPal call is enqueued in the same Postgres transaction as the state change that asks for it. Every event lands in a hash-chained ledger with Ed25519-signed checkpoints, which Proof verifies.",
    "- **PayPal.** Invoicing v2 runs through `@paypal/agent-toolkit` 1.11.0 (create, send, AUTO_CANCEL rule, record payment, GET). The toolkit has no Payouts tool, so we wrote a typed one, built on PR #107's schemas, with `PayPal-Request-Id` idempotency and re-hash checks. Webhooks are verified offline (CRC32 of the raw body plus RSA-SHA256 against the signing certificate), deduplicated by transmission id, and stored with their delivery evidence.",
    "- **The simulator.** `packages/paypal-sim` implements the REST subset we use (OAuth, Invoicing v2, Payouts v1, Webhooks v1) and validates every request and response against PayPal's published OpenAPI specs. It runs inside fs-api's process and intercepts the toolkit's HTTP calls, so the client code is unchanged; its resource IDs carry SIM and its debug IDs start with sim-.",
    "- **AI.** One ClaudeGateway is the only Anthropic SDK import. It keys a replay cache on sha256 of the image, variant, prompt version, schema version, model and effort, enforces per-lane spend caps and a kill switch, and sends any stop other than end_turn to a person.",
    "- **Tests.** Unit, property (fast-check) and embedded-Postgres integration suites across the packages, a smoke test that boots fs-api and walks every route, and a Playwright suite for the judge loop and the phone co-sign.",
    "- **Who wrote it.** Claude Code agents wrote, reviewed and merged the code under an automated review-and-verify protocol, and OpenAI's Codex CLI built some work packages from written briefs; the user approved every outward step.",
    "",
    "### Challenges we ran into",
    "",
    "- **No PayPal accounts.** Without US accounts we could not get sandbox credentials, so we built a strict simulator and kept PayPal's own client code. The integration is untested against PayPal's own sandbox, and we say so on every PayPal value.",
    "- **The toolkit's own HTTP client.** The Agent Toolkit sends its calls through its own axios instance, so a simulator in a separate service could not catch them. The simulator runs in fs-api's process and intercepts node:http, node:https and fetch.",
    "- **Signed webhooks from a simulator.** PayPal's verifier rightly refuses a certificate that is not PayPal's, so the simulator signs with its own certificate authority, which is trusted only in simulator mode.",
    "- **Honest copy.** A lint (E-19) reads this text, the README, the film script and every UI catalog, and fails when 'sandbox' or 'live' appears without 'simulated', on claims we cannot back, and on any money or kilo figure the seed does not hold.",
    "- **Audio on a free tier.** Each Cebuano, Filipino and English clip is transcribed back and compared with its exact sentence before it is published; a sentence without a verified clip is spoken by the phone, labelled.",
    "",
    "### Accomplishments that we're proud of",
    "",
    "- The judge loop runs end to end with no login: fund, read, hold, two keys, pay, Proof, reset.",
    "- A change to one payout after both keys is refused in view of the judge, and both approvals are voided.",
    "- Proof re-verifies in the buyer's browser against published keys, for PayPal and cash lines alike.",
    `- ${x.rhea}'s unclaimed item moves to cash on the same statement, so a member without PayPal is not left out.`,
    "- R1, the only real Claude output in the repo: on 1 Nov 2026 claude-opus-5-5 (reads and zoom) and claude-haiku-5-5 (injection screen) ran live on the 10 synthetic hero slips. N = 10 scored slips: 10 of 10 rows exact against provisional, agent-checked labels, 0 unsafe auto-accepts, and the two stained 0462 fields were sent to a person. The labels are not person-reviewed, N is small, and a single read scored the same on this sample.",
    "",
    "### What we learned",
    "",
    "- Putting the model only where paper becomes data, and code wherever money is decided, made every claim testable.",
    "- Honest labels need machinery: provenance on every row (live, replay, simulated rail, seeded) and a lint on every public sentence.",
    "- A simulator is only worth having if it is strict, so ours checks every request and response against PayPal's published specs.",
    "",
    `### What's next for ${PROJECT_NAME}`,
    "",
    "- Run the same code against PayPal's own sandbox (`PP_MODE=sandbox`); it is untested today.",
    "- Person-reviewed labels and a larger, held-out set of slips for the eval.",
    "- Native-speaker review of the Cebuano and Filipino text, which is machine-translated today.",
    "- A pilot co-op: there is no pilot partner yet.",
    "- The business model: the buyer pays a per-run audit fee. The co-op stays merchant of record, and Fair Split never holds funds.",
    "- Production onboarding, where PayPal must grant third-party permissions for Invoicing and Payouts.",
    "",
    "### What's real, replayed and simulated",
    "",
    "- **Real:** the presses, holds and approvals in a session; every amount, computed in integer cents; the rate card hash; Proof's checks in the browser; R1's committed Claude responses.",
    `- **Replayed:** the slip reading in Judge Mode (a labelled seed stand-in). If the hour's quota of payout runs is spent, the payout steps replay an earlier simulated run, labelled as a replay.`,
    "- **Simulated:** every PayPal call, ID, status, webhook and fee (the simulated PayPal sandbox), the phone's push banners and the clerk's scanner.",
    `- **Synthetic:** the co-op, its ${x.members} members, the buyer, the ${x.slipImages} slip images in ${x.photos} photos, the documents and the voices.`,
    "",
    "### Limits",
    "",
    `- Fees on screen are the simulator's (${d.feesSandbox}, PayPal's published US rate). In production a Philippine co-op pays PayPal PH's fees: receiving 4.40% + US$0.30, payouts 2% capped at ₱50 each (${d.feesProduction} on this batch), conversion 3.0%.`,
    "- No APK is built yet; the app runs as a web export in the stage's phone frames and in a phone's browser.",
    "- Push notifications, the clerk's offline capture, iOS and the audit agent are not part of this build.",
  );

  const tags = TAGS.join(", ");

  const tryIt = lines(
    "- **TODO (merger): hosted Judge Mode URL (`/judge` on the Render host), once it is deployed.**",
    `- Source code: ${REPO_URL} (MIT; public from submission).`,
    "- **TODO (merger): Android APK link and its SHA-256, only if an APK ships.**",
  );

  const sponsors = lines(
    "- **PayPal:** Invoicing v2 through Agent Toolkit 1.11.0, Payouts v1 through our typed tool, and Webhooks v1, all on a simulated PayPal sandbox that is contract-tested against PayPal's OpenAPI specs.",
    "- **AG Grid:** AG Grid Community 36.2.0 for the treasurer's split review: themed from our design tokens in both colour modes, eleven custom cell renderers, and a jade wash only when a PayPal status changed (pencil when the engine recomputed a line).",
  );

  const prize = lines(
    "**Most Impactful.**",
    "",
    `Fair Split protects the people being paid, not the payer. In the demo season ${x.cash} of ${x.members} members are paid in cash and ${x.paid} through the simulated PayPal sandbox, and each gets a statement that explains the number down to the slip, in Cebuano, Filipino or English, with audio where a verified clip exists. The buyer can re-check every line in its own browser, so a premium can be shown to reach the members. Similar entries, such as Supplora Pay, Clause-to-Cash and Tributary, protect a payer or a contract's parties.`,
  );

  const aiTools = lines(
    ...table([
      ["Tool", "How it is used", "Where it ran"],
      [
        "claude-opus-5-5",
        "Slip reads A and B, a zoom re-read of one field, the rate-card reader (`packages/ai`)",
        "Reads and zoom live in R1 (1 Nov 2026, the 10 hero slips) and in development; Judge Mode replays a labelled seed stand-in",
      ],
      [
        "claude-sonnet-5-5",
        "The deduction classifier: each deduction gets a ratified rule ID or NO_MATCH, and code checks the amount",
        "Built and unit-tested; not on the judge path",
      ],
      ["claude-haiku-5-5", "The injection screen: text on a slip is never an instruction", "Live in R1"],
      [
        "Claude Code (Opus 5.5)",
        "Research, planning, code, review and merges, under an automated review-and-verify protocol",
        "Development",
      ],
      ["OpenAI Codex CLI", "Built some work packages from written briefs", "Development"],
      [
        "OpenAI's image model (gpt-image-2) via Codex CLI",
        "The 10 synthetic hero slips, the 2 rate-card pages, the logbook page and one four-slip test photo",
        "Offline; prompts and hashes in `media/manifest.json`",
      ],
      ["Gemini 3.8 Flash TTS", "Member statement audio, labelled as a synthetic voice", "Offline"],
      [
        "Gemini 3.8 Flash",
        "Speech recognition that checks each clip against its exact sentence before it is published",
        "Offline",
      ],
    ]),
    "",
    "Member statements are hand-written templates, not model output. The audit agent is paused, and no model drafted the invoice.",
  );

  const testing = lines(
    "No login: open Judge Mode. Local: pnpm i && pnpm verify.",
    `- **Judge Mode:** open \`/judge\` on the hosted URL (Try it out) in a window at least 1024 px wide. No account, PayPal login or key is needed. "Play it for me" drives every step except the two keys; Reset starts a fresh run in about 10 seconds.`,
    "- **Local, keyless:** with Node 24.19 or newer and Git, `corepack pnpm i && corepack pnpm verify` clones the committed tree and runs install, typecheck, lint, the dependency rules, every test suite and the build, with every key removed from the environment.",
    "- **Drive it yourself:** `corepack pnpm --filter @fairsplit/e2e stack` starts embedded Postgres and fs-api with the in-process simulator, and prints the local `/judge` URL.",
    "- **Check a Proof page:** `corepack pnpm verify-proof <proof url>` re-runs the six checks from the command line.",
    "- PayPal is the simulator in all of these; no PayPal account is needed, and a real sandbox app is untested.",
  );

  const disclosures = lines(
    `The video's disclosure, from \`video/script.ts\`: "${input.film.descriptionDisclosure}"`,
    "",
    "All people, the co-op, the buyer, the slips and the documents are synthetic. Images carry a synthetic specimen label, and voices are labelled as Gemini TTS. No real farmer was paid.",
  );

  return {
    name: PROJECT_NAME,
    pitch,
    opening,
    story,
    tags,
    tryIt,
    sponsors,
    prize,
    aiTools,
    testing,
    disclosures,
  };
}

/** docs/devpost.md: one section per Devpost field, in the order the form asks for them. */
export function renderDevpost(input: DevpostInput): string {
  const s = devpostSections(input);
  return `${lines(
    `# ${s.name}`,
    "",
    "<!-- Generated by tools/devpost-text.ts from IC-03 (packages/seed) and video/script.ts. Do not edit by hand: run `corepack pnpm exec tsx tools/devpost-text.ts`. apps/tasks/test/devpost-text.test.ts fails on drift. -->",
    "",
    "Each section below is one Devpost field; paste it into the field of the same name.",
    "",
    "## Project name",
    "",
    s.name,
    "",
    "## Elevator pitch",
    "",
    s.pitch,
    "",
    "## About the project",
    "",
    s.story,
    "",
    "## Built with",
    "",
    s.tags,
    "",
    "## Try it out",
    "",
    s.tryIt,
    "",
    "## Sponsor tools",
    "",
    s.sponsors,
    "",
    "## Prize category",
    "",
    s.prize,
    "",
    "## AI tools used",
    "",
    s.aiTools,
    "",
    "## Testing instructions",
    "",
    s.testing,
    "",
    "## Synthetic content and disclosures",
    "",
    s.disclosures,
  )}\n`;
}

export interface DevpostDeps {
  input?: DevpostInput;
  read?: () => string | null;
  write?: (text: string) => void;
  print?: (line: string) => void;
}

/** `[--check]`: 0 written or up to date, 1 drifted (with --check), 2 usage. */
export async function main(argv: readonly string[], deps: DevpostDeps = {}): Promise<number> {
  const path = join(REPO_ROOT, DEVPOST_PATH);
  const read =
    deps.read ??
    (() => {
      try {
        return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
      } catch {
        return null;
      }
    });
  const write = deps.write ?? ((text: string) => writeFileSync(path, text));
  const print = deps.print ?? console.log;
  const unknown = argv.filter((a) => a !== "--check");
  if (unknown.length > 0) {
    print(`Unknown option ${unknown.join(" ")}. Usage: tsx tools/devpost-text.ts [--check]`);
    return 2;
  }
  const text = renderDevpost(deps.input ?? (await loadInput()));
  if (argv.includes("--check")) {
    if (read() === text) {
      print(`${DEVPOST_PATH} matches IC-03 and the script.`);
      return 0;
    }
    print(`${DEVPOST_PATH} drifted from IC-03 or the script: run tsx tools/devpost-text.ts and commit it.`);
    return 1;
  }
  write(text);
  print(`Wrote ${DEVPOST_PATH}.`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
