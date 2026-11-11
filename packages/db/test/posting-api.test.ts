import { describe, expect, it } from "vitest";
import { repos } from "../src/repos/index.js";
import * as posting from "../src/repos/posting.js";
import { systemScope } from "../src/scope.js";

describe("posting recomputes hashes from current line facts", () => {
  it("does not expose the retired stored-hash reader", () => {
    expect(posting).not.toHaveProperty("memberLineHashes");
    const r = repos(systemScope("00000000-0000-7000-8000-000000000000"));
    expect(r.lines).not.toHaveProperty("hashes");
    expect(r.lines.followItem).toBeTypeOf("function");
    expect(r.runs.beginPosting).toBeTypeOf("function");
  });
});
