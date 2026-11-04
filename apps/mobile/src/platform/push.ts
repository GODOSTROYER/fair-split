/**
 * Push registration scaffold (architecture §8 Background; plan P1, cut order item 3). Expo push over FCM V1 carries
 * the board's co-sign request and the member's "Bayad na". Credentials are the user's step (`eas init` for the
 * project ID, the FCM V1 key through `eas credentials`, google-services.json as an EAS file secret), so until they
 * exist this reports `unconfigured` and the app works without push; screens say so (I8). Nothing here holds a
 * credential, and a tapped notification can only open one of the app's own routes (`pushRoute`).
 */
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Linking, Platform } from "react-native";
import { pushRoute } from "../lib/pairing";

export type PushRegistration =
  | { status: "registered"; token: string }
  | { status: "denied" }
  | { status: "unconfigured"; reason: string }
  | { status: "unsupported" };

/** Android channel names, in the app's language (they show in the phone's notification settings). */
export interface PushChannels {
  cosign: string;
  bayad: string;
}

let handlerSet = false;

export function configureNotificationHandling(onOpen: (route: string) => void): () => void {
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
    const route = pushRoute(response.notification.request.content.data);
    if (route) onOpen(route);
  });
  return () => sub.remove();
}

export async function registerForPush(channels: PushChannels): Promise<PushRegistration> {
  if (Platform.OS === "web") return { status: "unsupported" };
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("cosign", {
      name: channels.cosign,
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: "#14CC90",
    });
    await Notifications.setNotificationChannelAsync("bayad", {
      name: channels.bayad,
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

/** The app's page in the phone's settings, where notifications are turned back on. */
export function openPushSettings(): void {
  void Linking.openSettings().catch(() => {});
}
