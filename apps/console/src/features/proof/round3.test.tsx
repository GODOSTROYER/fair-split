// Proof and the brand view, UI gate round 3: one truth for counts and ids (the slips say which count is which, the
// showcase run's invoice says it is the showcase's), the tag budget (one quiet indicator, at most two micro-tags on
// PayPal money, bare glyphs elsewhere), one family and one mono (every number in FS Sans's tabular figures, ids in
// the mono), words at 13 px or more, and dashed lines for simulated things only. Every figure is the bundle's own;
// none changes.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSnapshot } from "@fairsplit/api-client/seed";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { slipCounts } from "../../lib/display.js";
import { plateFact, plateParts, slipScope } from "./Chain.js";
import { Distribution } from "./Distribution.js";
import { deriveFigures } from "./metrics.js";
import { countItems, ledgerFacts, mergeItems } from "./model.js";

const snapshot = getSnapshot();
const bundle = snapshot.proof;
const facts = ledgerFacts(bundle.ledger);
const items = mergeItems(bundle.batch.items);
const props = {
  bundle,
  facts,
  progress: countItems(items.map((item) => item.status)),
  items,
  lineStates: {},
};

describe("one truth for the slip count", () => {
  it("counts this run's slips (photos A-L) and the season's from the bundle's own ledger", () => {
    expect(slipScope(bundle)).toEqual({ run: 48, season: 264 });
    // The same two numbers the stage says, from the seed: "48 this run · 264 season".
    expect(slipCounts(snapshot).text).toBe(plateFact("read", props));
    // The season's count is the one the chain accepted: no figure changed.
    expect(slipScope(bundle).season).toBe(facts.slipsAccepted);
  });

  it("a record with no imaged photos says the season's count alone", () => {
    const manifestOnly = {
      ...bundle,
      ledger: bundle.ledger.map((entry) =>
        entry.kind === "rows.accepted"
          ? { ...entry, payload: { ...(entry.payload as Record<string, unknown>), photoId: null } }
          : entry,
      ),
    };
    expect(plateFact("read", { ...props, bundle: manifestOnly })).toBe("264 slips");
  });
});

describe("the showcase run's invoice id says whose it is", () => {
  it("labels the id as the showcase run's only on the showcase's Proof", () => {
    expect(plateFact("paid", { ...props, showcase: true })).toMatch(/^FS-2026A-r37 · showcase run · /);
    expect(plateFact("paid", props)).toMatch(/^FS-2026A-r37 · marked as paid/);
  });
});

describe("the plate facts' roles: ids in the mono, money in the figures", () => {
  it("marks ids for the id role and money for the money role, and nothing else", () => {
    expect(plateParts("paid", props).map((p) => p.role ?? "words")).toEqual(["id", "words", "money"]);
    expect(plateParts("ratified", props)[0]).toMatchObject({ role: "id", before: "card " });
    expect(plateParts("computed", props)[1]).toMatchObject({ role: "money", after: " net" });
    expect(plateParts("twoKeys", props).every((p) => p.role === "id")).toBe(true);
  });
});

describe("the money card's one micro-tag", () => {
  const figures = deriveFigures({ bundle, facts, items, lineStates: {}, holds: null, seeded: null });

  it("sits beside the PayPal money it covers, once", () => {
    render(<Distribution bundle={bundle} figures={figures} amount="US$4,333.50" />);
    const tags = document.querySelectorAll('[data-fs-tag="micro"]');
    expect(tags).toHaveLength(1);
    expect(screen.getByTestId("proof-distribution.paypal").contains(tags[0] as Node)).toBe(true);
  });

  it("before any confirm it covers the PayPal money still on its way", () => {
    const sending = {
      ...figures,
      tiers: {
        ...figures.tiers,
        paypal: { members: 0, cents: 0 },
        due: {
          ...figures.tiers.due,
          paypal: { members: figures.tiers.paypal.members, cents: figures.tiers.paypal.cents },
        },
      },
    };
    render(<Distribution bundle={bundle} figures={sending} amount="US$4,333.50" />);
    expect(screen.queryByTestId("proof-distribution.paypal")).toBeNull();
    expect(
      screen.getByTestId("proof-distribution.flight").querySelector('[data-fs-tag="micro"]'),
    ).not.toBeNull();
  });
});

describe("Proof's stylesheets hold round 3's floors", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
  const sheets = {
    proof: read("src/features/proof/proof.css"),
    brand: read("src/features/brand/brand.css"),
  };
  /** Declarations only: comments say "dashed" when they explain why nothing is. */
  const rules = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("draws no dashed line: dashed means simulated, and the honesty marks draw their own", () => {
    for (const [name, css] of Object.entries(sheets)) {
      expect(rules(css), name).not.toMatch(/dashed|stroke-dasharray/);
    }
  });

  it("sets words at 13 px or more; only an id may be 12", () => {
    for (const [name, css] of Object.entries(sheets)) {
      const blocks = [...rules(css).matchAll(/([^{}]+)\{([^}]*)\}/g)];
      for (const [, selector = "", body = ""] of blocks) {
        const size = /font-size:\s*([\d.]+)rem/.exec(body)?.[1];
        if (!size || Number(size) >= 0.8125) continue;
        // The slip drawing's own print is evidence art inside an SVG, in px; an id in the mono role and the masked
        // receiver are ids.
        expect(selector.trim(), name).toMatch(/^\.pf-line__receiver$|\.fs-t-id$/);
        expect(Number(size)).toBeGreaterThanOrEqual(0.75);
      }
    }
  });

  it("sets every number in FS Sans's tabular figures: nothing forces proportional figures (one money style)", () => {
    for (const [name, css] of Object.entries(sheets)) {
      expect(rules(css), name).not.toMatch(/proportional-nums|"tnum" 0/);
    }
  });

  it("keeps the type on docs/DESIGN.md's steps: no 15, 17, 18, 20 or 22 px words, and no off-step weights", () => {
    for (const [name, css] of Object.entries(sheets)) {
      // The slip drawing is evidence art (an SVG in px); everything else is in rem on the five steps.
      const sizes = [...rules(css).matchAll(/font-size:\s*([\d.]+)rem/g)].map((m) => Number(m[1]));
      for (const size of sizes) expect([0.75, 0.875, 1, 1.5, 3.5], name).toContain(size);
      const weights = [...rules(css).matchAll(/([^{}]+)\{([^}]*)\}/g)]
        .filter(([, selector = ""]) => !selector.includes("pf-crop__"))
        .flatMap(([, , body = ""]) => [...body.matchAll(/font-weight:\s*(\d+)/g)].map((m) => Number(m[1])));
      for (const weight of weights) expect([400, 430, 500, 520, 600], name).toContain(weight);
    }
  });

  it("keeps red for PayPal's no: a check that does not match, and the withheld notice, read in ink", () => {
    const declarations = rules(sheets.proof);
    for (const selector of [".pf-verify__failure", ".pf-withheld", ".pf-plate__reason"]) {
      const body = new RegExp(`\\${selector} \\{([^}]*)\\}`).exec(declarations)?.[1] ?? "";
      expect(body, selector).toMatch(/color: var\(--fs-ink\)/);
      expect(body, selector).not.toMatch(/--fs-red/);
    }
    expect(declarations).not.toMatch(/differs[^{]*\{[^}]*--fs-red/);
  });
});
