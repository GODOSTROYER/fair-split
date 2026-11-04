// The one-time sound offer floats over the lower left of the console (beside the rail, over the screen or a
// full-width drawer). A control the console focuses there (Next after Count it once, a grid row) must be able to
// scroll clear of it (WCAG 2.4.11; lib/focus.ts scrolls it above the chip), so while the offer shows, the screen
// and the drawer keep room at their foot to scroll their last control above it. jsdom applies no stylesheet:
// this reads stage.css as a browser would cascade it. On the first view from 1280 px the story tiles fill the lower
// left, so there the offer floats at the top right of the screen, beside the headline, and needs no foot room.

import { afterEach, describe, expect, it } from "vitest";
import { cascaded, readRules } from "../test/css.js";

const rules = readRules("src/theme/stage.css");
const MEDIUM = { width: 1100, motion: "full" } as const;

/** The stage with its screen, a drawer and, when asked, the sound offer and the first view. */
function stage(offer: boolean, firstView = false) {
  const root = document.createElement("div");
  root.className = "fsc-stage";
  const body = document.createElement("div");
  body.className = "fsc-console__body";
  const screen = document.createElement("main");
  screen.className = "fsc-console__screen";
  const drawer = document.createElement("aside");
  drawer.className = "fsc-drawer";
  const drawerBody = document.createElement("div");
  drawerBody.className = "fsc-drawer__body";
  drawer.append(drawerBody);
  if (firstView) {
    const first = document.createElement("section");
    first.className = "fsc-first";
    screen.append(first);
  }
  body.append(screen, drawer);
  root.append(body);
  if (offer) {
    const chip = document.createElement("section");
    chip.className = "fsc-offer";
    root.append(chip);
  }
  document.body.append(root);
  return { screen, drawerBody };
}

const px = (value: string | undefined) => Number.parseFloat(value ?? "0");

afterEach(() => {
  document.body.replaceChildren();
});

describe("room under the sound offer (stage.css)", () => {
  it("while the offer shows, the screen and the drawer can scroll their last control 112 px above their foot", () => {
    const { screen, drawerBody } = stage(true);
    expect(px(cascaded(rules, screen, "padding-bottom", MEDIUM))).toBeGreaterThanOrEqual(112);
    expect(px(cascaded(rules, drawerBody, "padding-bottom", MEDIUM))).toBeGreaterThanOrEqual(112);
  });

  it("on the first view from 1280 px it floats at the top right, clear of the story tiles, with no foot room", () => {
    const { screen } = stage(true, true);
    const offer = document.querySelector(".fsc-offer");
    if (!offer) throw new Error("no offer");
    for (const width of [1470, 1920]) {
      const wide = { width, motion: "full" } as const;
      expect(cascaded(rules, offer, "top", wide)).toBe("84px");
      expect(cascaded(rules, offer, "bottom", wide)).toBe("auto");
      expect(px(cascaded(rules, screen, "padding-bottom", wide))).toBeLessThan(112);
    }
  });

  it("anywhere else it keeps the lower left, never over a drawer's head (its Close sits top right)", () => {
    stage(true);
    const offer = document.querySelector(".fsc-offer");
    if (!offer) throw new Error("no offer");
    const wide = { width: 1920, motion: "full" } as const;
    expect(cascaded(rules, offer, "bottom", wide)).toBe("112px");
    expect(cascaded(rules, offer, "top", wide)).toBeUndefined();
  });

  it("without it, they keep their own padding", () => {
    const { drawerBody } = stage(false);
    expect(px(cascaded(rules, drawerBody, "padding-bottom", MEDIUM))).toBeLessThan(112);
  });
});
