/** Every simulator response and webhook delivery carries `x-fairsplit-simulated: true`. */
export const SIMULATED_HEADER = "x-fairsplit-simulated";

/** The sandbox hosts the in-process interceptor routes to the simulator. Live hosts are never touched. */
export const SANDBOX_HOSTS = ["api-m.sandbox.paypal.com", "api.sandbox.paypal.com"] as const;

export const SCOPES = {
  invoicing: "https://uri.paypal.com/services/invoicing",
  payouts: "https://uri.paypal.com/payments/payouts",
  webhooks: "https://uri.paypal.com/services/applications/webhooks",
  search: "https://uri.paypal.com/services/reporting/search/read",
  balances: "https://uri.paypal.com/services/reporting/balances/read",
} as const;
