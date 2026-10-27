/**
 * The web export has no push: judge phone frames show a labelled "Simulated push" banner on the co-sign request
 * instead (S1.9 M-BD-01; architecture §16), and a judge's own phone browser checks when the page is open.
 */
import type { PushChannels, PushRegistration } from "./push";

export type { PushChannels, PushRegistration } from "./push";

export function configureNotificationHandling(_onOpen: (route: string) => void): () => void {
  return () => {};
}

export async function registerForPush(_channels: PushChannels): Promise<PushRegistration> {
  return { status: "unsupported" };
}

export function openPushSettings(): void {}
