// docs/architecture/fair-split-architecture.html is a hand-drawn explainer of the system. It quotes the demo
// season's money and kilo figures, so every one of them must be an IC-03 figure (the same rule E-19 applies to
// public copy), and it must stay a self-contained page that loads nothing but Google Fonts.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { figuresIn, ic03Figures } from "./e19/figures.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PAGE = "docs/architecture/fair-split-architecture.html";
const html = readFileSync(resolve(root, PAGE), "utf8").replace(/\r\n/g, "\n");

/** The page's text as a reader sees it: tags removed and the few entities it uses decoded. */
const text = html
  .replace(/<style[\s\S]*?<\/style>/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">");

describe("architecture page", () => {
  it("prints only IC-03 money and kilo figures", () => {
    const figures = figuresIn(text);
    expect(figures.length).toBeGreaterThan(20);
    const ic03 = ic03Figures();
    const strays = figures.filter((f) => !ic03.has(f)).map((f) => f.text);
    expect(strays).toEqual([]);
  });

  it("adds up: invoice = pool + disbursement, pool = PayPal + cash + kept - credits", () => {
    expect(text).toContain("4,333.50 = pool 4,273.50 + disbursement 60.00");
    expect(text).toContain(
      "4,273.50 = PayPal 341.74 + cash 3,876.43 + kept by co-op 58.53 − credits paid 3.20",
    );
    expect(433_350).toBe(427_350 + 6_000);
    expect(427_350).toBe(34_174 + 387_643 + 5_853 - 320);
  });

  it("is a complete page that loads no script or stylesheet beyond Google Fonts", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Fair Split Architecture</title>");
    expect(html).not.toMatch(/<script[^>]*\bsrc=/i);
    const hrefs = [...html.matchAll(/<link[^>]*\bhref="([^"]+)"/g)].map((m) => m[1] ?? "");
    for (const href of hrefs) expect(href).toMatch(/^https:\/\/fonts\.(googleapis|gstatic)\.com(\/|$)/);
  });

  it("labels the simulated rail and the replayed reading (invariant I8)", () => {
    expect(text).toMatch(/simulated PayPal sandbox/i);
    expect(text).toMatch(/labelled seed stand-in/);
    expect(text).toContain("Hash values above are illustrative stand-ins");
  });
});
