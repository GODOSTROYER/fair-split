import { getSnapshot } from "@fairsplit/api-client/seed";
import { type RunEvent, webRoutes } from "@fairsplit/contracts";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { getResponse, HttpResponse, http } from "msw";
import { expect, it } from "vitest";
import { nextStep } from "../chrome/next-step.js";
import { applyRunEvent, type RunView, showcaseView } from "../data/run-view.js";
import { DATA_MODE_STORAGE } from "../lib/data-mode.js";
import { hourlyCapSession } from "../test/quota.js";
import { renderConsole } from "../test/render.js";
import { WEB_ROUTE_CASES } from "../test/route-cases.js";
import { createTestWorld } from "../test/world.js";

const snapshot = getSnapshot();
const RUN = snapshot.run.runSlug;
const SEASON = "2026-A";

// Every product route in the same table as routes.test (the stage routes render inside the stage: Ribbon, posters,
// phone dock), plus the PayPal member's 80 mm print.
const routes = [
  ...WEB_ROUTE_CASES.map(({ path, screens }) => [path, screens[screens.length - 1] as string] as const),
  [webRoutes.memberPrint(RUN, "M-014"), "W-TR-09"],
] as const;

/** Routes whose live, posted run shows confirmed money somewhere: the last live slot must still read landed. */
const PAYOUT_ROUTES = new Set<string>([
  webRoutes.split(RUN),
  webRoutes.memberLine(RUN, "M-014"),
  webRoutes.memberPrint(RUN, "M-014"),
  webRoutes.fanout(RUN),
  webRoutes.proof(RUN),
]);

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

/**
 * Every mark that says "money landed": jade tones, landed amounts and figures, the member's paid capsule, and any
 * element (a screen root, a status chip) whose state says paid.
 */
const LANDED_MARKS = [
  '[data-tone="jade"]',
  '[data-tone="landed"]',
  "[data-landed]",
  '[data-amount-state="landed"]',
  '.fs-capsule[data-state="paid"]',
  '[data-state="paid"]',
  '[data-state="PAID"]',
].join(", ");
/**
 * The explicit allowlist: what is not a payout. Lantern Bay's invoice settlement and the funding it brought (the
 * stage's and the season's invoice plate, pool and Funded stage, Proof's invoice hero), and the two-key approval
 * control, whose jade is the d3 slab's own colour for this run's real signatures. Nothing else may stay jade or
 * say "Paid" on a replayed run.
 */
const NOT_PAYOUTS = [
  // invoice
  '[data-testid="W-JG-01.invoice.amount"]',
  '[data-testid="W-TR-01.invoice.amount"]',
  '[data-testid="W-PF-01.invoice-amount"]',
  // funding
  '[data-testid^="W-JG-01.pool"]',
  '[data-testid^="W-TR-01.pool"]',
  '[data-testid="W-TR-01.strip.FUNDED"]',
  // approval (both keys of this run)
  '[data-testid="W-TR-07.approve"]',
].join(", ");
/** The unit a word is read in: the nearest row, cell, paragraph, item or labelled element around it. */
const UNIT = "li, tr, td, th, dd, dt, p, h1, h2, h3, h4, figcaption, label, button, [data-testid]";
const PAID_WORDS = /\bPaid\b|Bayad na/;

const short = (el: Element) => el.outerHTML.slice(0, 280);

function landedMarks(root: HTMLElement): string[] {
  return [...root.querySelectorAll(LANDED_MARKS)].filter((el) => !el.closest(NOT_PAYOUTS)).map(short);
}

/** "Paid" or "Bayad na" anywhere outside an element labelled as a replay (text, aria-label and title). */
function paidOutsideReplay(root: HTMLElement): string[] {
  const found: string[] = [];
  const check = (el: Element | null, text: string) => {
    if (!el || !PAID_WORDS.test(text) || el.closest(NOT_PAYOUTS)) return;
    const unit = el.closest(UNIT) ?? el;
    if (/replay/i.test(text) || /replay/i.test(unit.textContent ?? "")) return;
    found.push(`${text.trim()} @ ${short(unit)}`);
  };
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    check(node.parentElement, node.textContent ?? "");
  for (const el of root.querySelectorAll("[aria-label], [title]"))
    check(el, `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`);
  return found;
}

const PAYOUT_REPLAY_WORDS = /Replayed \(labelled\)|statuses replayed|payouts will replay|Replayed payout/i;

type Mode = "live last slot" | "replay-bundle" | "replay-stream" | "replay-stream, data mode";

