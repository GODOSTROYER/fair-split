import { isApiClientError } from "@fairsplit/api-client";

const DISCOVERY_WAITS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;

function cancelled(): Error {
  return new Error("Member statement discovery cancelled");
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** A judge frame can arrive before computation creates its member line. Only discovery's typed 404 may wait. */
export async function discoverMemberLine<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw cancelled();
    try {
      return await read();
    } catch (error) {
      const delay = DISCOVERY_WAITS_MS[attempt];
      if (!isApiClientError(error, "NOT_FOUND") || error.status !== 404 || delay === undefined) throw error;
      await wait(delay, signal);
    }
  }
}
