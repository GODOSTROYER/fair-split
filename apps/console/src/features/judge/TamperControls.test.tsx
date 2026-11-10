import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, it } from "vitest";
import { renderConsole } from "../../test/index.js";
import { blockedFigure } from "./TamperControls.js";
import { tamperWasRefused } from "./tamper-state.js";

it("offers all four simulator tampers as rows, and the tried row opens in place to its refusal", async () => {
  const view = await renderConsole({
    path: "/judge",
    handlers: [
      http.post("*/v1/judge/sessions/:sid/tamper", async ({ request }) => {
        const { kind } = (await request.json()) as { kind: string };
        return HttpResponse.json({
          kind,
          label:
            kind === "amount"
              ? "Simulated tamper: Claude's draft overcharges Lantern Bay by US$1,000.00"
              : "Simulated tamper: an extra recipient gets a copy of the invoice",
          simulated: true,
          runSlug: "2026A-r38",
          verdict: "DENY",
          decidedBy: [kind === "amount" ? "invoiceEqualsQuote" : "recipientInBrandAllowlist"],
          reasons: ["invoiceEqualsQuote refused overcharge"],
          armed: false,
          paypalCalls: 0,
          modelCalls: 0,
        });
      }),
    ],
  });
  await view.startSession();
  fireEvent.click(screen.getByTestId("W-JG-01.whatsRealOpen"));
  const amount = await screen.findByTestId("W-JG-01.tamper.amount");
  // Four left-aligned rows: the attack's name, then "Try" (its accessible name says which attack).
  const rows = screen.getByTestId("W-JG-01.tampers").querySelectorAll(".fsc-tamper");
  expect([...rows].map((r) => r.querySelector(".fsc-tamper__name")?.textContent)).toEqual([
    "Overcharge the invoice draft",
    "Offset shipping with a discount",
    "Add an invoice recipient",
    "Arm a payout change before key 2",
  ]);
  expect(screen.getByRole("button", { name: "Try: Arm a payout change before key 2" })).toBe(
    screen.getByTestId("W-JG-01.tamper.change_payout"),
  );
  // No tag in the sheet's attempts: the lede and the PayPal row say what is simulated.
  expect(screen.getByTestId("W-JG-01.tryToBreak").querySelector("[data-fs-tag]")).toBeNull();
  expect(screen.getByTestId("W-JG-01.whatsReal").textContent).not.toContain("with its date");
  await act(async () => fireEvent.click(screen.getByTestId("W-JG-01.tamper.recipient")));
  await waitFor(() =>
    expect(
      screen.getByTestId("W-JG-01.tamper.result").closest(".fsc-tamper")?.getAttribute("data-kind"),
    ).toBe("recipient"),
  );
  await waitFor(() => expect((amount as HTMLButtonElement).disabled).toBe(false));
  await act(async () => fireEvent.click(amount));
  await waitFor(() =>
    expect(
      screen.getByTestId("W-JG-01.tamper.result").closest(".fsc-tamper")?.getAttribute("data-kind"),
    ).toBe("amount"),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(screen.queryByTestId("W-JG-01.tamper.error")?.textContent).toBeUndefined();
  // Only the row tried last is open: the title, the rule, and the one number the attack would have changed.
  const result = await screen.findByTestId("W-JG-01.tamper.result");
  expect(screen.getAllByTestId("W-JG-01.tamper.result")).toHaveLength(1);
  expect(result.dataset.verdict).toBe("DENY");
  expect(result.closest(".fsc-tamper")?.getAttribute("data-kind")).toBe("amount");
  expect(result.textContent).toContain("Refused");
  expect(result.textContent).toContain("invoiceEqualsQuote");
  expect(result.textContent).toContain("+US$1,000.00 blocked");
  expect(result.querySelector("details summary")?.textContent).toBe("Why");
  // The row tried earlier keeps one word.
  expect(rows[2]?.querySelector(".fsc-tamper__was")?.textContent).toBe("Refused");
});

it("reads the one blocked number from the server's own description of each attack", () => {
  expect(
    blockedFigure({
      kind: "amount",
      label: "Simulated tamper: Claude's draft overcharges Lantern Bay by US$1,000.00",
    }),
  ).toBe("+US$1,000.00");
  expect(
    blockedFigure({
      kind: "offsetting",
      label: "Simulated tamper: shipping 50.00 offset by a 50.00 discount (same total)",
    }),
  ).toBe("US$50.00 offset");
  expect(blockedFigure({ kind: "recipient", label: "an extra recipient" })).toBe("+1 recipient");
  expect(
    blockedFigure({ kind: "change_payout", label: "one payout changes by 1 cent after both keys" }),
  ).toBe("US$0.01");
  expect(blockedFigure({ kind: "amount", label: "Simulated tamper" })).toBeNull();
});

it("does not describe arming alone as a refused payout", () => {
  expect(tamperWasRefused([])).toBe(false);
  expect(
    tamperWasRefused([
      {
        type: "run.state",
        at: "2026-11-04T11:08:00.000Z",
        payload: { from: "APPROVED", to: "IN_REVIEW", cause: { code: "SEND_BACK", ref: "DIGEST_MISMATCH" } },
      },
    ] as never),
  ).toBe(true);
});
