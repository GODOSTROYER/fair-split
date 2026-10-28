// What W-TR-07 asks the API for before a person may sign: the approval payload (the batch hash and the lines root
// both keys sign) and the run's own member lines (GET /v1/runs/:runSlug/lines, fs-api's LineList), read together
// so the amounts on screen, the root this browser recomputes from them and the root the payload binds are from
// the same moment. The lines are the workspace's: their hashes cover the workspace's own mark IDs, which the seed
// cannot know.

import type { ApprovalPayload } from "@fairsplit/contracts";
import { z } from "zod";
import type { DataAdapter } from "../../data/adapter.js";
import type { ServedLine } from "./model.js";

/** The parts of fs-api's MemberLineDTO the screen reads (the rest is not relied on). */
const ServedLineRead = z.looseObject({
  memberNo: z.string().min(1),
  rail: z.enum(["PAYPAL", "CASH"]),
  state: z.string(),
  netCents: z.int(),
  lineSha256: z.string(),
});

const LinesRead = z.looseObject({ runSlug: z.string(), lines: z.array(ServedLineRead) });

export const LINES_PATH = "/v1/runs/:runSlug/lines";

export interface BatchToSign {
  readonly payload: ApprovalPayload;
  readonly jcs: string;
  readonly lines: readonly ServedLine[];
}

export async function readBatchToSign(
  adapter: DataAdapter,
  runSlug: string,
  signal?: AbortSignal,
): Promise<BatchToSign> {
  const options = signal ? { signal } : {};
  const [answer, read] = await Promise.all([
    adapter.call("approvalPayload", { params: { runSlug }, query: { role: "treasurer" } }, options),
    adapter.api.request({
      path: LINES_PATH,
      params: { runSlug },
      schema: LinesRead,
      name: "lines",
      ...options,
    }),
  ]);
  return { payload: answer.payload, jcs: answer.jcs, lines: read.lines };
}
