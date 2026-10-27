// W-TR-07 Approve against the mock world: blocked until the holds are decided, the seal grown from the batch hash
// the API built, key 1 signed in this browser (over the dialog route and by holding Space for 1.6 s) with a
// signature that verifies over exactly the payload's JCS bytes, the Chair's key landing as an event, and MM-5's
// phases in full and reduced motion. Refusals: a changed batch signs nothing; the kill switch bolts the slab.

import { webRoutes } from "@fairsplit/contracts";
import { ed25519 } from "@noble/curves/ed25519.js";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../../data/query.js";
import type { RunView } from "../../data/run-view.js";
import { browserKey } from "../../features/approve/keys.js";
import { fromHex } from "../../lib/sha256.js";
import { clearMomentTrace, expectNoAxeViolations, renderConsole, tracedPhases } from "../../test/index.js";

const RUN = "2026A-r37";
const SLOW = 120_000;

async function readyToApprove(motion: "full" | "reduced" = "full") {
  const view = await renderConsole({ path: webRoutes.approve(RUN), viewport: { width: 1920 }, motion });
  await view.startSession();
  act(() => {
    view.world.markPaid();
    view.world.resolveAll();
  });
  const root = await screen.findByTestId("W-TR-07");
  await waitFor(() => expect(root.dataset.state).toBe("ready"));
  await waitFor(() => expect(screen.getByTestId("W-TR-07.batchHash").textContent).toMatch(/^[0-9a-f]{4} /));
  // The last blocking hold was decided live, so the slab rose (MM-5 rise): wait for it to be ready.
  await waitFor(() =>
    expect(root.querySelector("[data-moment='MM-5']")?.getAttribute("data-moment-phase")).toBe("ready"),
  );
  return { view, root };
}

function face(testId: string): HTMLElement {
  return screen.getByTestId(`${testId}.face`);
}

