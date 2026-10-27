/**
 * Push scaffold wiring (architecture §8; the shell's seam, SPLIT.md): once a phone is paired, register for Expo push
 * (FCM V1) and hand the token to fs-api; a tapped notification opens its in-app route (a co-sign request or the
 * statement), checked by `pushRoute`. Without EAS credentials registration reports `unconfigured` and nothing else
 * changes; the co-sign screen says so in words (I8), and judge frames show a labelled "Simulated push" instead.
 *
 * The root layout calls `usePushRegistration()` once; screens read the same result with `usePushStatus()`, so a
 * screen never registers a second time.
 */
import { type Href, router } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { t as boardCopy } from "../features/board/messages";
import { configureNotificationHandling, type PushRegistration, registerForPush } from "../platform/push";
import { useApp } from "./app";

let snapshot: PushRegistration | null = null;
const listeners = new Set<() => void>();

function publish(r: PushRegistration | null): void {
  snapshot = r;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const read = () => snapshot;

/** The latest registration result, or null before the phone is paired (or while it registers). */
export function usePushStatus(): PushRegistration | null {
  return useSyncExternalStore(subscribe, read, read);
}

export function usePushRegistration(): PushRegistration | null {
  const { session, api, lang } = useApp();
  const kind = session?.kind ?? null;
  const bearer = session?.bearer ?? null;

  useEffect(() => configureNotificationHandling((route) => router.push(route as Href)), []);

  useEffect(() => {
    if (!bearer) {
      publish(null);
      return;
    }
    let alive = true;
    // Only a phone paired with its own device token registers; a stage frame, a judge's browser or a demo session
    // never asks for notification permission (web reports `unsupported`, a native demo `unconfigured`).
    const registration: Promise<PushRegistration> =
      kind === "device" || Platform.OS === "web"
        ? registerForPush({
            cosign: boardCopy(lang, "push.channel.cosign"),
            bayad: boardCopy(lang, "push.channel.bayad"),
          })
        : Promise.resolve({ status: "unconfigured", reason: "not a paired device" });
    void registration
      .then(async (r) => {
        if (!alive) return;
        publish(r);
        if (kind === "device" && r.status === "registered") {
          await api.registerPushToken({ token: r.token, platform: "expo" });
        }
      })
      .catch(() => {
        if (alive) publish({ status: "unconfigured", reason: "registration failed" });
      });
    return () => {
      alive = false;
    };
  }, [kind, bearer, api, lang]);

  return usePushStatus();
}
