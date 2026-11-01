// Public Proof verification. No cookie jar, bearer token, environment credential or redirect.
// The six checks and signed-checkpoint gate are the domain verifier used by the Proof page.
import { ProofResponse, PublishedKeys } from "@fairsplit/contracts";
import { verifyChain } from "@fairsplit/domain";
import { isMain } from "../apps/tasks/src/main.js";

export function proofUrls(input: string): { bundle: string; keys: string; runSlug: string } {
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
    runSlug,
  };
}

export interface VerifyProofDeps {
  fetch?: typeof globalThis.fetch;
  print?: (line: string) => void;
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
    const { bundle, provenance, redacted } = parsed.data;
    if (bundle.runSlug !== urls.runSlug) throw new Error("The returned Proof belongs to another run.");
    const keys = PublishedKeys.safeParse(await readJson(fetcher, urls.keys, "Published keys"));
    if (!keys.success) throw new Error("Published keys response does not match the PublishedKeys contract.");
    const result = verifyChain(bundle, keys.data, { demoMode: true });
    print(`Simulated PayPal sandbox; provenance: ${provenance}.`);
    if (result.sampleKeys.length > 0) print("Sample: seeded or demo signing keys; never live verification.");
    const labels = {
      paid: "Invoice reference and payment",
      ratified: "Rate card hash and ratification",
      read: "Photo hashes in the ledger",
      computed: "Line hashes, conservation and linesDigest",
      twoKeys: "Officer signatures against published keys",
      payoutItems: "Payout items and batchSha256",
    } as const;
    for (const [name, label] of Object.entries(labels)) {
      const plate = result.plates[name as keyof typeof labels];
      print(`${label}: ${plate.ok ? "Matches" : (plate.reason ?? "Mismatch")}`);
    }
    if (!result.chain.ok)
      print(`Ledger chain: mismatch at sequence ${result.chain.brokenAtSeq ?? "unknown"}.`);
    if (!result.checkpoint.ok) print(`Signed checkpoint: ${result.checkpoint.reason ?? "Mismatch"}`);
    if (redacted)
      print(
        "Public receivers are withheld; batchSha256 cannot be independently recomputed from this response.",
      );
    const matches =
      result.chain.ok && result.checkpoint.ok && Object.values(result.plates).every((p) => p.ok);
    return matches ? 0 : 1;
  } catch (error) {
    print(error instanceof Error ? error.message : "Proof verification failed.");
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = await runVerifyProof(process.argv.slice(2));
