// S2.11: Proof (W-PF-01, and the brand's view W-BR-01) loads its fonts in ≤80 KB: the FSSans-Proof subset, not the
// console's 120 KB variable face. jsdom loads no fonts, so this reads the stylesheets and the document: Proof's
// face is a family of its own built on the subset; nothing asks for a width the subset lacks (75-100%); and on
// Proof's paths the root element itself reads in the subset (`<html data-face="proof">`) from before the first
// render, through the loading, error and not-found states, and only while Proof is open. A browser fetches the
// root's face at its first layout, before any text renders, so a rule on Proof's column alone still let a cold
// load fetch both faces (188 KB).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { webRoutes } from "@fairsplit/contracts";
import { screen, waitFor } from "@testing-library/react";
import { http } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { bootFace, hasProofFace, isProofPath, setProofFace } from "../../lib/face.js";
import { createTestWorld, renderConsole } from "../../test/index.js";
import { gate, withHandlers } from "../../test/proof-world.js";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const proof = read("src/features/proof/proof.css");
const brand = read("src/features/brand/brand.css");
const surfaces = read("src/theme/surfaces.css");
const styles = read("src/styles.css");

const RUN = "2026A-r37";

/** The selectors of the rules that point the UI font token at Proof's own face. */
function proofFaceSelectors(css: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => /--fs-font-ui:\s*"FS Sans Proof"/.test(m[2] ?? ""))
    .map((m) => (m[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").trim());
}

/** True when the document's root reads in Proof's face: a rule naming it matches <html>. */
function rootReadsProof(): boolean {
  return proofFaceSelectors(surfaces).some((s) => document.documentElement.matches(s));
}

afterEach(() => setProofFace(false));

describe("Proof's face", () => {
  it("is the Proof subset under its own family, never the console's variable face", () => {
    const faces = [...surfaces.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1] ?? "");
    const own = faces.filter((f) => f.includes('"FS Sans Proof"'));
    expect(own.some((f) => f.includes("FSSans-Proof.woff2"))).toBe(true);
    expect(own.some((f) => f.includes("FSSans-VF.woff2"))).toBe(false);
    const column = /\n\.pf \{([^}]*)\}/.exec(proof)?.[1] ?? "";
    expect(column).toMatch(/--fs-font-ui:\s*"FS Sans Proof"/);
    expect(column).not.toMatch(/--fs-font-ui:[^;]*"FS Sans"[,;]/);
    // The root and the body take their face from the token, so pointing it at the subset on <html> covers all.
    expect(styles).toMatch(/html \{[^}]*font-family: var\(--fs-font-ui\)/);
    expect(styles).toMatch(/body \{[^}]*font-family: var\(--fs-font-ui\)/);
  });

  it("asks for no width the subset lacks", () => {
    for (const css of [proof, brand, surfaces]) {
      for (const m of css.matchAll(/font-stretch:\s*([\d.]+)%/g)) {
        expect(Number(m[1])).toBeLessThanOrEqual(100);
      }
    }
  });

  it("covers Proof's two paths, and only those", () => {
    expect(isProofPath(webRoutes.proof(RUN))).toBe(true);
    expect(isProofPath("/b/fsb_0123456789abcdef.mock")).toBe(true);
    expect(isProofPath("/proof/not-a-run")).toBe(true);
    for (const path of ["/", "/judge", webRoutes.approve(RUN), "/ops", "/sign-in", "/proofs", "/b"]) {
      expect(isProofPath(path)).toBe(false);
    }
  });

  it("a cold Proof load reads in the subset from before its first render, loading state included", async () => {
    bootFace(webRoutes.proof(RUN));
    expect(rootReadsProof()).toBe(true);
    const held = gate();
    const world = withHandlers(createTestWorld(), [
      http.get("*/v1/proof/:runSlug", async () => {
        await held.opened;
      }),
    ]);
    const view = await renderConsole({ path: webRoutes.proof(RUN), world });
    const loading = await screen.findByTestId("W-PF-01.loading");
    expect(loading.closest(".fsc-surface--proof")).not.toBeNull();
    expect(rootReadsProof()).toBe(true);

    // Leaving Proof for the console gives the console its own face back.
    await view.navigate("/sign-in");
    await waitFor(() => expect(hasProofFace()).toBe(false));
    expect(rootReadsProof()).toBe(false);
    held.release();
  });

  it("is held only while a Proof surface is open: from the console into Proof and back", async () => {
    bootFace("/sign-in");
    const view = await renderConsole({ path: "/sign-in" });
    expect(rootReadsProof()).toBe(false);
    await view.navigate(webRoutes.proof(RUN));
    await screen.findByTestId("W-PF-01");
    expect(rootReadsProof()).toBe(true);
    await view.navigate("/sign-in");
    await waitFor(() => expect(rootReadsProof()).toBe(false));
  });

  it("a Proof URL that ends on the not-found page keeps the subset; the console then gets its own face", async () => {
    bootFace("/proof/not-a-run");
    const view = await renderConsole({ path: "/proof/not-a-run" });
    await screen.findByTestId("not-found");
    expect(rootReadsProof()).toBe(true);
    await view.navigate("/sign-in");
    await waitFor(() => expect(rootReadsProof()).toBe(false));
  });
});
