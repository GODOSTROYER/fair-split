// Every S1.6 stage state the strip under the top bar can show, rendered and checked with axe: queued, resetting,
// reset-failed, start-failed (with Try again), autoplay, paused, circuit, balance-low (the API's replay reasons),
// ai-off and paypal-off. And the stage reads circuit from the session's own status.

import { ApiClientError } from "@fairsplit/api-client";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getResponse, HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import type { CommandError } from "../data/errors.js";
import type { RunView } from "../data/run-view.js";
import type { JudgeSession } from "../data/session.js";
import { expectNoAxeViolations } from "../test/axe.js";
import { renderConsole } from "../test/render.js";
import { createTestWorld } from "../test/world.js";
import { StageNotice, type StageNoticeInput, stageNoticeFor } from "./StageNotice.js";

const SESSION: JudgeSession = {
  sessionId: "0190f000-0000-7000-8000-000000000001",
  workspaceId: "0190f000-0000-7000-8000-000000000002",
  runId: "0190f000-0000-7000-8000-000000000003",
  runSlug: "2026A-r37",
  expiresAt: "2026-10-28T12:00:00.000Z",
  queuePosition: null,
};
const ctx = { command: "createJudgeSession", rail: null, requestId: "req-7" };
const refusal = new ApiClientError(
  { code: "INTERNAL", status: 500, message: "boom", requestId: "req-7" },
  ctx,
) as CommandError;
const flags = (on: Partial<RunView["flags"]>) => ({ flags: { ...on } }) as unknown as RunView;
const active = { status: "active" as const, session: SESSION, error: null };

const CASES: readonly [string, StageNoticeInput, boolean][] = [
  [
    "queued",
    {
      session: { ...active, session: { ...SESSION, queuePosition: 2 } },
      view: undefined,
      autoplay: "off",
      inSession: true,
    },
    false,
  ],
  [
    "resetting",
    {
      session: { status: "resetting", session: SESSION, error: null },
      view: undefined,
      autoplay: "off",
      inSession: true,
    },
    false,
  ],
  [
    "reset-failed",
    { session: { ...active, error: refusal }, view: undefined, autoplay: "off", inSession: true },
    true,
  ],
  [
    "start-failed",
    {
      session: { status: "failed", session: null, error: refusal },
      view: undefined,
      autoplay: "off",
      inSession: false,
    },
    true,
  ],
  ["autoplay", { session: active, view: undefined, autoplay: "autoplay", inSession: true }, false],
  ["paused", { session: active, view: undefined, autoplay: "paused", inSession: true }, false],
  [
    "circuit",
    { session: active, view: undefined, autoplay: "off", inSession: true, replayReason: "circuit_open" },
    false,
  ],
  [
    "balance-low",
    { session: active, view: undefined, autoplay: "off", inSession: true, replayReason: "balance_low" },
    false,
  ],
  [
    "ai-off",
    { session: active, view: flags({ kill_ai_live: true }), autoplay: "off", inSession: true },
    false,
  ],
  [
    "paypal-off",
    { session: active, view: flags({ kill_paypal_live: true }), autoplay: "off", inSession: true },
    false,
  ],
];

