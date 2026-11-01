// The real CLI over loopback HTTP: five public checks plus the server's payout-items
// attestation, or six independent checks when the fixture includes every receiver.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import type { ChainVerification, ProofResponse } from "@fairsplit/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { loadShowcase, type ShowcaseWorld } from "../../proof/testing/world.js";
import { createTestApp, type TestApp } from "../../test/index.js";

type ProofBody = z.infer<typeof ProofResponse>;

describe("verify-proof against fs-api's in-process simulator harness", () => {
  let t: TestApp;
  let world: ShowcaseWorld;
  let full: ProofBody;
  let publicProof: ProofBody;
  let attestation: {
    runSlug: string;
    provenance: ProofBody["provenance"];
    attestedBy: "fs-api";
    demoMode: true;
    verification: ChainVerification;
  };

  beforeAll(async () => {
    t = await createTestApp({ db: "postgres" });
    world = await loadShowcase(t.deps.db, { kind: "judge" });
    const link = t.credentials.brandLink({ workspaceId: world.workspaceId });
    const response = await t.json<ProofBody>(`/v1/proof/${world.runSlug}.json`, {
      as: t.credentials.bearer(link),
    });
    expect(response.status).toBe(200);
    full = response.body;
    publicProof = (await t.json<ProofBody>(`/v1/proof/${world.runSlug}.json`)).body;
    attestation = (await t.json<typeof attestation>(`/v1/proof/${world.runSlug}/verification`)).body;
  });
  afterAll(async () => t?.close());

  // Only this test host can serve a captured full-tier fixture without credentials. With no
  // fixture it forwards the actual uncredentialed fs-api public routes, including redaction.
  async function cli(
    body?: ProofBody,
    options: { verification?: unknown; input?: string } = {},
  ): Promise<{ code: number | null; output: string; paths: string[] }> {
    const paths: string[] = [];
    const server = createServer(async (request, response) => {
      expect(request.headers.authorization).toBeUndefined();
      expect(request.headers.cookie).toBeUndefined();
      const url = new URL(request.url ?? "/", "http://localhost");
      paths.push(url.pathname);
      if (options.verification !== undefined && url.pathname.endsWith("/verification")) {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(options.verification));
        return;
      }
      if (body && url.pathname === `/v1/proof/${world.runSlug}.json`) {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(body));
        return;
      }
      const result = await t.request(`${url.pathname}${url.search}`);
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test host did not start");
      const url = `http://127.0.0.1:${address.port}/proof/${world.runSlug}`;
      return await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            fileURLToPath(new URL("../../../../../node_modules/tsx/dist/cli.mjs", import.meta.url)),
            fileURLToPath(new URL("../../../../../tools/verify-proof.ts", import.meta.url)),
            options.input ?? url,
          ],
          { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
        );
        let output = "";
        child.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, output, paths }));
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }

  it("inv.i8.sample: six Matches with labelled seeded simulator data", async () => {
    const result = await cli(full);
    expect(result.code, result.output).toBe(0);
    expect(result.output.match(/: Matches/g)).toHaveLength(6);
    expect(result.output).toContain("Simulated PayPal sandbox; provenance: seeded");
    expect(result.output).toContain("Sample:");
    expect(result.output).toContain("Six of six match");
    expect(result.output).toContain("never Verified");
    expect(result.output.trim().split("\n").at(-1)).toContain(
      "6 checked independently; 0 checked by the server",
    );
    expect(result.paths.some((p) => p.endsWith("/verification"))).toBe(false);
  });

  it("inv.i3.conservation: a tampered line fails with the exact domain mismatch", async () => {
    const tampered = structuredClone(full);
    const line = tampered.bundle.lines[0];
    if (!line) throw new Error("fixture has no lines");
    line.netCents += 1;
    const result = await cli(tampered);
    expect(result.code).toBe(1);
    expect(result.output).toContain(
      "Line hashes, conservation and linesDigest: A line hash does not recompute.",
    );
  });

  it.each(["reference", "card", "photo", "signature", "batch"] as const)(
    "fails a tampered %s",
    async (field) => {
      const tampered = structuredClone(full);
      if (field === "reference") tampered.bundle.invoice.reference = "rc:0000000000000000";
      if (field === "card") tampered.bundle.rateCard.sha256 = "00".repeat(32);
      if (field === "batch") tampered.bundle.batch.batchSha256 = "00".repeat(32);
      if (field === "photo") {
        const photo = tampered.bundle.documents[0];
        if (!photo) throw new Error("fixture has no photos");
        photo.sha256 = "00".repeat(32);
      }
      if (field === "signature") {
        const approval = tampered.bundle.approvals[0];
        if (!approval) throw new Error("fixture has no approvals");
        approval.signatureHex = "00".repeat(64);
      }
      const result = await cli(tampered);
      expect(result.code).toBe(1);
      expect(result.output.match(/: Matches/g)?.length ?? 0).toBeLessThan(6);
    },
  );

  it("inv.i8.public: five independent checks and one labelled server check pass", async () => {
    const result = await cli();
    expect(result.code, result.output).toBe(0);
    expect(result.output.match(/: Matches/g)).toHaveLength(6);
    expect(result.output).toContain(
      "Payout items and batchSha256: Matches (checked by the server: payout receivers are withheld on the public Proof)",
    );
    expect(result.output).toContain("Six of six match");
    expect(result.output).toContain("Sample, never Verified");
    expect(result.output.trim().split("\n").at(-1)).toContain(
      "5 checked independently; 1 checked by the server",
    );
    expect(result.paths.filter((p) => p.endsWith("/verification"))).toHaveLength(1);
  });

  it("does not let a passing server attestation hide public bundle tampering", async () => {
    const tampered = structuredClone(publicProof);
    tampered.bundle.invoice.reference = "rc:0000000000000000";
    const result = await cli(tampered);
    expect(result.code).toBe(1);
    expect(result.output).toContain("The invoice reference does not carry the card hash.");
    expect(result.output).toContain("5 checked independently; 1 checked by the server");
    expect(result.output).not.toContain("Six of six match");
  });

  it("fails with the server's exact payout-items mismatch", async () => {
    const failed = structuredClone(attestation);
    failed.verification.plates.payoutItems = {
      ok: false,
      reason: "The posted batch differs from the one in the chain.",
    };
    const result = await cli(undefined, { verification: failed });
    expect(result.code).toBe(1);
    expect(result.output).toContain(
      "Payout items and batchSha256: The posted batch differs from the one in the chain.",
    );
    expect(result.output).toContain("5 checked independently; 1 checked by the server");
    expect(result.output).not.toContain("Six of six match");
  });

  it.each(["unreadable", "wrong-run", "wrong-attester"])(
    "fails closed on a %s server attestation",
    async (kind) => {
      const verification =
        kind === "unreadable"
          ? null
          : {
              ...attestation,
              ...(kind === "wrong-run" ? { runSlug: "2026A-r999" } : { attestedBy: "other" }),
            };
      const result = await cli(undefined, { verification });
      expect(result.code).toBe(1);
      expect(result.output).toContain("Server verification");
      expect(result.output).not.toContain("Six of six match");
    },
  );

  it.each(["file:///proof/2026A-r37", "ftp://localhost/proof/2026A-r37", "data:application/json,{}"])(
    "refuses non-http(s) URL %s before making requests",
    async (input) => {
      const result = await cli(undefined, { input });
      expect(result.code).toBe(1);
      expect(result.output).toContain("Only HTTPS and loopback HTTP Proof URLs are allowed.");
      expect(result.paths).toEqual([]);
    },
  );

  it("detects withheld receivers even if the redacted metadata is false", async () => {
    const result = await cli({ ...publicProof, redacted: false });
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("5 checked independently; 1 checked by the server");
  });

  it("fails a broken signed ledger checkpoint", async () => {
    const tampered = structuredClone(full);
    tampered.bundle.checkpoint.signatureHex = "00".repeat(64);
    const result = await cli(tampered);
    expect(result.code).toBe(1);
    expect(result.output).toContain("Signed checkpoint:");
  });
});
