import { act, fireEvent, screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, it } from "vitest";
import { renderConsole } from "../../test/index.js";
import { tamperWasRefused } from "./tamper-state.js";

it("offers all four simulator tampers in What's real and shows the policy refusal", async () => {
  const view = await renderConsole({
    path: "/judge",
    handlers: [
      http.post("*/v1/judge/sessions/:sid/tamper", () =>
        HttpResponse.json({
          kind: "amount",
          label: "Simulated tamper",
          simulated: true,
          runSlug: "2026A-r38",
          verdict: "DENY",
          decidedBy: ["invoiceEqualsQuote"],
          reasons: ["invoiceEqualsQuote refused overcharge"],
          armed: false,
          paypalCalls: 0,
          modelCalls: 0,
        }),
      ),
    ],
  });
  await view.startSession();
  fireEvent.click(screen.getByTestId("W-JG-01.whatsRealOpen"));
  const amount = await screen.findByTestId("W-JG-01.tamper.amount");
  for (const kind of ["offsetting", "recipient", "change_payout"])
    expect(screen.getByTestId(`W-JG-01.tamper.${kind}`)).toBeTruthy();
  await act(async () => fireEvent.click(amount));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(screen.queryByTestId("W-JG-01.tamper.error")?.textContent).toBeUndefined();
  expect((await screen.findByTestId("W-JG-01.tamper.result")).textContent).toMatch(/DENY|denied/i);
});

it("does not describe arming alone as a refused payout", () => {
  expect(tamperWasRefused([])).toBe(false);
  expect(
    tamperWasRefused([
      {
        type: "run.state",
        payload: { from: "APPROVED", to: "IN_REVIEW", cause: { code: "SEND_BACK", ref: "DIGEST_MISMATCH" } },
      },
    ] as never),
  ).toBe(true);
});
