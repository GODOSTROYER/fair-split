/** Web frames show a labelled in-frame banner instead of push (architecture §16). */
import type { PushRegistration } from "./push";

export type { PushRegistration } from "./push";

export function configureNotificationHandling(_onOpen: (url: string) => void): () => void {
  return () => {};
}

export async function registerForPush(): Promise<PushRegistration> {
  return { status: "unsupported" };
}
