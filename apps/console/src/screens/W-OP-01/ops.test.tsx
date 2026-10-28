// W-OP-01 /ops against the mock world: health in words and the page's state (loading with print beds, degraded
// while readiness isn't reported or liveness answers 503, ready only when both answer well), the three kill
// switches read-only, PayPal's notices from the season's hash chain or a judge's live run, every S3.15 section
// naming its route until the API serves it (and filled once it does), and the treasurer's key: read-only for a
// judge, made and registered only in the operator's session.

import { webcrypto } from "node:crypto";
import { webRoutes } from "@fairsplit/contracts";
import { getSnapshot } from "@fairsplit/seed";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http, type JsonBodyType } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataProvider } from "../../data/provider.js";
import { KeyPanel } from "../../features/ops/OpsPage.js";
import {
  SAMPLE_BALANCE,
  SAMPLE_CLAUDE,
  SAMPLE_EVAL,
  SAMPLE_LATENCY,
  SAMPLE_LIMITER,
  SAMPLE_OUTBOX,
  SAMPLE_QUOTAS,
  SAMPLE_RECONCILIATION,
  SAMPLE_SCOPES,
  SAMPLE_SESSION,
} from "../../features/ops/sections.fixtures.js";
import { SECTION_PATHS } from "../../features/ops/sections.js";
import { useTreasurerKey } from "../../features/ops/useOps.js";
import { memoryKeyStore, TREASURER_KEY_ID } from "../../lib/keystore.js";
import {
  createTestRuntime,
  createTestWorld,
  expectNoAxeViolations,
  renderConsole,
  type TestWorld,
} from "../../test/index.js";
import { gate, withHandlers } from "../../test/proof-world.js";

/** Every S3.15 read beyond health, with the route its "not served yet" names. */
const SECTIONS = [
  ["scopes", SECTION_PATHS.scopes],
  ["limiter", SECTION_PATHS.limiter],
  ["latency", SECTION_PATHS.latency],
  ["reconciliation", SECTION_PATHS.reconciliation],
  ["balance", SECTION_PATHS.balance],
  ["outbox", "/v1/ops/outbox"],
  ["claude", SECTION_PATHS.claude],
  ["eval", SECTION_PATHS.eval],
  ["quotas", SECTION_PATHS.quotas],
] as const;

const READY = {
  status: "ready",
  service: "fs-api",
  version: "0.1.0",
  rail: "simulated",
  checks: {
    db: { ok: true, role: "login" },
    listen: { ok: true, roundTripMs: 4 },
    dispatcher: { ok: true, executor: "inline" },
    flags: { forcedByEnv: [] },
    paypal: { token: { cached: true, failures: 0, lastError: null }, webhooks: "ok" },
  },
};

