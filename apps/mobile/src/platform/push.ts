/**
 * Push registration scaffold (architecture §8 Background; cut order item 3). Expo push over FCM V1 carries the
 * board's co-sign request and the member's "Bayad na". Credentials are the user's step (`eas init` for the
 * project ID, FCM V1 key via `eas credentials`, google-services.json as an EAS file secret), so without them this
 * reports `unconfigured` and the app works without push. Nothing here holds a credential.
 */
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export type PushRegistration =
  | { status: "registered"; token: string }
  | { status: "denied" }
  | { status: "unconfigured"; reason: string }
  | { status: "unsupported" };

let handlerSet = false;

export function configureNotificationHandling(onOpen: (url: string) => void): () => void {
  if (!handlerSet) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    handlerSet = true;
  }
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const url = response.notification.request.content.data?.url;
    // Only in-app routes: a push can never send the phone to an outside address.
    if (typeof url === "string" && url.startsWith("/")) onOpen(url);
  });
  return () => sub.remove();
}

export async function registerForPush(): Promise<PushRegistration> {
  if (Platform.OS === "web") return { status: "unsupported" };
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("cosign", {
      name: "Co-sign requests",
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: "#2FD3A0",
    });
    await Notifications.setNotificationChannelAsync("bayad", {
      name: "Bayad na (payments)",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return { status: "denied" };
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId) return { status: "unconfigured", reason: "no EAS project ID (run eas init)" };
  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return { status: "registered", token: token.data };
  } catch (e) {
    return { status: "unconfigured", reason: e instanceof Error ? e.message : "FCM credentials missing" };
  }
}
