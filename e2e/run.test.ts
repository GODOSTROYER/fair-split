import assert from "node:assert/strict";
import { test } from "node:test";
import { projectInvocations } from "./run.js";

test("default e2e isolates each project's private stack in a separate Playwright invocation", () => {
  assert.deepEqual(projectInvocations([]), [
    ["--project=api"],
    ["--project=chromium"],
    ["--project=reduced-motion"],
  ]);
});

test("test filters and their option values are preserved for every isolated project", () => {
  const args = ["dr0-moments", "--grep", "Proof|E-01", "--timeout=60000"];
  assert.deepEqual(
    projectInvocations(args),
    ["api", "chromium", "reduced-motion"].map((project) => [...args, `--project=${project}`]),
  );
  assert.deepEqual(args, ["dr0-moments", "--grep", "Proof|E-01", "--timeout=60000"]);
});

test("explicit equals, spaced and repeated project flags pass through once without consuming filters", () => {
  for (const args of [
    ["dr0-moments", "--project=chromium"],
    ["--project", "chromium", "dr0-moments", "--grep", "Proof"],
    ["--project=chromium", "--project", "reduced-motion", "proof"],
    ["--project"],
  ]) {
    assert.deepEqual(projectInvocations(args), [args]);
  }
});

test("similarly named flags and literal arguments after -- are not project selections", () => {
  assert.equal(projectInvocations(["--projected"]).length, 3);
  assert.deepEqual(
    projectInvocations(["--", "--project=chromium"]),
    ["api", "chromium", "reduced-motion"].map((project) => [
      `--project=${project}`,
      "--",
      "--project=chromium",
    ]),
  );
});
