// W-TR-07 Approve against the mock world: blocked until the holds are decided, the seal grown from the batch hash
// the API built, key 1 signed in this browser with the session's registered demo key (fs-analyn-demo-{6}, C-13),
// over the dialog route and by holding Space until the slab arms at 1.6 s and then letting go inside (nothing is
// sent before the release), with a signature that verifies over exactly the payload's JCS bytes and a lines root
// this browser recomputed, the Chair's key landing as an event, and MM-5's phases in full and reduced motion. Refusals: no batch on screen signs nothing (the payload still loading or
// failed); a changed batch signs nothing; an expired approval asks to sign again; a send the server never
// answered goes again under the same Idempotency-Key, while a 501 is said at once; the Chair's decline voids key
// 1; the kill switch bolts the slab. Every state is axe-clean.

import { urlPattern } from "@fairsplit/api-client/msw";
import { API_COMMANDS, webRoutes } from "@fairsplit/contracts";
import { ed25519 } from "@noble/curves/ed25519.js";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http, type RequestHandler } from "msw";
import { describe, expect, it } from "vitest";
import { CHAIR, createMockDriver } from "../../data/mock/driver.js";
import { workspaceLines } from "../../data/mock/fidelity.js";
import { queryKeys } from "../../data/query.js";
import type { RunView } from "../../data/run-view.js";
import { heldSessionKey } from "../../features/approve/keys.js";
import { linesRoot } from "../../lib/lines-root.js";
import { fromHex } from "../../lib/sha256.js";
import {
  clearMomentTrace,
  createTestWorld,
  expectNoAxeViolations,
  focusAcrossRemoval,
  renderConsole,
  seedSnapshot,
  type TestWorld,
  tracedPhases,
} from "../../test/index.js";

const RUN = "2026A-r37";
const SLOW = 120_000;

/** Puts a handler in front of the mock API's own (it answers, or returns nothing to pass the request on). */
function intercept(world: TestWorld, handler: RequestHandler): void {
  (world.mock.handlers as RequestHandler[]).unshift(handler);
}

/** Every Idempotency-Key the console sent with submitApproval, in order (the request then goes on to the mock). */
function recordSubmits(world: TestWorld): (string | null)[] {
  const keys: (string | null)[] = [];
  intercept(
    world,
    http.post(urlPattern(API_COMMANDS.submitApproval.path), ({ request }) => {
      keys.push(request.headers.get("Idempotency-Key"));
    }),
  );
  return keys;
}

/** Holds Space on the slab for longer than the 1.6 s commit, then lets go. */
async function holdSpace(testId: string, ms = 1_800): Promise<void> {
  const slab = face(testId);
  slab.focus();
  fireEvent.keyDown(slab, { key: " " });
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
  fireEvent.keyUp(slab, { key: " " });
}

async function signKey1(root: HTMLElement): Promise<void> {
  fireEvent.keyDown(face("W-TR-07.approve"), { key: "Enter" });
  await screen.findByTestId("W-TR-07.approve.dialog");
  fireEvent.keyDown(face("W-TR-07.approve.dialog.confirm"), { key: "Enter" });
  await waitFor(() => expect(root.dataset.state).toBe("key1"), { timeout: 10_000 });
}

