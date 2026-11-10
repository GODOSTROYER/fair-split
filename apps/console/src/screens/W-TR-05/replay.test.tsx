import { UiProvider } from "@fairsplit/ui-web";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { showcaseView } from "../../data/run-view.js";
import { type GridRow, StatusCell } from "../../features/split/cells.js";
import { splitRows } from "../../features/split/model.js";
import { seedSnapshot } from "../../test/world.js";
import { decidedWords } from "./index.js";

const snapshot = seedSnapshot();
const base = showcaseView(snapshot);
const replayView = {
  ...base,
  items: Object.fromEntries(
    Object.entries(base.items).map(([id, item]) => [id, { ...item, provenance: "replay" as const }]),
  ),
};

describe("split review after a payout replay", () => {
  it("inv.i8.split-replay: displays the labelled replay instead of Paid or a jade confirmation", () => {
    const row = splitRows(snapshot, replayView).find((r) => r.memberNo === "M-014");
    if (!row) throw new Error("M-014 required");
    const props = {
      data: { kind: "line", ...row } as GridRow,
      context: { isLive: () => true },
    } as unknown as Parameters<typeof StatusCell>[0];
    const { container } = render(
      <UiProvider>
        <StatusCell {...props} />
      </UiProvider>,
    );
    // Which status replayed, never "Paid"; the split's decided line says once where it came from.
    expect(container.textContent).toBe("Replayed (labelled): successful in the earlier run");
    expect(container.querySelector('[data-state="replay"]')).not.toBeNull();
    expect(container.querySelector('[data-tone="jade"]')).toBeNull();
    expect(container.querySelector(".fsr-cell__wash")).toBeNull();
    expect(row.amountState).not.toBe("landed");
  });

  it("inv.i8.split-summary: never promises fresh simulator confirmation on a replay run", () => {
    for (const state of ["APPROVED", "POSTING", "POSTED", "SETTLING", "NEEDS_FOLLOW_UP", "SETTLED"]) {
      const words = decidedWords(state, true);
      expect(words).toContain("replayed (labelled)");
      expect(words).not.toMatch(/confirms|confirmed|verified/i);
    }
  });

  it("a settled run with cash still due never reads settled (UI gate round 3)", () => {
    for (const state of ["SETTLED", "CLOSED"]) {
      expect(decidedWords(state, false, true)).toBe("Every hold decided · PayPal complete · cash due");
      expect(decidedWords(state, false, true)).not.toMatch(/settled|done/i);
    }
    expect(decidedWords("SETTLED", false, false)).toBe("Every hold decided · settled");
  });

  it("keeps cash statuses distinct from replayed PayPal statuses", () => {
    const row = splitRows(snapshot, replayView).find((r) => r.rail === "CASH");
    expect(row?.replayed).not.toBe(true);
    const rerouted = splitRows(snapshot, replayView).find((r) => r.movedToCash);
    expect(rerouted?.memberNo).toBe("M-031");
    expect(rerouted?.replayed).not.toBe(true);
  });
});
