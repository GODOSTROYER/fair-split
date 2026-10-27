// Salted commitments to free text on the public chain: a dictionary of short notes cannot open them, equal texts
// do not link, and whoever is handed the salt checks one with plain sha256.
import { createHash } from "node:crypto";
import { sha256Hex } from "@fairsplit/domain";
import { describe, expect, it } from "vitest";
import { createCredentialKeys } from "../credentials/verify/index.js";
import { type CommitmentSubject, commitmentSalt, commitText, saltedSha256 } from "./commitments.js";

const keys = createCredentialKeys({ cookieSecret: "fair-split test cookie secret, not a real one" });
const otherServer = createCredentialKeys({ cookieSecret: "another server's cookie secret, also not real" });

const note: CommitmentSubject = {
  purpose: "review.note",
  workspaceId: "0192f8a0-0000-7000-8000-000000000005",
  subjectId: "0192f8a0-0000-7000-8000-0000000000aa",
};

describe("salted text commitments", () => {
  it("are sha256(salt ‖ utf8(text)): the salt's holder checks one with plain sha256", () => {
    const text = "Kulang ang timbang sa 0412, palihug susiha.";
    const c = commitText(keys, note, text);
    expect(c.saltHex).toMatch(/^[0-9a-f]{64}$/);
    const plain = createHash("sha256")
      .update(Buffer.from(c.saltHex, "hex"))
      .update(text, "utf8")
      .digest("hex");
    expect(c.sha256).toBe(plain);
    expect(saltedSha256(commitmentSalt(keys, note), text)).toBe(c.sha256);
  });

  it("are never the bare hash a dictionary would match, and equal texts never link", () => {
    const text = "Kulang ang timbang";
    const a = commitText(keys, note, text).sha256;
    const b = commitText(keys, { ...note, subjectId: "0192f8a0-0000-7000-8000-0000000000bb" }, text).sha256;
    expect(a).not.toBe(sha256Hex(text));
    expect(a).not.toBe(b);
  });

  it("take their salt from the server's key, its purpose, the workspace and the subject", () => {
    const salt = commitmentSalt(keys, note).toString("hex");
    expect(commitmentSalt(keys, note).toString("hex")).toBe(salt);
    for (const s of [
      { ...note, purpose: "key.revoked.reason" as const },
      { ...note, workspaceId: "0192f8a0-0000-7000-8000-000000000006" },
      { ...note, subjectId: "fs-analyn-w1" },
    ]) {
      expect(commitmentSalt(keys, s).toString("hex")).not.toBe(salt);
    }
    // without this server's key nobody derives it
    expect(commitmentSalt(otherServer, note).toString("hex")).not.toBe(salt);
  });

  it("compare workspaces as UUIDs: the case a credential carried never changes a commitment", () => {
    const upper = { ...note, workspaceId: note.workspaceId.toUpperCase() };
    expect(commitText(keys, upper, "x")).toEqual(commitText(keys, note, "x"));
  });
});
