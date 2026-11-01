let requestedRun: string | null = null;
export function continueProof(runSlug: string): void {
  requestedRun = runSlug;
}
export function takeProofContinuation(runSlug: string): boolean {
  if (requestedRun !== runSlug) return false;
  requestedRun = null;
  return true;
}
