// The existing brand read outside IC-01. No brand DTO exists in contracts yet; JSON Schema parity with
// fs-api's BrandView keeps this projection aligned without changing the frozen shared contract.
import {
  KgDTO,
  MoneyDTO,
  PayoutItemStatus,
  PayRunState,
  Provenance,
  Rail,
  RunSlug,
} from "@fairsplit/contracts";
import { z } from "zod";
import type { ApiClient, CallOptions } from "./client.js";
import type { RouteSpec } from "./routes.js";

export const BrandMember = z.strictObject({
  memberNo: z.string(),
  name: z.string(),
  lang: z.enum(["ceb", "fil", "en"]),
  rail: Rail,
  verified: KgDTO,
  net: MoneyDTO,
  state: z.string(),
  stateWords: z.string(),
  receiverMasked: z.string().nullable(),
  senderItemId: z.string().nullable(),
  payoutItemId: z.string().nullable(),
  itemStatus: PayoutItemStatus.nullable(),
  lineSha256: z.string().nullable(),
});
export type BrandMember = z.infer<typeof BrandMember>;

export const BrandView = z.strictObject({
  runSlug: RunSlug,
  runState: PayRunState,
  provenance: Provenance,
  brand: z.string(),
  invoice: z.strictObject({
    invoiceNumber: z.string(),
    status: z.string(),
    statusWords: z.string(),
    amount: MoneyDTO,
    reference: z.string(),
    payerViewUrl: z.url().nullable(),
  }),
  proofReady: z.boolean(),
  totals: z.strictObject({
    members: z.int().nonnegative(),
    net: MoneyDTO,
    paypalMembers: z.int().nonnegative(),
    paypal: MoneyDTO,
    cashMembers: z.int().nonnegative(),
    cash: MoneyDTO,
  }),
  members: z.array(BrandMember),
  hashes: z.strictObject({
    rateCardSha256: z.string(),
    batchSha256: z.string().nullable(),
    ledgerHead: z.strictObject({ seq: z.int().nonnegative(), entryHash: z.string() }).nullable(),
  }),
  exportPath: z.string(),
});
export type BrandView = z.infer<typeof BrandView>;

export const BRAND_ROUTES = {
  view: {
    method: "GET",
    path: "/v1/brand/:runSlug",
    auth: "public",
    request: null,
    response: BrandView,
    success: [200],
  },
} as const satisfies Record<string, RouteSpec>;

export interface BrandRouteMethods {
  /** Brand link, brand persona, co-op officers or judge, in the run's workspace. */
  view(args: { params: { runSlug: string } } & CallOptions): Promise<BrandView>;
}

export function brandRoutes(api: ApiClient): BrandRouteMethods {
  return {
    view: ({ params, ...options }) => {
      const route = BRAND_ROUTES.view;
      return api.request({
        ...options,
        name: "brand.view",
        method: route.method,
        path: route.path,
        params,
        schema: route.response,
      });
    },
  };
}
