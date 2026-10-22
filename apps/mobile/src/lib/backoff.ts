/**
 * Upload retry schedule for the clerk outbox: 10, 20, 40, 80, 160 s, then every 5 minutes.
 * The third attempt reads "Mosulay pag-usab sa 40 s" (M-CK-02 `failed`).
 */
export const RETRY_BASE_MS = 10_000;
export const RETRY_CAP_MS = 300_000;

export function retryDelayMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (attempts - 1));
}