async function readyToApprove(motion: "full" | "reduced" = "full", world?: TestWorld) {
  const view = await renderConsole({
    path: webRoutes.approve(RUN),
    viewport: { width: 1920 },
    motion,
    ...(world ? { world } : {}),
  });
  const session = await view.startSession();
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
  return { view, root, session };
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
    "the blocked list names a hold whose label is its kind's own word once ('Mass balance', not twice)",
    async () => {
      const view = await renderConsole({ path: webRoutes.approve(RUN), viewport: { width: 1920 } });
      await view.startSession();
      act(() => {
        view.world.markPaid();
        view.world.enterByHand();
      });
      await waitFor(() =>
        expect(screen.getByTestId("W-TR-07.blockedList").textContent).toMatch(/Mass balance/),
      );
      const list = screen.getByTestId("W-TR-07.blockedList");
      for (const item of within(list).getAllByRole("listitem")) {
        const words = item.textContent ?? "";
        expect(words).not.toMatch(/Mass balance\s*Mass balance/i);
        const caption = item.querySelector(".fsr-muted")?.textContent ?? "";
        const label = item.querySelector("a")?.textContent ?? "";
        expect(caption.toLowerCase()).not.toBe(label.toLowerCase());
      }
    },
    SLOW,
  );

  it(
    "signs key 1 over the dialog route; the signature verifies over the payload's JCS; Ernesto's key seals it",
    async () => {
      clearMomentTrace();
      const { view, root, session } = await readyToApprove();
      expect(screen.getByTestId("W-TR-07.amount").textContent).toMatch(/US\$368\.39/);
      expect(tracedPhases("MM-5")).toEqual(expect.arrayContaining(["blocked", "rising", "ready"]));
      expect(screen.getByTestId("W-TR-07.fees").textContent).toMatch(
        /Published rates, not fees PayPal reported/,
      );
      expect(screen.getByTestId("W-TR-07.safe").textContent).toMatch(
        /3 holds resolved\. 1 field entered by hand/,
      );
      // The payload's lines root (IC-02) prints beside what two people sign, once this browser has recomputed it
      // from the run's own lines: the workspace's, whose returned mark (M-018) has the workspace's own mark ID, so
      // its root is not the seed's.
      const root64 = linesRoot(workspaceLines(view.world));
      expect(root64).not.toBe(linesRoot(seedSnapshot().checkpoints.resolved.lines));
      expect(screen.getByTestId("W-TR-07.linesDigest").getAttribute("title")).toBe(root64);
      // The decision comes first (seal, amount, rails with their fees, why it is safe, the slab, the keys); what
      // both keys sign follows it, for a person to compare by eye.
      const order = [
        "W-TR-07.seal",
        "W-TR-07.amount",
        "W-TR-07.rail",
        "W-TR-07.fees",
        "W-TR-07.safe",
        "W-TR-07.approve",
        "W-TR-07.keys",
        "W-TR-07.ledger",
      ].map((id) => screen.getByTestId(id));
      for (let i = 1; i < order.length; i++) {
        const before = order[i - 1] as HTMLElement;
        const after = order[i] as HTMLElement;
        expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      // Before any key, the seal is this batch's own pattern in pencil, never empty rings.
      expect(screen.getByTestId("W-TR-07.sealGhost").querySelectorAll("path")).toHaveLength(5);
      await expectNoAxeViolations(screen.getByTestId("W-TR-07"));

      fireEvent.keyDown(face("W-TR-07.approve"), { key: "Enter" });
      const dialog = await screen.findByTestId("W-TR-07.approve.dialog");
      expect(dialog.textContent).toMatch(
        /Sends 8 payouts, US\$368\.39, through the simulated PayPal sandbox/,
      );
      expect(dialog.textContent).toMatch(/Consolacion Bacus/);
      expect(tracedPhases("MM-5")).toContain("confirm-1");
      fireEvent.keyDown(face("W-TR-07.approve.dialog.confirm"), { key: "Enter" });

      await waitFor(() => expect(root.dataset.state).toBe("key1"), { timeout: 10_000 });
      await waitFor(() => expect(screen.getByTestId("W-TR-07.seal").dataset.state).toBe("keys-1"));
      expect(screen.getByTestId("W-TR-07.key.treasurer").dataset.state).toBe("signed");
      // The session's demo key, as fs-api registered it (C-13): never the treasurer's own fs-analyn-w1.
      expect(screen.getByTestId("W-TR-07.key.treasurer").textContent).toMatch(
        /fs-analyn-demo-[a-z0-9]{6}, Demo key \(this browser\)/,
      );
      expect(screen.getByTestId("W-TR-07.key.treasurer").textContent).not.toMatch(/fs-analyn-w1/);

      const approval = view.world.approvals().find((a) => a.role === "treasurer");
      if (!approval) throw new Error("no treasurer approval");
      const held = heldSessionKey(`${session.sessionId}:treasurer:analyn`);
      if (!held) throw new Error("no session key");
      const key = await held;
      expect(approval.keyId).toBe(key.keyId);
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
    "inv.i4 with H3 still open it signs the run's own lines (M-018 held), and again once H3 returns the mark",
    async () => {
      const view = await renderConsole({ path: webRoutes.approve(RUN), viewport: { width: 1920 } });
      await view.startSession();
      act(() => {
        view.world.markPaid();
        view.world.enterByHand();
        view.world.resolve("H1");
        view.world.resolve("H2");
      });
      const root = await screen.findByTestId("W-TR-07");
      await waitFor(() =>
        expect(screen.getByTestId("W-TR-07.batchHash").textContent).toMatch(/^[0-9a-f]{4} /),
      );
      expect(view.world.hold("H3")?.state).toBe("OPEN");
      const digest = () => screen.getByTestId("W-TR-07.linesDigest").getAttribute("title");
      await waitFor(() => expect(digest()).toBe(linesRoot(workspaceLines(view.world))));
      expect(root.dataset.state).toBe("ready");
      const held = digest();

      // H3 returns the multa as a credit: the run's lines change, and the screen reads them (and the batch) again.
      act(() => {
        view.world.resolve("H3");
      });
      await waitFor(() => expect(digest()).toBe(linesRoot(workspaceLines(view.world))));
      expect(digest()).not.toBe(held);
      expect(root.dataset.state).toBe("ready");
      await waitFor(() =>
        expect(screen.getByTestId("W-TR-07.approve").dataset.state).not.toBe("unavailable"),
      );
      await signKey1(root);
      expect(view.world.approvals().filter((a) => a.role === "treasurer")).toHaveLength(1);
    },
    SLOW,
  );

  it(
    "inv.i4 a payload whose lines root is not the run's served lines reads mismatch and signs nothing",
    async () => {
      const world = createTestWorld();
      intercept(
        world,
        http.get("*/v1/runs/:runSlug/lines", () =>
          HttpResponse.json({
            runSlug: world.runSlug,
            lines: workspaceLines(world).map((l) =>
              l.memberNo === "M-064" ? { ...l, lineSha256: "0".repeat(64) } : l,
            ),
          }),
        ),
      );
      const sent = recordSubmits(world);
      const view = await renderConsole({ path: webRoutes.approve(RUN), viewport: { width: 1920 }, world });
      await view.startSession();
      act(() => {
        view.world.markPaid();
        view.world.resolveAll();
      });
      const root = await screen.findByTestId("W-TR-07");
      await waitFor(() => expect(root.dataset.state).toBe("mismatch"));
      expect(screen.getByTestId("W-TR-07.mismatch").textContent).toMatch(/Nothing was signed/);
      await holdSpace("W-TR-07.approve");
      fireEvent.keyDown(face("W-TR-07.approve"), { key: "Enter" });
      expect(screen.queryByTestId("W-TR-07.approve.dialog")).toBeNull();
      expect(sent).toHaveLength(0);
      expect(view.world.approvals()).toHaveLength(0);
      await expectNoAxeViolations(root);
    },
    SLOW,
  );

  it(
    "holding Space arms the slab at 1.6 s and letting go inside signs; letting go early signs nothing",
    async () => {
      clearMomentTrace();
      const world = createTestWorld();
      const sent = recordSubmits(world);
      const { view, root } = await readyToApprove("full", world);
      const slab = face("W-TR-07.approve");
      slab.focus();
      fireEvent.keyDown(slab, { key: " " });
      await waitFor(() => expect(tracedPhases("MM-5")).toContain("hold-1"));
      await new Promise((r) => setTimeout(r, 300));
      fireEvent.keyUp(slab, { key: " " });
      await waitFor(() => expect(tracedPhases("MM-5")).toContain("released-early"));
      expect(screen.getByTestId("W-TR-07.approve.hint").textContent).toMatch(/Hold until it clicks/);
      expect(view.world.approvals()).toHaveLength(0);

      // Held past 1.6 s the slab arms ("Release to sign"): MM-5 armed-1, and still nothing is sent.
      fireEvent.keyDown(face("W-TR-07.approve"), { key: " " });
      await waitFor(() => expect(screen.getByTestId("W-TR-07.approve").dataset.state).toBe("armed"), {
        timeout: 5_000,
      });
      expect(tracedPhases("MM-5")).toContain("armed-1");
      expect(sent).toHaveLength(0);
      expect(view.world.approvals()).toHaveLength(0);
      fireEvent.keyUp(face("W-TR-07.approve"), { key: " " });
      await waitFor(() => expect(root.dataset.state).toBe("key1"), { timeout: 10_000 });
      expect(sent).toHaveLength(1);
      expect(view.world.approvals().filter((a) => a.role === "treasurer")).toHaveLength(1);
      const phases = tracedPhases("MM-5");
      expect(phases.indexOf("armed-1")).toBeLessThan(phases.lastIndexOf("signed-1"));
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
      await waitFor(() => expect(screen.getByTestId("W-TR-07.approve").dataset.state).toBe("armed"), {
        timeout: 5_000,
      });
      fireEvent.keyUp(face("W-TR-07.approve"), { key: " " });
      await waitFor(() => expect(root.dataset.state).toBe("key1"), { timeout: 10_000 });
      await waitFor(() => expect(tracedPhases("MM-5")).toContain("waiting-2"), { timeout: 5_000 });
      act(() => {
        view.world.cosign();
      });
      await waitFor(() => expect(tracedPhases("MM-5").slice(-1)[0]).toBe("inked"), { timeout: 5_000 });
      expect(tracedPhases("MM-5")).toEqual(
        expect.arrayContaining(["hold-1", "armed-1", "signed-1", "waiting-2", "signed-2", "sealed", "inked"]),
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

  it(
    "inv.i4 while the batch to sign is still loading, the slab waits and holding it signs nothing",
    async () => {
      clearMomentTrace();
      const world = createTestWorld();
      // The approval payload never answers: no batch hash reaches the seal or the dialog.
      intercept(
        world,
        http.get(urlPattern(API_COMMANDS.approvalPayload.path), () => new Promise<never>(() => undefined)),
      );
      const sent = recordSubmits(world);
      const view = await renderConsole({ path: webRoutes.approve(RUN), viewport: { width: 1920 }, world });
      await view.startSession();
      act(() => {
        view.world.markPaid();
        view.world.resolveAll();
      });
      const root = await screen.findByTestId("W-TR-07");
      await waitFor(() => expect(root.dataset.state).toBe("ready"));
      const slab = screen.getByTestId("W-TR-07.approve");
      await waitFor(() => expect(slab.dataset.state).toBe("unavailable"));
      expect(screen.getByTestId("W-TR-07.approve.reason").textContent).toBe("Preparing the batch to sign");
      expect(screen.getByTestId("W-TR-07.batchHash").textContent).toBe("Not final yet");
      expect(screen.getByTestId("W-TR-07.seal").dataset.state).toBe("keys-0");
      expect(screen.queryByTestId("W-TR-07.payload.error")).toBeNull();

      await holdSpace("W-TR-07.approve");
      fireEvent.keyDown(face("W-TR-07.approve"), { key: "Enter" });
      expect(screen.queryByTestId("W-TR-07.approve.dialog")).toBeNull();
      expect(tracedPhases("MM-5")).not.toContain("hold-1");
      expect(sent).toHaveLength(0);
      expect(view.world.approvals()).toHaveLength(0);
      expect(root.dataset.state).toBe("ready");
      await expectNoAxeViolations(root);
    },
    SLOW,
  );

  it(
    "inv.i4 a batch to sign that failed to load says so with a retry, signs nothing, then arms once loaded",
    async () => {
      clearMomentTrace();
      const world = createTestWorld();
      const sent = recordSubmits(world);
      world.failNext("approvalPayload", "INTERNAL");
      const view = await renderConsole({ path: webRoutes.approve(RUN), viewport: { width: 1920 }, world });
      await view.startSession();
      act(() => {
        view.world.markPaid();
        view.world.resolveAll();
      });
      const root = await screen.findByTestId("W-TR-07");
      await waitFor(() => expect(root.dataset.state).toBe("ready"));
      const notice = await screen.findByTestId("W-TR-07.payload.error");
      expect(notice.textContent).toMatch(/The server failed on this step\. Nothing changed\./);
      expect(screen.getByTestId("W-TR-07.approve").dataset.state).toBe("unavailable");
      expect(screen.getByTestId("W-TR-07.approve.reason").textContent).toBe(
        "The batch to sign didn't load. Load it again",
      );
      expect(screen.getByTestId("W-TR-07.batchHash").textContent).toBe("Not final yet");
      await expectNoAxeViolations(root);

      await holdSpace("W-TR-07.approve");
      expect(tracedPhases("MM-5")).not.toContain("hold-1");
      expect(sent).toHaveLength(0);
      expect(view.world.approvals()).toHaveLength(0);

      fireEvent.click(within(notice).getByTestId("W-TR-07.payload.error.retry"));
      await waitFor(() =>
        expect(screen.getByTestId("W-TR-07.batchHash").textContent).toMatch(/^[0-9a-f]{4} /),
      );
      await waitFor(() =>
        expect(screen.getByTestId("W-TR-07.approve").dataset.state).not.toBe("unavailable"),
      );
      expect(screen.queryByTestId("W-TR-07.payload.error")).toBeNull();
      await signKey1(root);
      expect(sent).toHaveLength(1);
    },
    SLOW,
  );

  it(
    "an expired approval signs nothing, says so, and Sign again starts over",
    async () => {
      clearMomentTrace();
      const { view, root } = await readyToApprove();
      act(() => {
        view.world.failNext("submitApproval", "APPROVAL_EXPIRED");
      });
      fireEvent.keyDown(face("W-TR-07.approve"), { key: "Enter" });
      fireEvent.keyDown(face("W-TR-07.approve.dialog.confirm"), { key: "Enter" });
      await waitFor(() => expect(root.dataset.state).toBe("expired"), { timeout: 10_000 });
      expect(screen.getByTestId("W-TR-07.expired").textContent).toMatch(
        /The co-sign request expired\. Send again\./,
      );
      expect(screen.getByTestId("W-TR-07.approve").dataset.state).toBe("unavailable");
      expect(screen.getByTestId("W-TR-07.approve.reason").textContent).toBe("Sign again");
      expect(tracedPhases("MM-5")).toContain("expired");
      expect(view.world.approvals()).toHaveLength(0);
      await expectNoAxeViolations(root);

      fireEvent.click(screen.getByTestId("W-TR-07.approve.reason"));
      await waitFor(() => expect(root.dataset.state).toBe("ready"));
      await waitFor(() =>
        expect(screen.getByTestId("W-TR-07.approve").dataset.state).not.toBe("unavailable"),
      );
      await signKey1(root);
      expect(view.world.approvals().filter((a) => a.role === "treasurer")).toHaveLength(1);
    },
    SLOW,
  );

  it(
    "a send the server never answered goes again under the same Idempotency-Key and counts once",
    async () => {
      const world = createTestWorld();
      const sent = recordSubmits(world);
      const { view, root } = await readyToApprove("full", world);
      act(() => {
        view.world.failNext("submitApproval", "INTERNAL");
      });
      fireEvent.keyDown(face("W-TR-07.approve"), { key: "Enter" });
      fireEvent.keyDown(face("W-TR-07.approve.dialog.confirm"), { key: "Enter" });
      const banner = await screen.findByTestId("W-TR-07.resending", {}, { timeout: 5_000 });
      expect(banner.textContent).toBe(
        "The server didn't answer. Sending your signature again with the same request ID, so it counts once. Send 2 of 4.",
      );
      // The browser's own resend is not S1.7's retrying (that one is PayPal's): the run's state stands.
      expect(root.dataset.state).toBe("ready");
      expect(screen.queryByTestId("W-TR-07.retrying")).toBeNull();
      await expectNoAxeViolations(root);

      await waitFor(() => expect(root.dataset.state).toBe("key1"), { timeout: 10_000 });
      expect(sent).toHaveLength(2);
      expect(sent[0]).toMatch(/^approval-/);
      expect(sent[1]).toBe(sent[0]);
      expect(view.world.approvals().filter((a) => a.role === "treasurer")).toHaveLength(1);
      expect(screen.queryByTestId("W-TR-07.resending")).toBeNull();
      expect(screen.queryByTestId("W-TR-07.error")).toBeNull();
    },
    SLOW,
  );

  it(
    "a step the server has not wired yet (501) is said at once and never sent again",
    async () => {
      const world = createTestWorld();
      const sent: (string | null)[] = [];
      intercept(
        world,
        http.post(urlPattern(API_COMMANDS.submitApproval.path), ({ request }) => {
          sent.push(request.headers.get("Idempotency-Key"));
          return HttpResponse.json(
            {
              code: "INTERNAL",
              status: 501,
              message: "submitApproval is registered but not implemented yet.",
              details: { reason: "NOT_IMPLEMENTED" },
            },
            { status: 501, headers: { "X-FS-Rail": "simulated" } },
          );
        }),
      );
      const { root } = await readyToApprove("full", world);
      fireEvent.keyDown(face("W-TR-07.approve"), { key: "Enter" });
      fireEvent.keyDown(face("W-TR-07.approve.dialog.confirm"), { key: "Enter" });
      // Sending a 501 again would hold the notice back for 6.5 s of backoff: it is the answer, shown at once.
      const notice = await screen.findByTestId("W-TR-07.error", {}, { timeout: 1_500 });
      expect(notice.textContent).toMatch(/This step isn't wired on the server yet\. Nothing changed\./);
      expect(sent).toHaveLength(1);
      expect(screen.queryByTestId("W-TR-07.resending")).toBeNull();
      expect(root.dataset.state).toBe("ready");
      await new Promise((r) => setTimeout(r, 700));
      expect(sent).toHaveLength(1);
      await expectNoAxeViolations(root);
    },
    SLOW,
  );

  it(
    "the Chair sends the batch back: his reason in his ink, key 1 voided, the batch pencil, sign again",
    async () => {
      clearMomentTrace();
      const { view, root } = await readyToApprove();
      await signKey1(root);
      await waitFor(() => expect(screen.getByTestId("W-TR-07.seal").dataset.state).toBe("keys-1"));
      act(() => {
        view.world.command("declineApproval", {
          params: { runSlug: view.world.runSlug },
          body: { role: "chair", reason: "Check Merlyn's second plot before I sign." },
          as: CHAIR,
        });
      });
      await waitFor(() => expect(root.dataset.state).toBe("declined"), { timeout: 5_000 });
      const banner = screen.getByTestId("W-TR-07.declined");
      expect(banner.textContent).toMatch(
        /Ernesto sent the batch back: Check Merlyn's second plot before I sign\./,
      );
      expect(banner.textContent).toMatch(/EC/);
      expect(banner.textContent).toMatch(/Fix what he asked, then approve again\./);
      expect(screen.getByTestId("W-TR-07.seal").dataset.state).toBe("keys-0");
      expect(screen.getByTestId("W-TR-07.key.treasurer").dataset.state).toBe("waiting");
      expect(
        screen
          .getByTestId("W-TR-07.amount")
          .closest("[data-amount-state]")
          ?.getAttribute("data-amount-state"),
      ).toBe("pencil");
      await waitFor(() => expect(tracedPhases("MM-5")).toContain("declined"));
      await waitFor(() =>
        expect(screen.getByTestId("W-TR-07.approve").dataset.state).not.toBe("unavailable"),
      );
      await expectNoAxeViolations(root);

      await signKey1(root);
      expect(screen.queryByTestId("W-TR-07.declined")).toBeNull();
      expect(screen.getByTestId("W-TR-07.key.treasurer").dataset.state).toBe("signed");
    },
    SLOW,
  );

  it(
    "posting: both keys in, the outbox posts the batch, and the screen links to the payments landing",
    async () => {
      const { view, root } = await readyToApprove();
      await signKey1(root);
      // Ernesto's key, with the outbox's steps left queued: the run stops at each one.
      const chair = createMockDriver(view.world.mock.world, { settle: false });
      act(() => {
        chair.cosign();
      });
      await waitFor(() => expect(root.dataset.state).toBe("approved"), { timeout: 5_000 });
      act(() => {
        view.world.advance(1);
      });
      await waitFor(() => expect(root.dataset.state).toBe("posting"), { timeout: 5_000 });
      expect(screen.getByTestId("W-TR-07.posting").textContent).toMatch(
        /^Posting batch 2026A-[0-9a-f]{8}-r37\. The Payouts tool re-hashed the batch: it matches\./,
      );
      expect(screen.getByTestId("W-TR-07.approved").textContent).toMatch(/Approved by Analyn and Ernesto/);
      expect(screen.getByTestId("W-TR-07.fanout").getAttribute("href")).toBe(webRoutes.fanout(RUN));
      expect(screen.getByTestId("W-TR-07.seal").dataset.state).toBe("keys-2");
      expect(screen.queryByTestId("W-TR-07.retrying")).toBeNull();
      await expectNoAxeViolations(root);
    },
    SLOW,
  );

  it(
    "'see the fan-out' takes its screen away with the focus it held: focus goes on to the fan-out's screen, never <body>",
    async () => {
      const { view, root } = await readyToApprove();
      await signKey1(root);
      const chair = createMockDriver(view.world.mock.world, { settle: false });
      act(() => {
        chair.cosign();
      });
      await waitFor(() => expect(root.dataset.state).toBe("approved"), { timeout: 5_000 });
      act(() => {
        view.world.advance(1);
      });
      await waitFor(() => expect(root.dataset.state).toBe("posting"), { timeout: 5_000 });
      const link = screen.getByTestId("W-TR-07.fanout");
      link.focus();
      const sampled = focusAcrossRemoval("W-TR-07.fanout");
      try {
        // Enter on the link, or a press: its click, which pushes the route (AppLink).
        await act(async () => {
          fireEvent.click(link);
        });
        await screen.findByTestId("W-TR-08");
        await sampled.frame();
        await sampled.frame();
      } finally {
        sampled.restore();
      }
      expect(view.router.state.location.pathname).toBe(webRoutes.fanout(RUN));
      expect(sampled.removals()).toBe(1);
      const main = document.getElementById("fsc-main");
      // Before anything could paint, and on each frame after: on a control of the new screen.
      for (const at of [...sampled.settled, ...sampled.samples.slice(1)]) {
        expect(at).not.toBe(document.body);
        expect(at === main || Boolean(main?.contains(at))).toBe(true);
      }
      expect(screen.getByTestId("W-TR-08").contains(document.activeElement)).toBe(true);
    },
    SLOW,
  );
});
