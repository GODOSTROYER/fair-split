// The phone's panel between 1024 and 1679 px, as the browser cascades stage.css (jsdom applies none of it): a
// raised panel takes focus in the commit that raised it (Stage moves focus into it while the console under the
// scrim goes inert), and a browser refuses focus to a control it does not render. So on the way up, in either
// motion mode, the panel's visibility never waits for its transition; only the way down holds it until the
// slide (or, reduced, the fade) is over.

import { LAYOUT } from "@fairsplit/tokens";
import { afterEach, describe, expect, it } from "vitest";
import { cascaded, readRules, transitionDelay } from "../test/css.js";
import { phoneSizeFor, stageLayoutFor } from "./layout.js";

const rules = readRules("src/theme/stage.css");
const phoneRules = readRules("../../packages/ui-web/src/styles.css");

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

it.each([
  { width: 1280, height: 800, raised: "user" as const },
  { width: 1280, height: 800, raised: "moment" as const },
  { width: 1470, height: 956, raised: "user" as const },
  { width: 1470, height: 956, raised: "moment" as const },
])(
  "the $raised panel fits the phone and bezel inside its borders at $width × $height",
  ({ width, height, raised }) => {
    const panel = panelIn(raised);
    const stage = panel.closest(".fsc-stage");
    if (!stage) throw new Error("the stage is missing");
    const bezel = document.createElement("div");
    bezel.className = "fs-phone__bezel";
    panel.append(bezel);
    const medium = { width, height, motion: "full" as const };
    const panelWidth = Number.parseFloat(cascaded(rules, stage, "--fsc-phone-panel", medium) ?? "");
    const border = Number.parseFloat(cascaded(rules, panel, "border", medium) ?? "0");
    const padding = (cascaded(rules, panel, "padding", medium) ?? "0").split(" ");
    const horizontalPadding = Number.parseFloat(padding[1] ?? padding[0] ?? "0");
    const bezelPadding = Number.parseFloat(cascaded(phoneRules, bezel, "padding", medium) ?? "0");
    const phoneWidth = phoneSizeFor(stageLayoutFor(width), height).width + 2 * bezelPadding;
    // border-box width includes both border rules; their two pixels are unavailable to the phone.
    expect(phoneWidth + 2 * horizontalPadding).toBeLessThanOrEqual(panelWidth - 2 * border);
  },
);

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
  )(
    "lowered at $width px ($motion motion): the device hides once its way down is over; the rail stays",
    ({ width, motion }) => {
      const panel = panelIn(null);
      const device = document.createElement("div");
      device.className = "fsc-dock__device";
      panel.append(device);
      const medium = { width, motion };
      // Round 3: the lowered phone is its 56 px rail (the glyph and the avatars), never gone.
      expect(cascaded(rules, panel, "visibility", medium) ?? "visible").toBe("visible");
      expect(cascaded(rules, device, "visibility", medium)).toBe("hidden");
      const transition = cascaded(rules, device, "transition", medium) ?? "";
      expect(transitionDelay(transition, "visibility")).toBe(
        motion === "reduced" ? "var(--fs-dur-reduced)" : "var(--fs-dur-drawer-out)",
      );
      // Reduced motion fades it: no slide either way.
      if (motion === "reduced") {
        expect(cascaded(rules, device, "transform", medium)).toBe("none");
        expect(cascaded(rules, device, "opacity", medium)).toBe("0");
      }
    },
  );
});

it.each([1024, 1470, 1679])("inv.i8.phone panel contains its figure at %s px", (width) => {
  const panel = panelIn("user");
  expect(cascaded(rules, panel, "overflow-x", { width, motion: "full" })).toBe("hidden");
  expect(cascaded(rules, panel, "min-width", { width, motion: "full" })).toBe("0");
});

/** The folded phone's rail, as PhoneDock draws it. */
function railIn(layout: "dock" | "tab"): { dock: HTMLElement; word: HTMLElement; device: HTMLElement } {
  const stage = document.createElement("div");
  stage.className = "fsc-stage";
  stage.dataset.layout = layout;
  stage.dataset.phone = "folded";
  const body = document.createElement("div");
  body.className = "fsc-stage__body";
  const dock = document.createElement("aside");
  dock.className = "fsc-dock";
  dock.dataset.folded = "";
  const word = document.createElement("span");
  word.className = "fsc-dock__tabword";
  const device = document.createElement("div");
  device.className = "fsc-dock__device";
  dock.append(word, device);
  body.append(dock);
  stage.append(body);
  document.body.append(stage);
  return { dock, word, device };
}

it.each([
  ["dock", 1470],
  ["dock", 1920],
  ["tab", 1280],
] as const)(
  "folded on the %s layout at %i px: a 56 px rail, the frame words kept for assistive tech",
  (layout, width) => {
    const { dock, word, device } = railIn(layout);
    const medium = { width, height: 956, motion: "full" as const };
    const body = dock.parentElement as HTMLElement;
    expect(cascaded(rules, body, "grid-template-columns", medium)).toBe(
      "minmax(0, 1fr) var(--fsc-phone-rail)",
    );
    // The rail is the tokens' 56 px (LAYOUT.console.phoneRail), never a number of the stage's own.
    expect(cascaded(rules, body.parentElement as HTMLElement, "--fsc-phone-rail", medium)).toBe(
      "var(--fs-console-phone-rail)",
    );
    expect(LAYOUT.console.phoneRail).toBe(56);
    // The word leaves the screen, never the accessibility tree (clipped, not display: none).
    expect(cascaded(rules, word, "clip-path", medium)).toBe("inset(50%)");
    expect(cascaded(rules, word, "display", medium)).toBeUndefined();
    // The frames stay loaded at their size, only hidden: opening shows their last good state.
    expect(cascaded(rules, device, "visibility", medium)).toBe("hidden");
    expect(cascaded(rules, device, "display", medium)).toBeUndefined();
  },
);
