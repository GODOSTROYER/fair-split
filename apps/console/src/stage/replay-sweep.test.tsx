import { getSnapshot } from "@fairsplit/api-client/seed";
import { webRoutes } from "@fairsplit/contracts";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { getResponse, HttpResponse, http } from "msw";
import { expect, it } from "vitest";
import { nextStep } from "../chrome/next-step.js";
import { applyRunEvent, type RunView, showcaseView } from "../data/run-view.js";
import { renderConsole } from "../test/render.js";
import { WEB_ROUTE_CASES } from "../test/route-cases.js";
import { createTestWorld } from "../test/world.js";

const snapshot = getSnapshot();
const RUN = snapshot.run.runSlug;
const SEASON = "2026-A";

// Every product route in the same table as routes.test, plus the PayPal member's 80 mm print.
const routes = [
  ...WEB_ROUTE_CASES.map(({ path, screens }) => [path, screens[screens.length - 1] as string] as const),
  [webRoutes.memberPrint(RUN, "M-014"), "W-TR-09"],
] as const;

function fixture(replayed: boolean): RunView {
  const base = showcaseView(snapshot);
  const provenance = replayed ? "replay" : "simulated_rail";
  const view = {
    ...base,
    origin: "session",
    items: Object.fromEntries(Object.entries(base.items).map(([id, item]) => [id, { ...item, provenance }])),
  } as RunView;
  return applyRunEvent(view, {
    id: "9999",
    ws: "test",
    runId: snapshot.run.id,
    at: "2026-11-01T00:00:00Z",
    type: "item.updated",
    provenance,
    actor: { kind: "paypal", id: "simulator", impersonatedBy: null },
    payload: {
      itemId: "test-item",
      rank: 2,
      senderItemId: "r37-M-014",
      memberNo: "M-014",
      from: "PENDING",
      to: "SUCCESS",
      payoutItemId: "RPLY-test",
      eventId: null,
      source: "status_check",
    },
  });
}

function assertPayouts(root: HTMLElement, replayed: boolean) {
  // Invoice settlement and cash attestation are distinct. Check payout rows, threads, chips and figures.
  const surfaces = root.querySelectorAll<HTMLElement>(
    '[data-testid^="W-TR-05.status."], [data-testid^="W-PF-01.item."], [data-testid^="W-PF-01.line."], ' +
      '[data-testid="W-TR-09.line"], [data-testid="W-TR-09.paper"], [data-testid="W-JG-01.poster.member"], ' +
      '[data-testid="W-PF-01.tier.paypal"], [data-testid^="W-TR-08.label."], [data-testid="W-PF-01.trace.receipt"], .fsr-line__history li',
  );
  let checked = 0;
  for (const surface of surfaces) {
    const payout = /replay|simulated|PayPal|Bayad na|Paid/.test(surface.textContent ?? "");
    if (!payout) continue;
    checked++;
    if (replayed) {
      expect(
        surface.matches(
          '[data-tone="jade"], [data-tone="landed"], [data-amount-state="landed"], .fs-capsule[data-state="paid"]',
        ),
        surface.outerHTML,
      ).toBe(false);
      expect(
        surface.querySelector(
          '[data-tone="jade"], [data-tone="landed"], [data-amount-state="landed"], .fs-capsule[data-state="paid"]',
        ),
        surface.outerHTML,
      ).toBeNull();
      expect(surface.textContent, surface.outerHTML).toMatch(/replay/i);
    } else expect(surface.textContent).not.toMatch(/replay/i);
  }
  return checked;
}

it.each(["live", "replay-bundle", "replay-stream"] as const)(
  "inv.i8.all routed payout surfaces and frame posters use their own evidence (%s)",
  async (mode) => {
    const replayed = mode !== "live";
    const world = createTestWorld();
    const proof = http.get(/\/v1\/proof\/[^/]+(?:\/export)?$/, async ({ request }) => {
      const response = await getResponse([...world.mock.handlers], request);
      const body = await response?.json();
      const rewrite = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(rewrite);
        if (!v || typeof v !== "object") return v;
        if (mode === "replay-bundle" && "senderItemId" in v && "amountCents" in v && "status" in v)
          return { ...v, provenance: "replay" };
        return Object.fromEntries(
          Object.entries(v).map(([k, value]) => [
            k,
            k === "provenance" && (value === "simulated_rail" || value === "seeded")
              ? mode === "replay-bundle"
                ? "replay"
                : value
              : rewrite(value),
          ]),
        );
      };
      return new HttpResponse(JSON.stringify(rewrite(body)), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const rendered = await renderConsole({
      path: webRoutes.judge(),
      world,
      handlers: [proof],
      motion: "reduced",
      viewport: { width: 1920 },
    });
    await rendered.startSession();
    for (const [path, id] of routes) {
      act(() => rendered.runtime.client.setQueryData(["run", RUN], fixture(replayed)));
      await rendered.navigate(path);
      await screen.findByTestId(id);
      await waitFor(() => expect(screen.queryByTestId(`${id}.loading`)).toBeNull());
      if (path === webRoutes.proof(RUN) || path.startsWith("/b/")) {
        await screen.findByTestId("W-PF-01.progress");
        fireEvent.click(screen.getByTestId("W-PF-01.plate.payoutItems.toggle"));
        fireEvent.click(screen.getByTestId("W-PF-01.plate.computed.toggle"));
        const peso = await screen.findByTestId("W-PF-01.peso.M-014");
        fireEvent.click(peso);
        await screen.findByTestId("W-PF-01.trace.receipt");
      }
      const checked = assertPayouts(rendered.container, replayed);
      if (!["W-OP-01", "W-AU-01"].includes(id) && !path.includes("M-053"))
        expect(checked, path).toBeGreaterThan(0);
      if (id === "W-TR-08") {
        const threads = rendered.container.querySelectorAll('[data-testid^="W-TR-08.thread."]');
        expect(threads).toHaveLength(8);
        for (const thread of threads)
          if (replayed) expect(thread.getAttribute("data-tone")).not.toBe("landed");
      }
      if (id === "W-BR-01")
        expect(screen.getByTestId("W-BR-01.payouts").textContent).toMatch(
          replayed ? /payout statuses replayed \(labelled\)/ : /confirmed by the simulated/,
        );
      if (id === "W-TR-09" && path.includes("M-014")) {
        const text = (screen.queryByTestId("W-TR-09.status") ?? screen.getByTestId("W-TR-09.paper"))
          .textContent;
        expect(text).toMatch(replayed ? /Replayed \(labelled\)/ : /simulated PayPal sandbox/i);
        if (screen.queryByTestId("W-TR-09.sms.text"))
          expect(screen.getByTestId("W-TR-09.sms.text").textContent).toMatch(
            replayed ? /replay/i : /simulated/i,
          );
      }
    }
  },
  120_000,
);

it.each(["POSTING", "POSTED", "SETTLING"] as const)("inv.i8.stage pill labels replay during %s", (state) => {
  expect(
    nextStep(
      { ...fixture(true), state },
      { inSession: true, season: SEASON, recordedOn: "29 Oct", byHandSlip: "0462", payouts: 8 },
    ).text,
  ).toMatch(/replaying.*earlier simulated PayPal sandbox run/i);
});