async function openOps(world: TestWorld = createTestWorld()) {
  const view = await renderConsole({ path: webRoutes.ops(), world });
  const root = await screen.findByTestId("W-OP-01");
  await waitFor(() => expect(root.dataset.state).not.toBe("loading"));
  return { view, root };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("W-OP-01 /ops for a judge (read-only)", () => {
  it("says degraded while readiness isn't reported, and reads health, the switches and the season's notices", async () => {
    const { view, root } = await openOps();
    expect(root.dataset.state).toBe("degraded");
    expect(document.documentElement.dataset.theme).toBe("tablea");
    expect(screen.getByTestId("W-OP-01.verdict").textContent).toBe(
      "Degraded: readiness isn't reported by this API yet, so nothing here can be called ready.",
    );
    expect(screen.getByTestId("W-OP-01.health.ready").textContent).toContain("Not served yet");
    const live = screen.getByTestId("W-OP-01.health.live");
    expect(live.textContent).toContain("Up");
    expect(live.textContent).toContain("mock API");
    expect(live.textContent).toContain("Simulated PayPal sandbox");
    expect(screen.getByTestId("W-OP-01.access").textContent).toBe("Read-only");

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
    expect(screen.getByTestId("W-OP-01.checked").textContent).toContain("Davao time");
    await expectNoAxeViolations(view.container);
  });

  it("shows every S3.15 section, each naming the route it waits for", async () => {
    await openOps();
    for (const [section, route] of SECTIONS) {
      const notServed = await screen.findByTestId(`W-OP-01.${section}.not-served`);
      expect(notServed.textContent).toBe(`Not served yet (GET ${route}).`);
    }
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    for (const title of [
      "Health",
      "Kill switches",
      "PayPal",
      "Scopes",
      "Limiter and circuit",
      "Webhook latency",
      "Last reconciliation",
      "Balance",
      "PayPal's notices",
      "Outbox",
      "Claude",
      "Spend today",
      "Eval",
      "Quotas",
      "Treasurer's browser key",
    ]) {
      expect(headings).toContain(title);
    }
  });

  it("shows the treasurer key read-only: no slab, nothing made in the judge's browser", async () => {
    const generateKey = vi.spyOn(globalThis.crypto.subtle, "generateKey");
    const { view } = await openOps();
    const panel = screen.getByTestId("W-OP-01.key.panel");
    await waitFor(() => expect(panel.dataset.state).toBe("not-served"));
    expect(panel.dataset.access).toBe("read-only");
    expect(screen.queryByTestId("W-OP-01.key.make")).toBeNull();
    expect(screen.queryByTestId("W-OP-01.key.register")).toBeNull();
    expect(panel.querySelector("[data-testid$='.face']")).toBeNull();
    expect(screen.getByTestId("W-OP-01.key.status").textContent).toBe(
      "Not served yet (GET /.well-known/fairsplit-keys.json).",
    );
    expect(screen.getByTestId("W-OP-01.key.who").textContent).toBe(
      "Read-only here. The operator registers this key once, from the treasurer's browser, signed in at /ops/login.",
    );
    expect(generateKey).not.toHaveBeenCalled();
    await expectNoAxeViolations(view.container);
  });

  it("reads the key's registration and fingerprint from the keys Fair Split publishes", async () => {
    const keys = getSnapshot().publishedKeys;
    const officer = keys.officers[0];
    if (!officer) throw new Error("the seed publishes officer keys");
    const published = {
      ...keys,
      officers: [...keys.officers, { ...officer, keyId: TREASURER_KEY_ID, kind: "web", revokedAt: null }],
    };
    const world = withHandlers(createTestWorld(), [
      http.get(`*${SECTION_PATHS.keys}`, () => HttpResponse.json(published)),
    ]);
    await openOps(world);
    const panel = screen.getByTestId("W-OP-01.key.panel");
    await waitFor(() => expect(panel.dataset.state).toBe("registered"));
    expect(screen.getByTestId("W-OP-01.key.status").textContent).toBe(
      "Registered. Proof checks Analyn's signatures against it.",
    );
    expect(screen.getByTestId("W-OP-01.key.fingerprint").textContent).toMatch(
      /^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/,
    );
    expect(screen.queryByTestId("W-OP-01.key.make")).toBeNull();
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

describe("W-OP-01 states", () => {
  it("loading: print beds where the health rows will land, until both reads answer", async () => {
    const held = gate();
    const world = withHandlers(createTestWorld(), [
      http.get("*/healthz", async () => {
        await held.opened;
      }),
    ]);
    const view = await renderConsole({ path: webRoutes.ops(), world });
    const root = await screen.findByTestId("W-OP-01");
    expect(root.dataset.state).toBe("loading");
    const beds = screen.getByTestId("W-OP-01.loading");
    expect(beds.querySelectorAll("[data-bed]").length).toBeGreaterThan(0);
    expect(screen.getByTestId("W-OP-01.verdict").textContent).toBe("Checking health.");
    await expectNoAxeViolations(view.container);

    held.release();
    await waitFor(() => expect(root.dataset.state).toBe("degraded"));
    expect(screen.queryByTestId("W-OP-01.loading")).toBeNull();
  });

  it("degraded: liveness answers 503, in words", async () => {
    const world = withHandlers(createTestWorld(), [
      http.get("*/healthz", () =>
        HttpResponse.json(
          { status: "fail", service: "fs-api", checks: { db: "unreachable" } },
          { status: 503 },
        ),
      ),
    ]);
    const { view, root } = await openOps(world);
    expect(root.dataset.state).toBe("degraded");
    expect(screen.getByTestId("W-OP-01.verdict").textContent).toBe("Degraded: the API is down.");
    const live = screen.getByTestId("W-OP-01.health.live");
    expect(live.dataset.state).toBe("attention");
    expect(live.textContent).toContain("Down");
    expect(live.textContent).toContain("The API answered 503.");
    await expectNoAxeViolations(view.container);
  });

  it("ready: only when liveness is up and readiness says ready", async () => {
    const world = withHandlers(createTestWorld(), [http.get("*/readyz", () => HttpResponse.json(READY))]);
    const { view, root } = await openOps(world);
    expect(root.dataset.state).toBe("ready");
    expect(screen.getByTestId("W-OP-01.verdict").textContent).toBe(
      "Ready: the API is up and every readiness check passes.",
    );
    expect(screen.getByTestId("W-OP-01.health.ready").textContent).toContain("Ready");
    expect(screen.getByTestId("W-OP-01.health.listen").textContent).toContain("round trip 4 ms");
    await expectNoAxeViolations(view.container);
  });
});

describe("W-OP-01 for the operator", () => {
  function operatorWorld() {
    const served: Record<string, JsonBodyType> = {
      [SECTION_PATHS.session]: SAMPLE_SESSION,
      [SECTION_PATHS.scopes]: SAMPLE_SCOPES,
      [SECTION_PATHS.limiter]: SAMPLE_LIMITER,
      [SECTION_PATHS.latency]: SAMPLE_LATENCY,
      [SECTION_PATHS.claude]: SAMPLE_CLAUDE,
      [SECTION_PATHS.eval]: SAMPLE_EVAL,
      [SECTION_PATHS.reconciliation]: SAMPLE_RECONCILIATION,
      [SECTION_PATHS.balance]: SAMPLE_BALANCE,
      [SECTION_PATHS.quotas]: SAMPLE_QUOTAS,
      "/v1/ops/outbox": SAMPLE_OUTBOX,
      "/readyz": READY,
    };
    return withHandlers(
      createTestWorld(),
      Object.entries(served).map(([path, body]) => http.get(`*${path}`, () => HttpResponse.json(body))),
    );
  }

  it("fills every S3.15 section from the API", async () => {
    const { view, root } = await openOps(operatorWorld());
    expect(root.dataset.state).toBe("ready");
    await waitFor(() => expect(screen.getByTestId("W-OP-01.access").textContent).toBe("Operator"));
    expect(screen.getByTestId("W-OP-01.scopes.table").textContent).toContain("reporting/search/read");
    expect(screen.getByTestId("W-OP-01.limiter.table.calls").textContent).toContain("12 of 40");
    expect(screen.getByTestId("W-OP-01.limiter.table.background").textContent).toContain("3 of 20");
    expect(screen.getByTestId("W-OP-01.limiter.table.circuit").textContent).toContain("Closed");
    expect(screen.getByTestId("W-OP-01.limiter.table.shared-ip").textContent).toContain("None");
    expect(screen.getByTestId("W-OP-01.latency.table.post_to_first_item").textContent).toContain("640 ms");
    expect(screen.getByTestId("W-OP-01.reconciliation.table.matched").textContent).toContain("8 matched");
    const estimate = within(screen.getByTestId("W-OP-01.balance.table.estimated")).getByText("US$96,344.12");
    expect(estimate.dataset.amountState).toBe("pencil");
    expect(screen.getByTestId("W-OP-01.claude.table.judge_read").dataset.state).toBe("attention");
    expect(screen.getByTestId("W-OP-01.eval.caption").textContent).toContain("24 labelled synthetic cases");
    expect(screen.getByTestId("W-OP-01.quotas.table.judge_posts_day").textContent).toContain("3 of 3");
    expect(screen.getByTestId("W-OP-01.outbox.summary").textContent).toContain("1 queued");
    expect(document.querySelector("[data-testid$='.not-served']")).toBeNull();
    await expectNoAxeViolations(view.container);
  });

  it("makes the key in this browser and registers it, only in the operator's session", async () => {
    const world = withHandlers(operatorWorld(), [
      http.post("*/v1/ops/keys", () => HttpResponse.json({ ok: true }, { status: 201 })),
    ]);
    const { view } = await openOps(world);
    const panel = screen.getByTestId("W-OP-01.key.panel");
    await waitFor(() => expect(panel.dataset.access).toBe("operator"));
    await waitFor(() => expect(panel.dataset.state).toBe("none"));
    fireEvent.keyDown(screen.getByTestId("W-OP-01.key.make.face"), { key: "Enter" });
    await waitFor(() => expect(panel.dataset.state).toBe("made"));
    fireEvent.keyDown(screen.getByTestId("W-OP-01.key.register.face"), { key: "Enter" });
    await waitFor(() => expect(panel.dataset.state).toBe("registered"));
    expect(screen.getByTestId("W-OP-01.key.status").textContent).toBe(
      "Registered. The treasurer signs with it from this browser.",
    );
    await expectNoAxeViolations(view.container);
  });
});

function KeyHarness() {
  const key = useTreasurerKey({
    store: memoryKeyStore(),
    subtle: webcrypto.subtle as unknown as SubtleCrypto,
  });
  return <KeyPanel treasurerKey={key} operator registry={{ kind: "not-served", at: 1 }} />;
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

  it("does nothing when it isn't the operator's session", async () => {
    const generateKey = vi.fn();
    function Disabled() {
      const key = useTreasurerKey({
        store: memoryKeyStore(),
        subtle: { generateKey } as unknown as SubtleCrypto,
        enabled: false,
      });
      return (
        <button type="button" data-testid="probe" data-phase={key.phase.kind} onClick={key.make}>
          make
        </button>
      );
    }
    const { runtime } = createTestRuntime();
    render(
      <DataProvider runtime={runtime}>
        <Disabled />
      </DataProvider>,
    );
    const probe = screen.getByTestId("probe");
    fireEvent.click(probe);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(probe.dataset.phase).toBe("checking");
    expect(generateKey).not.toHaveBeenCalled();
  });

  it("makes a key whose private half can't be exported", async () => {
    const { makeKey } = await import("../../lib/keystore.js");
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
