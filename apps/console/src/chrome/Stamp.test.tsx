// The console's ink stamp (a person's initials on a decision): it looks like ui-web's InkStamp, and its accessible
// name is the person and the time in full, in a form axe accepts (ui-web's puts aria-label on an <abbr>, which
// has no role that allows a name: axe's aria-prohibited-attr), so a screen reader never reads only "AS".

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../test/axe.js";
import { renderConsole } from "../test/render.js";
import { Stamp } from "./Stamp.js";

const STAMP = { initials: "AS", name: "Analyn R. Sumalinog", at: "02:43:33" } as const;

/** axe's findings for a rule, violations and the "needs review" kind alike. */
async function findings(root: Element, rules: readonly string[]) {
  const result = await axe.run(root, {
    runOnly: { type: "rule", values: [...rules] },
    resultTypes: ["violations", "incomplete"],
  });
  return [...result.violations, ...result.incomplete].flatMap((r) =>
    r.nodes.map((n) => `${r.id}: ${n.html}`),
  );
}

describe("Stamp", () => {
  it("draws the initials in ink and names the person and the time in full", async () => {
    const view = render(
      <p>
        <Stamp stamp={STAMP} testId="key.stamp" />
      </p>,
    );
    const stamp = screen.getByTestId("key.stamp");
    expect(stamp.classList.contains("fs-stamp")).toBe(true);
    expect(stamp.getAttribute("title")).toBe("Analyn R. Sumalinog, 02:43:33");
    expect(screen.getByRole("img", { name: "Analyn R. Sumalinog, 02:43:33" })).toBe(stamp);
    const initials = stamp.querySelector(".fs-t-stamp");
    expect(initials?.textContent).toBe("AS");
    expect(initials?.getAttribute("aria-hidden")).toBe("true");
    expect(
      await findings(view.container, ["aria-prohibited-attr", "role-img-alt", "aria-allowed-attr"]),
    ).toEqual([]);
    await expectNoAxeViolations(view.container);
  });

  it("the stamp beside the judge's first press in a session (the hero state axe flagged) has that name", async () => {
    await renderConsole({ path: "/judge" });
    fireEvent.keyDown(screen.getByTestId("W-JG-01.markPaid.face"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("session"));
    const stamp = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(".fsc-first__stamp .fs-stamp");
      if (!found) throw new Error("no stamp yet");
      return found;
    });
    expect(stamp.getAttribute("role")).toBe("img");
    expect(stamp.getAttribute("aria-label")).toMatch(/^Analyn R\. Sumalinog, /);
    expect(document.querySelectorAll("abbr.fs-stamp[aria-label]")).toHaveLength(0);
    expect(await findings(document.body, ["aria-prohibited-attr"])).toEqual([]);
  });
});