it.each<Mode>(["live last slot", "replay-bundle", "replay-stream", "replay-stream, data mode"])(
  "inv.i8.the whole console on every route reads its own payout evidence (%s)",
  async (mode) => {
    const replayed = mode !== "live last slot";
    if (mode.endsWith("data mode")) window.localStorage.setItem(DATA_MODE_STORAGE, "on");
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
    // The live case is the hour's last live slot: the quota already reads "replay, hourly_cap" (shared handler).
    const handlers = replayed ? [proof] : [proof, hourlyCapSession(world, { runState: "SETTLED" })];
    const rendered = await renderConsole({
      path: webRoutes.judge(),
      world,
      handlers,
      motion: "reduced",
      viewport: { width: 1920 },
    });
    await rendered.startSession();
    const offenders: Record<string, readonly string[]> = {};
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
        // Every payout status on the lines plate is the Chip component: a glyph and the label type.
        const chips = rendered.container.querySelectorAll('[data-testid^="W-PF-01.line."] .fs-chip');
        expect(chips.length, path).toBeGreaterThan(0);
        for (const chip of chips) {
          expect(chip.querySelector(".fs-glyph"), short(chip)).not.toBeNull();
          expect(chip.querySelector(".fs-t-label"), short(chip)).not.toBeNull();
        }
      }
      // The WHOLE container: stage chrome (Ribbon, run log, posters), screens, tables and Data mode.
      const root = rendered.container;
      if (replayed) {
        const found = [...landedMarks(root), ...paidOutsideReplay(root)];
        if (found.length > 0) offenders[path] = found;
      } else {
        expect(root.textContent, path).not.toMatch(PAYOUT_REPLAY_WORDS);
        if (PAYOUT_ROUTES.has(path)) expect(landedMarks(root).length, path).toBeGreaterThan(0);
      }
      if (id === "W-TR-08") {
        const threads = rendered.container.querySelectorAll('[data-testid^="W-TR-08.thread."]');
        expect(threads).toHaveLength(8);
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
    expect(offenders).toEqual({});
  },
  180_000,
);

it.each(["POSTING", "POSTED", "SETTLING"] as const)("inv.i8.stage pill labels replay during %s", (state) => {
  expect(
    nextStep(
      { ...fixture(true), state },
      { inSession: true, season: SEASON, recordedOn: "29 Oct", byHandSlip: "0462", payouts: 8 },
    ).text,
  ).toMatch(/replaying.*earlier simulated PayPal sandbox run/i);
});

it.each([true, false])(
  "inv.i8.a returned payout retains its evidence in drawer and print (replay=%s)",
  async (replayed) => {
    const base = fixture(replayed);
    const line = base.lines["M-014"];
    if (!line) throw new Error("M-014 line required");
    const event = {
      ...base.events[0],
      type: "line.state",
      payload: { memberNo: "M-014", from: "PAYPAL_PENDING", to: "RETURNED" },
    } as RunEvent;
    const view = {
      ...base,
      events: [event],
      lines: { ...base.lines, "M-014": { ...line, state: "RETURNED" as const } },
      items: Object.fromEntries(
        Object.entries(base.items).map(([id, item]) => [
          id,
          item.memberNo === "M-014"
            ? { ...item, status: "RETURNED" as const, source: "cancel" as const }
            : item,
        ]),
      ),
    };
    const rendered = await renderConsole({ path: webRoutes.judge(), motion: "reduced" });
    await rendered.startSession();
    for (const path of [webRoutes.memberLine(RUN, "M-014"), webRoutes.memberPrint(RUN, "M-014")]) {
      act(() => rendered.runtime.client.setQueryData(["run", RUN], view));
      await rendered.navigate(path);
      await screen.findByTestId("W-TR-09");
      const root = screen.queryByTestId("W-TR-09.line") ?? screen.getByTestId("W-TR-09.paper");
      expect(root.textContent).toMatch(/simulated PayPal sandbox/i);
      if (replayed) expect(root.textContent).toMatch(/Replayed \(labelled\)/);
      else {
        expect(root.textContent).not.toMatch(/replay/i);
        // The console's word in the drawer; the member's own word on her paper.
        expect(root.textContent).toContain(
          path.endsWith("/print")
            ? "Returned to the co-op (Simulated PayPal sandbox)"
            : "Returned (Simulated PayPal sandbox)",
        );
      }
      if (screen.queryByTestId("W-TR-09.sms.text")) {
        // Nang Celing's SMS in her own language (Cebuano): the bare word, the rail named once by the frame; a
        // replay in Cebuano words, never "Gibalik" as this run's outcome nor an English sentence.
        const sms = screen.getByTestId("W-TR-09.sms.text").textContent ?? "";
        expect(sms).toMatch(replayed ? /Gi-replay \(gilabelan\)/ : /Gibalik sa co-op: US\$64\.45/);
        expect(sms.match(/simulated PayPal sandbox/gi)).toHaveLength(1);
      }
      expect(root.querySelector('[data-amount-state="landed"]')).toBeNull();
      expect(root.querySelector('[data-amount-state="hollow"]')).not.toBeNull();
    }
  },
);
