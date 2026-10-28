/** Native SSE needs a fetch whose response body streams: `expo/fetch` (spike S7). */
import { fetch as expoFetch } from "expo/fetch";

export const streamingFetch = expoFetch as unknown as typeof fetch;
