// In-memory simulator state. Everything here is plain JSON so it can be snapshotted to .data and restored.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toCents } from "./util/money.js";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export interface Account {
  key: string;
  role: string;
  type: "BUSINESS" | "PERSONAL";
  payer_id: string;
  email: string;
  business_name?: string;
  given_name?: string;
  surname?: string;
  member_no?: string;
  country_code: string;
  balances: Record<string, string>;
}

export interface App {
  name: string;
  account: string;
  app_id: string;
  client_id: string;
  client_secret: string;
  scopes: string[];
}

export interface Registry {
  accounts: Account[];
  apps: App[];
  unregistered_receivers: { member_no: string; email: string; note?: string }[];
}

export interface TokenRecord {
  clientId: string;
  scopes: string[];
  expiresAt: number;
}

export interface InvoiceRecord {
  id: string;
  clientId: string;
  accountKey: string;
  createdAt: number;
  deleted: boolean;
  /** The PayPal invoice representation (status, detail, amounts, payments …), without links. */
  invoice: JsonObject;
  rules: JsonObject[];
}

export interface ItemRecord {
  id: string;
  batchId: string;
  index: number;
  status: string;
  receiver: string;
  receiverAccountKey: string | null;
  currency: string;
  amountCents: number;
  feeCents: number;
  item: JsonObject;
  transactionId: string | null;
  activityId: string | null;
  timeProcessed: number | null;
  unclaimedSince: number | null;
  errors: JsonObject | null;
}

export interface BatchRecord {
  id: string;
  clientId: string;
  accountKey: string;
  senderBatchId: string;
  senderBatchHeader: JsonObject;
  status: string;
  createdAt: number;
  completedAt: number | null;
  itemIds: string[];
  currency: string;
}

export interface WebhookRecord {
  id: string;
  clientId: string;
  url: string;
  eventTypes: string[];
  createdAt: number;
}

export interface LookupRecord {
  id: string;
  clientId: string;
}

export interface EventRecord {
  id: string;
  clientId: string;
  createdAt: number;
  eventType: string;
  /** The event exactly as serialized for delivery. */
  body: string;
  webhookIds: string[];
  mock: boolean;
  resourceIds: string[];
}

export interface DeliveryRecord {
  transmissionId: string;
  eventId: string;
  webhookId: string;
  url: string;
  time: string;
  signature: string;
  certUrl: string;
  attempts: number;
  status: "PENDING" | "SUCCESS" | "FAILED" | "HELD";
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: number;
  /** Signed with the literal webhook id `WEBHOOK_ID`, like PayPal's mock events. */
  mock: boolean;
}

export interface LedgerEntry {
  accountKey: string;
  currency: string;
  at: number;
  availableCents: number;
  withheldCents: number;
  kind: string;
  ref: string;
}

export interface TransactionRecord {
  accountKey: string;
  at: number;
  updatedAt: number;
  transactionId: string;
  eventCode: string;
  status: "S" | "P" | "V" | "D";
  currency: string;
  amountCents: number;
  feeCents: number;
  counterpartyKey: string | null;
  counterpartyEmail: string | null;
  note: string | null;
  subject: string | null;
  invoiceNumber: string | null;
  customField: string | null;
}

export interface IdempotencyRecord {
  bodyHash: string;
  status: number;
  body: string | null;
  contentType: string | null;
  at: number;
}

export interface SimState {
  version: 1;
  tokens: Record<string, TokenRecord>;
  invoices: Record<string, InvoiceRecord>;
  invoiceCounters: Record<string, number>;
  batches: Record<string, BatchRecord>;
  items: Record<string, ItemRecord>;
  senderBatchIndex: Record<string, { batchId: string; at: number }>;
  webhooks: Record<string, WebhookRecord>;
  lookups: Record<string, LookupRecord>;
  events: Record<string, EventRecord>;
  eventOrder: string[];
  deliveries: Record<string, DeliveryRecord>;
  ledger: LedgerEntry[];
  transactions: TransactionRecord[];
  idempotency: Record<string, IdempotencyRecord>;
  delivery: { outOfOrder: boolean; duplicate: boolean };
  denyNextBatch: boolean;
}

export function emptyState(): SimState {
  return {
    version: 1,
    tokens: {},
    invoices: {},
    invoiceCounters: {},
    batches: {},
    items: {},
    senderBatchIndex: {},
    webhooks: {},
    lookups: {},
    events: {},
    eventOrder: [],
    deliveries: {},
    ledger: [],
    transactions: [],
    idempotency: {},
    delivery: { outOfOrder: false, duplicate: false },
    denyNextBatch: false,
  };
}

export function defaultAccountsFile(): string {
  return fileURLToPath(new URL("../data/accounts.json", import.meta.url));
}

export function loadRegistry(file: string = defaultAccountsFile()): Registry {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Registry>;
  const accounts = raw.accounts ?? [];
  const apps = raw.apps ?? [];
  const keys = new Set(accounts.map((a) => a.key));
  for (const app of apps) {
    if (!keys.has(app.account)) throw new Error(`app ${app.name} references unknown account ${app.account}`);
  }
  for (const a of accounts) {
    if (!/^[2-9A-HJ-NP-Z]{13}$/.test(a.payer_id)) throw new Error(`account ${a.key} has an invalid payer_id`);
    for (const [cur, v] of Object.entries(a.balances ?? {})) {
      if (toCents(v) === null) throw new Error(`account ${a.key} has an invalid ${cur} balance`);
    }
  }
  return { accounts, apps, unregistered_receivers: raw.unregistered_receivers ?? [] };
}
