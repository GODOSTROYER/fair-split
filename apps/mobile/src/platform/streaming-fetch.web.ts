/** Browsers stream fetch bodies natively. */
export const streamingFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);
