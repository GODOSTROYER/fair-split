// The toolkit's PayPalAPI.run() never throws and drops PayPal's debug id and HTTP status (S3
// §S3.6.3). We recover both, and give the toolkit's otherwise unbounded requests a timeout, with
// interceptors on the toolkit's own axios instance. The interceptors act only inside a tk() call
// (AsyncLocalStorage), so any other axios user in the process is untouched.

import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";

export interface CallCapture {
  /** paypal-debug-id of the last response the toolkit received in this call. */
  debugId: string | null;
  /** HTTP status of the last response; null when no response arrived. */
  status: number | null;
  /** axios error code when no response arrived (timeout, network), e.g. "ECONNABORTED". */
  transportError: string | null;
  timeoutMs: number;
}

interface HeaderBag {
  get?: (name: string) => unknown;
  [name: string]: unknown;
}

interface AxiosLikeResponse {
  status: number;
  headers?: HeaderBag;
}

interface AxiosLikeError {
  code?: string;
  response?: AxiosLikeResponse;
}

interface AxiosLikeConfig {
  timeout?: number;
}

interface AxiosLike {
  interceptors: {
    request: { use(onFulfilled: (config: AxiosLikeConfig) => AxiosLikeConfig): number };
    response: {
      use(
        onFulfilled: (res: AxiosLikeResponse) => AxiosLikeResponse,
        onRejected: (err: unknown) => unknown,
      ): number;
    };
  };
}

const store = new AsyncLocalStorage<CallCapture>();
let installed = false;

function header(bag: HeaderBag | undefined, name: string): string | null {
  if (!bag) return null;
  const value = typeof bag.get === "function" ? bag.get(name) : bag[name];
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

/** Resolves axios exactly as the toolkit's bundle does (`require("axios")` from its own directory). */
function toolkitAxios(): AxiosLike {
  const entry = createRequire(import.meta.url).resolve("@paypal/agent-toolkit/mcp");
  return createRequire(entry)("axios") as AxiosLike;
}

export function installCapture(): void {
  if (installed) return;
  const axios = toolkitAxios();
  axios.interceptors.request.use((config) => {
    const capture = store.getStore();
    if (capture && !config.timeout) config.timeout = capture.timeoutMs;
    return config;
  });
  axios.interceptors.response.use(
    (res) => {
      const capture = store.getStore();
      if (capture) {
        capture.status = res.status;
        capture.debugId = header(res.headers, "paypal-debug-id");
        capture.transportError = null;
      }
      return res;
    },
    (err: unknown) => {
      const capture = store.getStore();
      if (capture) {
        const e = (err ?? {}) as AxiosLikeError;
        capture.status = e.response?.status ?? null;
        capture.debugId = header(e.response?.headers, "paypal-debug-id");
        capture.transportError = e.response ? null : (e.code ?? "NETWORK_ERROR");
      }
      return Promise.reject(err);
    },
  );
  installed = true;
}

export function withCapture<T>(capture: CallCapture, run: () => Promise<T>): Promise<T> {
  return store.run(capture, run);
}
