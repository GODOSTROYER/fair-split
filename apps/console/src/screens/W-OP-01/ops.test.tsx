// W-OP-01 /ops against the mock world: health in words (the mock serves /healthz only, and the page says the rest
// isn't served yet), the three kill switches read-only, PayPal's notices from the season's hash chain or a judge's
// live run, the outbox's honest "not served yet", and the treasurer's non-extractable browser key.

import { webcrypto } from "node:crypto";
import { webRoutes } from "@fairsplit/contracts";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataProvider } from "../../data/provider.js";
import { memoryKeyStore, TREASURER_KEY_ID } from "../../features/ops/keystore.js";
import { KeyPanel } from "../../features/ops/OpsPage.js";
import { useTreasurerKey } from "../../features/ops/useOps.js";
import { createTestRuntime, expectNoAxeViolations, renderConsole } from "../../test/index.js";

async function openOps() {
  const view = await renderConsole({ path: webRoutes.ops() });
  const root = await screen.findByTestId("W-OP-01");
  await waitFor(() => expect(root.dataset.state).not.toBe("loading"));
  return { view, root };
}

describe("W-OP-01 /ops", () => {
  it("reads health in words, the switches read-only, and the season's PayPal notices", async () => {
    const { view, root } = await openOps();
    expect(root.dataset.state).toBe("ready");
    expect(document.documentElement.dataset.theme).toBe("tablea");
    await waitFor(() =>
      expect(screen.getByTestId("W-OP-01.health.ready").textContent).toContain("Not served yet"),
    );
    const live = screen.getByTestId("W-OP-01.health.live");
    expect(live.textContent).toContain("Up");
    expect(live.textContent).toContain("mock API");
    expect(live.textContent).toContain("Simulated PayPal sandbox");

    for (const flag of ["kill_payouts", "kill_paypal_live", "kill_ai_live"]) {
      const row = screen.getByTestId(`W-OP-01.switch.${flag}`);
      expect(row.dataset.state).toBe("off");
      expect(row.textContent).toContain("No change recorded");
    }
    expect(within(screen.getByTestId("W-OP-01.switches")).queryByRole("switch")).toBeNull();

    const notices = screen.getByTestId("W-OP-01.notices.table");
    expect(notices.textContent).toContain("PAYMENT.PAYOUTS-ITEM.SUCCEEDED");
    expect(notices.textContent).toContain("r37-M-014");
    expect(notices.textContent).toContain("Signature checked (simulator's CA)");
    expect(notices.textContent).not.toMatch(/Signature verified/);

    await waitFor(() => expect(screen.getByTestId("W-OP-01.outbox.not-served")).toBeTruthy());
    expect(screen.getByTestId("W-OP-01.checked").textContent).toContain("Davao time");
    await expectNoAxeViolations(view.container);
  });

  it("asks again only when a person presses Check again (nothing polls)", async () => {
    await openOps();
    const refresh = screen.getByTestId("W-OP-01.refresh");
    fireEvent.click(refresh);
    await waitFor(() => expect(screen.getByTestId("W-OP-01.checked").textContent).toContain("Checked at"));
  });

  it("follows a judge's own run: its live PayPal notices replace the season's", async () => {
    const view = await renderConsole({ path: webRoutes.ops() });
    await view.startSession();
    await screen.findByTestId("W-OP-01");
    await waitFor(() => expect(screen.getByTestId("W-OP-01.notices.empty")).toBeTruthy());
    act(() => {
      view.world.markPaid();
      view.world.resolveAll();
      view.world.sign("treasurer");
      view.world.cosign();
    });
    const table = await screen.findByTestId("W-OP-01.notices.table", {}, { timeout: 10_000 });
    expect(table.textContent).toContain("Payout item");
    expect(table.textContent).toContain("Webhook, signature checked (simulator)");
    await expectNoAxeViolations(view.container);
  });
});

function KeyHarness() {
  const key = useTreasurerKey({
    store: memoryKeyStore(),
    subtle: webcrypto.subtle as unknown as SubtleCrypto,
  });
  return <KeyPanel treasurerKey={key} />;
}

describe("the treasurer's browser key (fs-analyn-w1)", () => {
  it("is made non-extractable in this browser, then registered (not served by this mock yet)", async () => {
    const { runtime } = createTestRuntime();
    const view = render(
      <DataProvider runtime={runtime}>
        <KeyHarness />
      </DataProvider>,
    );
    const panel = await screen.findByTestId("W-OP-01.key.panel");
    await waitFor(() => expect(panel.dataset.state).toBe("none"));
    fireEvent.keyDown(screen.getByTestId("W-OP-01.key.make.face"), { key: "Enter" });
    await waitFor(() => expect(panel.dataset.state).toBe("made"));
    expect(screen.getByTestId("W-OP-01.key.fingerprint").textContent).toMatch(
      /^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/,
    );
    expect(panel.textContent).toContain("For this page only");
    expect(panel.textContent).toContain(TREASURER_KEY_ID);

    fireEvent.keyDown(screen.getByTestId("W-OP-01.key.register.face"), { key: "Enter" });
    await waitFor(() => expect(panel.dataset.state).toBe("not-served"));
    expect(screen.getByTestId("W-OP-01.key.status").textContent).toContain("POST /v1/ops/keys");
    await expectNoAxeViolations(view.container);
  });

  it("makes a key whose private half can't be exported", async () => {
    const { makeKey } = await import("../../features/ops/keystore.js");
    const key = await makeKey(
      TREASURER_KEY_ID,
      "treasurer:analyn",
      undefined,
      webcrypto.subtle as unknown as SubtleCrypto,
    );
    expect(key.keys.privateKey.extractable).toBe(false);
    expect(key.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    await expect(webcrypto.subtle.exportKey("pkcs8", key.keys.privateKey as never)).rejects.toThrow();
  });
});