describe("the stage's notice strip (S1.6 states)", () => {
  it.each(CASES)("%s renders as one status line, axe-clean", async (state, input, retry) => {
    const notice = stageNoticeFor(input);
    expect(notice?.state).toBe(state);
    if (!notice) return;
    const onRetry = vi.fn();
    const { container } = render(<StageNotice notice={notice} onRetry={onRetry} />);
    const strip = screen.getByTestId("W-JG-01.notice.state");
    expect(strip.getAttribute("role")).toBe("status");
    expect(strip.dataset.state).toBe(state);
    expect(strip.textContent?.trim().length).toBeGreaterThan(10);
    if (retry) {
      fireEvent.click(screen.getByTestId("W-JG-01.notice.retry"));
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(strip.textContent).toContain("Request req-7");
    } else {
      expect(screen.queryByTestId("W-JG-01.notice.retry")).toBeNull();
    }
    await expectNoAxeViolations(container);
  });

  it("names the circuit when the session's status says PayPal steps replay because of it", async () => {
    const world = createTestWorld();
    const circuit = http.get("*/v1/judge/session", async ({ request }) => {
      const real = await getResponse([...world.mock.handlers], request);
      const body = (await real?.json()) as { rail: Record<string, unknown> };
      return HttpResponse.json({ ...body, rail: { ...body.rail, mode: "replay", reason: "circuit_open" } });
    });
    const view = await renderConsole({ path: "/judge", world, handlers: [circuit] });
    await act(async () => {
      await view.runtime.session.start();
    });
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("circuit"));
    expect(screen.getByTestId("W-JG-01.notice.state").textContent).toBe(
      "The simulated PayPal rate limit paused calls. For 6 minutes, PayPal steps use a labelled replay.",
    );
  });
});

it.each(["hourly_cap", "daily_cap", "session_cap", "public_share", "lane_full"] as const)(
  "labels quota replay %s with the API's words",
  (replayReason) => {
    const notice = stageNoticeFor({
      session: active,
      view: undefined,
      autoplay: "off",
      inSession: true,
      replayReason,
      replayLabel: "Replay: quota reached",
    });
    expect(notice?.text).toBe("Replay: quota reached");
    expect(notice?.state).toBe("replay");
  },
);

it.each(["autoplay", "paused"] as const)("keeps the quota replay label visible during %s", (autoplay) => {
  expect(
    stageNoticeFor({
      session: active,
      view: undefined,
      autoplay,
      inSession: true,
      replayReason: "hourly_cap",
      replayLabel: "Replay: this hour is full",
    })?.text,
  ).toContain("Replay: this hour is full");
});

it("inv.i8.refreshes the API rail label as soon as a payout replay arrives", async () => {
  const world = createTestWorld();
  let replay = false;
  let reads = 0;
  const handler = http.get("*/v1/judge/session", async ({ request }) => {
    const response = await getResponse([...world.mock.handlers], request);
    const body = (await response?.json()) as { rail: Record<string, unknown> };
    reads++;
    return HttpResponse.json({
      ...body,
      rail: {
        ...body.rail,
        mode: replay ? "replay" : "live",
        reason: replay ? "hourly_cap" : null,
        label: replay ? "Replay: quota was reached" : "Simulated PayPal sandbox",
      },
    });
  });
  const rendered = await renderConsole({ path: "/judge", world, handlers: [handler] });
  await act(async () => {
    await rendered.runtime.session.start();
  });
  await waitFor(() => expect(reads).toBeGreaterThan(0));
  replay = true;
  act(() => {
    rendered.runtime.client.setQueryData<RunView>(["run", world.runSlug], (view) =>
      view
        ? {
            ...view,
            events: [
              ...view.events,
              {
                id: "999",
                ws: "test",
                runId: world.runId,
                at: "2026-11-01T00:00:00Z",
                type: "item.updated",
                provenance: "replay",
                actor: { kind: "paypal", id: "simulator", impersonatedBy: null },
                payload: {
                  senderItemId: "r37-M-014",
                  memberNo: "M-014",
                  from: "PENDING",
                  to: "SUCCESS",
                  payoutItemId: "RPLY-test",
                  eventId: null,
                  source: "status_check",
                },
              } as RunView["events"][number],
            ],
          }
        : view,
    );
  });
  await waitFor(
    () =>
      expect(screen.getByTestId("W-JG-01.notice.state").textContent).toContain("Replay: quota was reached"),
    { timeout: 2500 },
  );
  replay = false;
  await act(async () => {
    await rendered.runtime.client.refetchQueries({ queryKey: ["judge-session-status"] });
  });
  expect(screen.getByTestId("W-JG-01.notice.state").textContent).toContain("Replay: quota was reached");
});
