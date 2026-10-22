/**
 * Push scaffold wiring (architecture §8): once a phone is paired, register for Expo push (FCM V1) and hand the
 * token to fs-api; a tapped notification opens its in-app route (a co-sign request or the statement). Without EAS
 * credentials registration reports `unconfigured` and nothing else changes.
 */
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { configureNotificationHandling, type PushRegistration, registerForPush } from "../platform/push";
import { useApp } from "./app";

export function usePushRegistration(): PushRegistration | null {
  const { session, api } = useApp();
  const [reg, setReg] = useState<PushRegistration | null>(null);

  useEffect(() => configureNotificationHandling((url) => router.push(url as never)), []);

  useEffect(() => {
    if (session?.kind !== "device") return;
    let alive = true;
    void registerForPush()
      .then(async (r) => {
        if (!alive) return;
        setReg(r);
        if (r.status === "registered") await api.registerPushToken({ token: r.token, platform: "expo" });
      })
      .catch(() => alive && setReg({ status: "unconfigured", reason: "registration failed" }));
    return () => {
      alive = false;
    };
  }, [session, api]);

  return reg;
}