describe("W-TR-07 approve", () => {
  it(
    "is blocked while holds that change kilos are open, and links to the first one",
    async () => {
      const view = await renderConsole({ path: webRoutes.approve(RUN), viewport: { width: 1920 } });
      await view.startSession();
      act(() => {
        view.world.markPaid();
      });
      const root = await screen.findByTestId("W-TR-07");
      await waitFor(() => expect(root.dataset.state).toBe("blocked"));
      const slab = screen.getByTestId("W-TR-07.approve");
      expect(slab.dataset.state).toBe("unavailable");
      expect(screen.getByTestId("W-TR-07.approve.reason").textContent).toBe(
        "Resolve 3 holds that change kilos first",
      );
      expect(screen.getByTestId("W-TR-07.seal").dataset.state).toBe("keys-0");
      expect(screen.getByTestId("W-TR-07.batchHash").textContent).toBe("Not final yet");
      expect(within(screen.getByTestId("W-TR-07.blockedList")).getByText("H1").getAttribute("href")).toBe(
        webRoutes.holdDrawer(RUN, "H1"),
      );
      await expectNoAxeViolations(screen.getByTestId("W-TR-07"));
    },
    SLOW,
  );

  it(
    "signs key 1 over the dialog route; the signature verifies over the payload's JCS; Ernesto's key seals it",
    async () => {
      clearMomentTrace();
      const { view, root } = await readyToApprove();
      expect(screen.getByTestId("W-TR-07.amount").textContent).toMatch(/US\$368\.39/);
      expect(tracedPhases("MM-5")).toEqual(expect.arrayContaining(["blocked", "rising", "ready"]));
      expect(screen.getByTestId("W-TR-07.fees").textContent).toMatch(
        /Published rates, not fees PayPal reported/,
      );
      expect(screen.getByTestId("W-TR-07.safe").textContent).toMatch(
        /3 holds resolved\. 1 field entered by hand/,
      );
      expect(screen.getByTestId("W-TR-07.linesDigest").textContent).toMatch(
        /all 64 lines, the 56 cash lines too/,
      );
      await expectNoAxeViolations(screen.getByTestId("W-TR-07"));

      fireEvent.keyDown(face("W-TR-07.approve"), { key: "Enter" });
      const dialog = await screen.findByTestId("W-TR-07.approve.dialog");
      expect(dialog.textContent).toMatch(/US\$368\.39 to 8 members by PayPal/);
      expect(dialog.textContent).toMatch(/Consolacion Bacus/);
      fireEvent.keyDown(face("W-TR-07.approve.dialog.confirm"), { key: "Enter" });

      await waitFor(() => expect(root.dataset.state).toBe("key1"), { timeout: 10_000 });
      await waitFor(() => expect(screen.getByTestId("W-TR-07.seal").dataset.state).toBe("keys-1"));
      expect(screen.getByTestId("W-TR-07.key.treasurer").dataset.state).toBe("signed");
      expect(screen.getByTestId("W-TR-07.key.treasurer").textContent).toMatch(
        /fs-analyn-w1, Demo key \(this browser\)/,
      );

      const approval = view.world.approvals().find((a) => a.role === "treasurer");
      if (!approval) throw new Error("no treasurer approval");
      const key = await browserKey("fs-analyn-w1", RUN);
      const pub = fromHex(key.publicKeyHex);
      const sig = fromHex(approval.signatureHex);
      expect(pub && sig && ed25519.verify(sig, new TextEncoder().encode(approval.payloadJcs), pub)).toBe(
        true,
      );

      await waitFor(() => expect(tracedPhases("MM-5")).toContain("waiting-2"), { timeout: 5_000 });
      expect(screen.getByTestId("W-TR-07.presence").textContent).toBe("Waiting for Ernesto");

      act(() => {
        view.world.cosign();
      });
      await waitFor(() => expect(screen.getByTestId("W-TR-07.seal").dataset.state).toBe("keys-2"));
      await waitFor(() => expect(tracedPhases("MM-5").slice(-1)[0]).toBe("inked"), { timeout: 5_000 });
      const phases = tracedPhases("MM-5");
      expect(phases.slice(phases.lastIndexOf("signed-2"))).toEqual(["signed-2", "sealed", "inked"]);
      expect(phases).toEqual(
        expect.arrayContaining(["ready", "signed-1", "waiting-2", "signed-2", "sealed", "inked"]),
      );
      expect(root.dataset.state).toMatch(/approved|posting/);
      expect(screen.getByTestId("W-TR-07.approved").textContent).toMatch(/Approved by Analyn and Ernesto/);
    },
    SLOW,
  );

  it(
    "holding Space for 1.6 s signs; letting go early signs nothing and says hold until it clicks",
    async () => {
      clearMomentTrace();
      const { view, root } = await readyToApprove();
      const slab = face("W-TR-07.approve");
      slab.focus();
      fireEvent.keyDown(slab, { key: " " });
      await waitFor(() => expect(tracedPhases("MM-5")).toContain("hold-1"));
      await new Promise((r) => setTimeout(r, 300));
      fireEvent.keyUp(slab, { key: " " });
      await waitFor(() => expect(tracedPhases("MM-5")).toContain("released-early"));
      expect(screen.getByTestId("W-TR-07.approve.hint").textContent).toMatch(/Hold until it clicks/);
      expect(view.world.approvals()).toHaveLength(0);

      fireEvent.keyDown(face("W-TR-07.approve"), { key: " " });
      await waitFor(() => expect(root.dataset.state).toBe("key1"), { timeout: 10_000 });
      expect(view.world.approvals().filter((a) => a.role === "treasurer")).toHaveLength(1);
    },
    SLOW,
  );

  it(
    "reduced motion reaches the same phases: a stepped bar instead of travel",
    async () => {
      clearMomentTrace();
      const { view, root } = await readyToApprove("reduced");
      fireEvent.keyDown(face("W-TR-07.approve"), { key: " " });
      await waitFor(() => expect(screen.getByTestId("W-TR-07.approve.steps")).toBeTruthy());
      await waitFor(() => expect(root.dataset.state).toBe("key1"), { timeout: 10_000 });
      await waitFor(() => expect(tracedPhases("MM-5")).toContain("waiting-2"), { timeout: 5_000 });
      act(() => {
        view.world.cosign();
      });
      await waitFor(() => expect(tracedPhases("MM-5").slice(-1)[0]).toBe("inked"), { timeout: 5_000 });
      expect(tracedPhases("MM-5")).toEqual(
        expect.arrayContaining(["hold-1", "signed-1", "waiting-2", "signed-2", "sealed", "inked"]),
      );
    },
    SLOW,
  );

  it(
    "a batch that changed after it was shown signs nothing; the server's refusal reads mismatch too",
    async () => {
      clearMomentTrace();
      const { view, root } = await readyToApprove();
      act(() => {
        view.world.failNext("submitApproval", "DIGEST_MISMATCH");
      });
      fireEvent.keyDown(face("W-TR-07.approve"), { key: "Enter" });
      fireEvent.keyDown(face("W-TR-07.approve.dialog.confirm"), { key: "Enter" });
      await waitFor(() => expect(root.dataset.state).toBe("mismatch"), { timeout: 10_000 });
      expect(screen.getByTestId("W-TR-07.mismatch").textContent).toMatch(/Nothing was signed/);
      expect(tracedPhases("MM-5")).toContain("mismatch");
      expect(view.world.approvals()).toHaveLength(0);
      await expectNoAxeViolations(screen.getByTestId("W-TR-07"));
    },
    SLOW,
  );

  it(
    "the kill switch bolts the slab; PayPal declining the batch is red",
    async () => {
      const { view, root } = await readyToApprove();
      act(() => {
        view.runtime.client.setQueryData<RunView>(queryKeys.run(RUN), (old) =>
          old ? { ...old, flags: { ...old.flags, kill_payouts: true } } : old,
        );
      });
      await waitFor(() => expect(root.dataset.state).toBe("killed"));
      expect(screen.getByTestId("W-TR-07.approve").dataset.state).toBe("bolted");
      expect(screen.getByTestId("W-TR-07.killed").textContent).toBe("Payouts paused by the co-op.");
      act(() => {
        view.runtime.client.setQueryData<RunView>(queryKeys.run(RUN), (old) =>
          old ? { ...old, state: "DENIED" } : old,
        );
      });
      await waitFor(() => expect(root.dataset.state).toBe("denied"));
      expect(screen.getByTestId("W-TR-07.denied").dataset.tone).toBe("red");
    },
    SLOW,
  );

  it(
    "the showcase run is approved by two seeded sample keys",
    async () => {
      await renderConsole({ path: webRoutes.approve(RUN), viewport: { width: 1920 } });
      const root = await screen.findByTestId("W-TR-07");
      await waitFor(() => expect(root.dataset.state).toBe("approved"));
      expect(screen.getByTestId("W-TR-07.seal").dataset.state).toBe("keys-2");
      expect(screen.getByTestId("W-TR-07.key.chair").textContent).toMatch(/Sample key \(seeded\)/);
      expect(screen.getByTestId("W-TR-07.batchHash").textContent).toMatch(/^0f83 9be7/);
      await expectNoAxeViolations(root);
    },
    SLOW,
  );
});
