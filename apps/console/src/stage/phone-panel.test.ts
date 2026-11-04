// The phone's panel between 1024 and 1679 px, as the browser cascades stage.css (jsdom applies none of it): a
// raised panel takes focus in the commit that raised it (Stage moves focus into it while the console under the
// scrim goes inert), and a browser refuses focus to a control it does not render. So on the way up, in either
// motion mode, the panel's visibility never waits for its transition; only the way down holds it until the
// slide (or, reduced, the fade) is over.

import { afterEach, describe, expect, it } from "vitest";
import { cascaded, readRules, transitionDelay } from "../test/css.js";

const rules = readRules("src/theme/stage.css");

/** The markup PhoneDock and Stage give the panel on the tab layout. */
function panelIn(raised: "user" | "moment" | null): HTMLElement {
  const stage = document.createElement("div");
  stage.className = "fsc-stage";
  stage.dataset.layout = "tab";
  if (raised) stage.dataset.raised = raised;
  const dock = document.createElement("aside");
  dock.className = "fsc-dock";
  dock.dataset.layout = "tab";
  if (raised) dock.dataset.raised = raised;
  const panel = document.createElement("div");
  panel.id = "fsc-phone-panel";
  panel.className = "fsc-dock__panel";
  dock.append(panel);
  stage.append(dock);
  document.body.append(stage);
  return panel;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("the phone's panel on the tab layout (stage.css)", () => {
  const cases = [1024, 1100, 1279, 1470].flatMap((width) =>
    (["full", "reduced"] as const).flatMap((motion) =>
      (["user", "moment"] as const).map((raised) => ({ width, motion, raised })),
    ),
  );

  it.each(cases)(
    "raised by $raised at $width px ($motion motion): visible in the raise's first frame",
    ({ width, motion, raised }) => {
      const panel = panelIn(raised);
      const medium = { width, motion };
      expect(cascaded(rules, panel, "visibility", medium) ?? "visible").toBe("visible");
      const transition = cascaded(rules, panel, "transition", medium) ?? "";
      // A delayed visibility keeps the panel hidden (and refusing focus) for the delay: 150 ms in reduced motion.
      expect(transitionDelay(transition, "visibility")).toBeNull();
    },
  );

  it.each(
    [1024, 1100, 1279, 1470].flatMap((width) =>
      (["full", "reduced"] as const).map((motion) => ({ width, motion })),
    ),
  )("lowered at $width px ($motion motion): hidden, once its way down is over", ({ width, motion }) => {
    const panel = panelIn(null);
    const medium = { width, motion };
    expect(cascaded(rules, panel, "visibility", medium)).toBe("hidden");
    const transition = cascaded(rules, panel, "transition", medium) ?? "";
    expect(transitionDelay(transition, "visibility")).toBe(
      motion === "reduced" ? "var(--fs-dur-reduced)" : "var(--fs-dur-drawer-out)",
    );
    // Reduced motion fades it: no slide either way.
    if (motion === "reduced") {
      expect(cascaded(rules, panel, "transform", medium)).toBe("none");
      expect(cascaded(rules, panel, "opacity", medium)).toBe("0");
    }
  });
});

it.each([1024, 1470, 1679])("inv.i8.phone panel contains its figure at %s px", (width) => {
  const panel = panelIn("user");
  expect(cascaded(rules, panel, "overflow-x", { width, motion: "full" })).toBe("hidden");
  expect(cascaded(rules, panel, "min-width", { width, motion: "full" })).toBe("max-content");
});

it("inv.i8.phone tab never clips its replay and simulated labels", () => {
  const lane = document.createElement("button");
  lane.className = "fsc-ribbon__phone";
  const words = document.createElement("span");
  words.className = "fsc-ribbon__words";
  lane.append(words);
  document.body.append(lane);
  const medium = { width: 1470, motion: "full" as const };
  expect(cascaded(rules, words, "white-space", medium)).toBe("normal");
  expect(cascaded(rules, words, "overflow", medium)).toBe("visible");
});
