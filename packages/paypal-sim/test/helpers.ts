// Shared test helpers: a fast simulator (SIM_SPEED=0), an authenticated API client and a webhook receiver
// that keeps the raw bytes of every delivery.
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SimulatorOptions } from "../src/config.js";
import { createSimulator, type Simulator } from "../src/simulator.js";

export const API = "https://api-m.sandbox.paypal.com";
export const BUSINESS_EMAIL = "bulawanon.coop@example.org";
export const PAYER_EMAIL = "lantern.bay.payables@example.org";
export const RHEA_EMAIL = "rhea.jumawan@example.org";

/** The register's 15 subscribed event types (decision register §8). */
export const REGISTER_EVENT_TYPES = [
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.CANCELLED",
  "INVOICING.INVOICE.UPDATED",
  "INVOICING.INVOICE.REFUNDED",
  "PAYMENT.PAYOUTSBATCH.PROCESSING",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTSBATCH.DENIED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.HELD",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED",
];

/** The eight-item batch of the canonical world (register §2): seven members plus Rhea, US$368.39. */
export const MEMBER_PAYOUTS: { memberNo: string; email: string; value: string }[] = [
  { memberNo: "M-014", email: "consolacion.bacus@example.org", value: "64.45" },
  { memberNo: "M-007", email: "dionisio.lapinig@example.org", value: "62.71" },
  { memberNo: "M-060", email: "arnel.sumampao@example.org", value: "55.96" },
  { memberNo: "M-018", email: "teodoro.pacana@example.org", value: "55.63" },
  { memberNo: "M-039", email: "jonathan.ripalda@example.org", value: "38.32" },
  { memberNo: "M-022", email: "pedro.ompad@example.org", value: "34.40" },
  { memberNo: "M-002", email: "florencia.ybanez@example.org", value: "30.27" },
  { memberNo: "M-031", email: RHEA_EMAIL, value: "26.65" },
];

export async function newSim(opts: SimulatorOptions = {}): Promise<Simulator> {
  return createSimulator({ speed: 0, logger: () => {}, ...opts });
}

export interface Reply {
  status: number;
  headers: Headers;
  // biome-ignore lint/suspicious/noExplicitAny: test convenience for JSON bodies
  json: any;
  text: string;
}

export async function call(
  sim: Simulator,
  method: string,
  path: string,
  opts: {
    token?: string;
    body?: unknown;
    raw?: string;
    headers?: Record<string, string>;
    base?: string;
  } = {},
): Promise<Reply> {
  const headers = new Headers(opts.headers ?? {});
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  let body: string | undefined;
  if (opts.raw !== undefined) body = opts.raw;
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers.set("content-type", "application/json");
  }
  const res = await sim.fetch(
    new Request(`${opts.base ?? API}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) }),
  );
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json, text };
}

export async function token(sim: Simulator, app = "fs-dev"): Promise<string> {
  const a = sim.registry.apps.find((x) => x.name === app);
  if (!a) throw new Error(`no app ${app}`);
  const basic = Buffer.from(`${a.client_id}:${a.client_secret}`).toString("base64");
  const res = await sim.fetch(
    new Request(`${API}/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    }),
  );
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export interface Delivery {
  headers: IncomingHttpHeaders;
  raw: string;
  // biome-ignore lint/suspicious/noExplicitAny: parsed webhook event
  json: any;
}

export interface Receiver {
  url: string;
  deliveries: Delivery[];
  /** Status codes to answer with, consumed in order; then 200. */
  failures: number[];
  close(): Promise<void>;
}

export async function receiver(): Promise<Receiver> {
  const deliveries: Delivery[] = [];
  const failures: number[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const status = failures.shift() ?? 200;
      if (status >= 200 && status < 300)
        deliveries.push({ headers: req.headers, raw, json: JSON.parse(raw) });
      res.statusCode = status;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/webhooks/paypal`,
    deliveries,
    failures,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

export async function subscribe(
  sim: Simulator,
  tok: string,
  url: string,
  types = REGISTER_EVENT_TYPES,
): Promise<string> {
  const res = await call(sim, "POST", "/v1/notifications/webhooks", {
    token: tok,
    body: { url, event_types: types.map((name) => ({ name })) },
  });
  if (res.status !== 201) throw new Error(`subscribe failed ${res.status} ${res.text}`);
  return res.json.id as string;
}

export function canonicalInvoice(invoiceNumber: string): Record<string, unknown> {
  return {
    detail: {
      currency_code: "USD",
      invoice_number: invoiceNumber,
      reference: "rc:7f3a91c2b0d4e6f8;run:r37",
      note: "Season 2026-A, RC 7f3a 91c2, lot LB-PH-2026-03",
    },
    invoicer: { email_address: BUSINESS_EMAIL },
    primary_recipients: [
      {
        billing_info: { business_name: "Lantern Bay Chocolate Co. (synthetic)", email_address: PAYER_EMAIL },
      },
    ],
    items: [
      {
        name: "Premium",
        quantity: "1",
        unit_amount: { currency_code: "USD", value: "2887.50" },
        unit_of_measure: "AMOUNT",
      },
      {
        name: "Quality bonus",
        quantity: "1",
        unit_amount: { currency_code: "USD", value: "1386.00" },
        unit_of_measure: "AMOUNT",
      },
      {
        name: "Disbursement costs",
        quantity: "1",
        unit_amount: { currency_code: "USD", value: "60.00" },
        unit_of_measure: "AMOUNT",
      },
    ],
  };
}

export function batchBody(
  senderBatchId: string,
  payouts = MEMBER_PAYOUTS,
  runSeq = "r37",
): Record<string, unknown> {
  return {
    sender_batch_header: {
      sender_batch_id: senderBatchId,
      recipient_type: "EMAIL",
      email_subject: "Fair Split 2026-A payout",
      note: "Fair Split 2026-A, batch 0123456789abcdef",
    },
    items: payouts.map((p) => ({
      receiver: p.email,
      amount: { currency: "USD", value: p.value },
      sender_item_id: `${runSeq}-${p.memberNo}`,
      note: `FS ${runSeq}-${p.memberNo} rc 7f3a91c2`,
      purpose: "GOODS",
    })),
  };
}

export function ptToday(ms = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(ms));
}

export function plusDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
