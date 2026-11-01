import { isApiClientError } from "@fairsplit/api-client";

/** A pace hint is one deferred press, never a polling loop. */
export async function pacedCall<T>(
  call: () => Promise<T>,
  queued: (ms: number | null) => void,
  current: () => boolean = () => true,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!isApiClientError(error, "QUEUED") || error.retryAfterMs === null) throw error;
    queued(error.retryAfterMs);
    try {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException("The session ended before its queued press.", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", abort);
          resolve();
        }, error.retryAfterMs ?? 0);
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
      if (!current()) throw new Error("The session ended before its queued press.");
      return await call();
    } finally {
      queued(null);
    }
  }
}
