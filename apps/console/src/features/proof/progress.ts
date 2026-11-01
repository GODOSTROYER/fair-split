// The public Proof stream (S3.7: `GET /v1/proof/:runSlug/events`, anonymous): aggregate counters only, never a
// member or a receiver. fs-api sends `proof.progress` with every status group; api-client's mock sends a smaller
// `aggregate` ({confirmed, parked, of}). Both are read here into the same counts, which only move forward (I5).

import type { SseRawMessage } from "@fairsplit/api-client";
import { z } from "zod";
import type { ProgressCounts } from "./model.js";

const Count = z.int().nonnegative();

/** fs-api's `proof.progress` payload (the proof slice's ProofProgress). */
const ServerProgress = z.looseObject({
  items: z.looseObject({
    total: Count,
    sent: Count,
    confirmed: Count,
    held: Count,
    parked: Count,
    returned: Count,
    failed: Count,
    reversed: Count,
  }),
});

/** api-client's mock: `parked` counts UNCLAIMED and RETURNED together, so it cannot tell them apart. */
const MockAggregate = z.looseObject({ confirmed: Count, parked: Count, of: Count });

export interface ProgressMessage {
  readonly counts: ProgressCounts;
  /** The SSE id, for "motion is evidence" (a moment or announcement starts only from a real event). */
  readonly eventId: string | null;
}

export function progressFromMessage(message: SseRawMessage): ProgressMessage | null {
  const eventId = message.id ?? null;
  const server = ServerProgress.safeParse(message.data);
  if (server.success) {
    const i = server.data.items;
    return {
      eventId,
      counts: {
        total: i.total,
        sent: i.sent,
        confirmed: i.confirmed,
        held: i.held,
        parked: i.parked,
        returned: i.returned,
        failed: i.failed,
        reversed: i.reversed,
      },
    };
  }
  const mock = MockAggregate.safeParse(message.data);
  if (mock.success) {
    const { confirmed, parked, of } = mock.data;
    if (confirmed + parked > of) return null;
    return {
      eventId,
      counts: {
        total: of,
        sent: of - confirmed - parked,
        confirmed,
        held: 0,
        parked,
        returned: 0,
        failed: 0,
        reversed: 0,
      },
    };
  }
  return null;
}
