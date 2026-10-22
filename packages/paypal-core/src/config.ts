// PayPal settings from the environment, validated at boot (S3.13).
//
// The specs name the variables PP_* (S3.13, architecture §16); the scaffold's .env.example uses
// PAYPAL_*. Both are read, PP_* first, so either file layout works until WS-QA settles the names.
// Errors name the variables, never their values.

import { z } from "zod";
import { PAYPAL_API_BASE_URL } from "./env.js";
import { PayPalConfigError } from "./errors.js";
import { MOCK_WEBHOOK_ID } from "./webhook/verify.js";

export interface PayPalRuntimeConfig {
  env: "sandbox";
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** PP_WEBHOOK_ID; null when not required (e.g. while registering the webhook). */
  webhookId: string | null;
  /** PP_DEV_MOCKS=1: accept simulator events as 'dev_mock'. Refused when NODE_ENV=production. */
  devMocks: boolean;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

const NAMES = {
  env: ["PP_ENV", "PAYPAL_ENV"],
  clientId: ["PP_CLIENT_ID", "PAYPAL_CLIENT_ID"],
  clientSecret: ["PP_CLIENT_SECRET", "PAYPAL_CLIENT_SECRET"],
  webhookId: ["PP_WEBHOOK_ID", "PAYPAL_WEBHOOK_ID"],
  devMocks: ["PP_DEV_MOCKS", "PAYPAL_DEV_MOCKS"],
} as const;

function pick(source: EnvSource, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = source[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

const WebhookIdSchema = z.string().regex(/^[A-Za-z0-9]{1,50}$/);
const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function loadPayPalConfig(
  source: EnvSource = process.env,
  options: { requireWebhookId?: boolean } = {},
): PayPalRuntimeConfig {
  const env = pick(source, NAMES.env);
  if (env !== "sandbox") {
    throw new PayPalConfigError(
      env === undefined ? "MISSING_ENV" : "NOT_SANDBOX",
      "PP_ENV must be set to sandbox; Fair Split never talks to live PayPal",
      [NAMES.env[0]],
    );
  }
  const clientId = pick(source, NAMES.clientId);
  const clientSecret = pick(source, NAMES.clientSecret);
  const missing: string[] = [
    ...(clientId ? [] : [NAMES.clientId[0]]),
    ...(clientSecret ? [] : [NAMES.clientSecret[0]]),
  ];
  const webhookId = pick(source, NAMES.webhookId) ?? null;
  if (options.requireWebhookId !== false && webhookId === null) missing.push(NAMES.webhookId[0]);
  if (missing.length > 0 || !clientId || !clientSecret) {
    throw new PayPalConfigError("MISSING_ENV", `missing PayPal settings: ${missing.join(", ")}`, missing);
  }
  if (webhookId === MOCK_WEBHOOK_ID) {
    throw new PayPalConfigError(
      "WEBHOOK_ID_IS_MOCK_LITERAL",
      "PP_WEBHOOK_ID is the simulator's literal WEBHOOK_ID; use the id printed by tools/setup-webhooks.ts",
      [NAMES.webhookId[0]],
    );
  }
  if (webhookId !== null && !WebhookIdSchema.safeParse(webhookId).success) {
    throw new PayPalConfigError("INVALID_VALUE", "PP_WEBHOOK_ID must be 1-50 letters and digits", [
      NAMES.webhookId[0],
    ]);
  }
  const devMocks = TRUTHY.has((pick(source, NAMES.devMocks) ?? "").toLowerCase());
  if (devMocks && source.NODE_ENV === "production") {
    throw new PayPalConfigError(
      "DEV_MOCKS_IN_PRODUCTION",
      "PP_DEV_MOCKS cannot be on when NODE_ENV=production (simulator events would be accepted)",
      [NAMES.devMocks[0], "NODE_ENV"],
    );
  }
  return {
    env: "sandbox",
    baseUrl: PAYPAL_API_BASE_URL.sandbox,
    clientId,
    clientSecret,
    webhookId,
    devMocks,
  };
}
