// Public Proof verification. No cookie jar, bearer token, environment credential or redirect.
// The six checks and signed-checkpoint gate are the domain verifier used by the Proof page.
import { ChainVerification, type PlateResult, ProofResponse, PublishedKeys } from "@fairsplit/contracts";
import { verifyChain } from "@fairsplit/domain";
import { isMain } from "../apps/tasks/src/main.js";

export function proofUrls(input: string): {
  bundle: string;
  keys: string;
  verification: string;
  runSlug: string;
} {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Expected an absolute HTTPS Proof URL or loopback HTTP Proof URL.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("Only HTTPS and loopback HTTP Proof URLs are allowed.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Use a public Proof URL without credentials, query parameters or a fragment.");
  }
  const match = /^\/(?:proof|v1\/proof)\/(\d{4}[A-Z]-r\d+)(?:\.json)?\/?$/.exec(url.pathname);
  const runSlug = match?.[1];
  if (!runSlug) throw new Error("Expected /proof/:runSlug or /v1/proof/:runSlug.json.");
  return {
    bundle: `${url.origin}/v1/proof/${runSlug}.json`,
    keys: `${url.origin}/.well-known/fairsplit-keys.json?run=${runSlug}`,
    verification: `${url.origin}/v1/proof/${runSlug}/verification`,
    runSlug,
  };
}

export interface VerifyProofDeps {
  fetch?: typeof globalThis.fetch;
  print?: (line: string) => void;
}

/** Replay is consistent evidence of a replay, never a sixth independent match. */
export function plateWords(plate: PlateResult, server: boolean): string {
  if (plate.state === "replay") return plate.reason ?? "Replayed, labelled";
  if (!plate.ok) return plate.reason ?? "Mismatch";
  return server
    ? "Matches (checked by the server: payout receivers are withheld on this Proof tier)"
    : "Matches";
}

export function proofSummary(
  validChain: boolean,
  plates: readonly PlateResult[],
): { accepted: boolean; text: string } {
  const accepted = validChain && plates.every((plate) => plate.ok);
  return {
    accepted,
    text: !accepted
      ? "Proof checks failed"
      : plates.some((plate) => plate.state === "replay")
        ? "five of six match; one replayed, labelled"
        : "Six of six match",
  };
}

async function readJson(fetcher: typeof globalThis.fetch, url: string, name: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      credentials: "omit",
      redirect: "error",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`${name} request failed (redirects are refused; timeout 15 seconds).`);
  }
  if (!response.ok) throw new Error(`${name} request failed: HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${name} response is not JSON.`);
  }
}

export async function runVerifyProof(argv: readonly string[], deps: VerifyProofDeps = {}): Promise<0 | 1> {
  const print = deps.print ?? console.log;
  const fetcher = deps.fetch ?? globalThis.fetch;
  try {
    if (argv.length !== 1) throw new Error("Usage: pnpm verify-proof <public Proof URL>");
    const urls = proofUrls(argv[0] ?? "");
    const raw = await readJson(fetcher, urls.bundle, "Proof");
    const parsed = ProofResponse.safeParse(raw);
    if (!parsed.success) throw new Error("Proof response does not match the ProofResponse contract.");
    const { bundle, provenance } = parsed.data;
    if (bundle.runSlug !== urls.runSlug) throw new Error("The returned Proof belongs to another run.");
    const keys = PublishedKeys.safeParse(await readJson(fetcher, urls.keys, "Published keys"));
    if (!keys.success) throw new Error("Published keys response does not match the PublishedKeys contract.");
    const result = verifyChain(bundle, keys.data, { demoMode: true });
    // Match the browser: inspect receivers themselves, including partially redacted member tiers.
    // Only plate 6 may use the server's full-record check; every other check stays independent.
    const withheld = bundle.batch.items.some((item) => item.receiver === "withheld");
    let payoutItems = result.plates.payoutItems;
    let serverChecks = 0;
    if (withheld) {
      try {
        const raw = await readJson(fetcher, urls.verification, "Server verification");
        if (
          !raw ||
          typeof raw !== "object" ||
          !("attestedBy" in raw) ||
          raw.attestedBy !== "fs-api" ||
          !("runSlug" in raw) ||
          raw.runSlug !== urls.runSlug
        ) {
          throw new Error("Server verification is not an fs-api attestation for this run.");
        }
        const server = ChainVerification.safeParse("verification" in raw ? raw.verification : undefined);
        if (!server.success) throw new Error("Server verification response does not match the contract.");
        payoutItems = server.data.plates.payoutItems;
        serverChecks = 1;
      } catch (error) {
        payoutItems = {
          ok: false,
          reason: error instanceof Error ? error.message : "Server verification failed.",
        };
      }
    }
    const plates = { ...result.plates, payoutItems };
    print(`Simulated PayPal sandbox; provenance: ${provenance}.`);
    const sample = result.sampleKeys.length > 0;
    if (sample)
      print(
        `Sample: Signed with sample keys (${result.sampleKeys.join(", ")}), so it reads Sample, never Verified.`,
      );
    const labels = {
      paid: "Invoice reference and payment",
      ratified: "Rate card hash and ratification",
      read: "Photo hashes in the ledger",
      computed: "Line hashes, conservation and linesDigest",
      twoKeys: "Officer signatures against published keys",
      payoutItems: "Payout items and batchSha256",
    } as const;
    for (const [name, label] of Object.entries(labels)) {
      const plate = plates[name as keyof typeof labels];
      print(`${label}: ${plateWords(plate, name === "payoutItems" && withheld)}`);
    }
    if (!result.chain.ok)
      print(`Ledger chain: mismatch at sequence ${result.chain.brokenAtSeq ?? "unknown"}.`);
    if (!result.checkpoint.ok) print(`Signed checkpoint: ${result.checkpoint.reason ?? "Mismatch"}`);
    const summary = proofSummary(result.chain.ok && result.checkpoint.ok, Object.values(plates));
    print(
      `${summary.text}${sample ? "; Sample, never Verified" : ""}. ${withheld ? 5 : 6} checked independently; ${serverChecks} checked by the server.`,
    );
    return summary.accepted ? 0 : 1;
  } catch (error) {
    print(error instanceof Error ? error.message : "Proof verification failed.");
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = await runVerifyProof(process.argv.slice(2));
