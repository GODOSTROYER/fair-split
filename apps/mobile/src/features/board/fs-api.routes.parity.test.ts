import { readFileSync } from "node:fs";
import {
  ApprovalPayloadResponse,
  ClaimPairingRequest,
  ClaimPairingResponse,
  SubmitApprovalRequest,
} from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { buildDemoApproval, buildDemoCosign } from "../../services/demo-fixtures";

// Read fs-api's route/shape declarations without pulling server code into the UI dependency graph.
const api = new URL("../../../../api/src/", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, api), "utf8");
describe("fs-api route and shape parity", () => {
  for (const [file, route] of [
    ["routes/runs/index.ts", "/v1/runs/:runSlug"],
    ["routes/runs/index.ts", "/v1/runs/:runSlug/lines"],
    ["routes/approvals/index.ts", "/v1/runs/:runSlug/batch"],
    ["routes/season/index.ts", "/v1/seasons/:seasonCode"],
    ["routes/judge/index.ts", "/v1/judge/session"],
    ["routes/judge/index.ts", "/v1/judge/keys"],
  ] as const)
    it(`serves ${route}`, () => expect(source(file)).toContain(`path: "${route}"`));

  it("K1b session lookup exposes the run slug to frame/device tokens", () => {
    expect(source("judge/schemas.ts")).toMatch(/runSlug:\s*RunSlug\.nullable\(\)/);
    const route = source("routes/judge/index.ts");
    expect(route).toContain('cred.kind === "frame"');
    expect(route).toContain('cred.kind === "device"');
    expect(route).toMatch(/runSlug:\s*run\?\.runSlug\s*\?\?\s*null/);
  });
  it("pairing accepts only the frozen token/code body and returns the fields the adapter reads", () => {
    expect(ClaimPairingRequest.safeParse({ code6: "123456" }).success).toBe(true);
    expect(ClaimPairingRequest.safeParse({ token: "x", device: { platform: "web" } }).success).toBe(false);
    const shape = ClaimPairingResponse.shape;
    expect(Object.keys(shape).sort()).toEqual(["expiresAt", "persona", "role", "token", "workspaceId"]);
  });
  it("approval route still accepts exactly the signed payload submission", () => {
    const now = new Date();
    const dto = buildDemoCosign({ now, treasurerSigned: true });
    const { payload, jcs } = buildDemoApproval(dto, {
      role: "chair",
      nonce: "phone-shape-test",
      exp: new Date(now.getTime() + 30 * 60_000).toISOString(),
    });
    expect(ApprovalPayloadResponse.safeParse({ payload, jcs }).success).toBe(true);
    expect(
      SubmitApprovalRequest.safeParse({
        role: "chair",
        keyId: "fs-ernesto-demo-abc123",
        payload,
        signature: "0".repeat(128),
      }).success,
    ).toBe(true);
    const approvals = source("routes/approvals/index.ts");
    expect(approvals).toContain("approvalPayload:");
    expect(approvals).toContain("submitApproval:");
    expect(approvals).toContain("declineApproval:");
  });
  it("the batch and lines fields consumed by the board remain present", () => {
    const reads = source("runs/reads.ts");
    const batch = reads.slice(
      reads.indexOf("export const BatchView"),
      reads.indexOf("export const SeasonView"),
    );
    for (const field of [
      "runSlug",
      "runId",
      "runState",
      "senderBatchId",
      "rateCardSha256",
      "items",
      "itemCount",
      "totalCents",
      "batchSha256",
      "memberLines",
      "linesDigest",
      "chairReasons",
      "blocking",
      "unpayable",
      "rail",
    ]) {
      expect(batch, field).toMatch(new RegExp(`\\b${field}:`));
    }
    expect(reads).toContain("lines: z.array(MemberLineDTO)");
    const keys = source("judge/keys.ts");
    for (const field of ["publicKeyHex", "signatureHex", "keyId", "approverId", "kind", "label"])
      expect(keys).toMatch(new RegExp(`\\b${field}:`));
  });
});
