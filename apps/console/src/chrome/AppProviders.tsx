// Everything a console surface needs above the router: the data runtime (adapter, Query, session, SSE hub),
// ui-web's surface settings (English, the viewer's motion), the polite announcer, keyboard shortcuts, Data
// mode and the chrome's slots.

import { type MotionPreference, UiProvider } from "@fairsplit/ui-web";
import type { ReactNode } from "react";
import { DataProvider, type DataRuntime } from "../data/provider.js";
import { AnnouncerProvider } from "../lib/announce.js";
import { DataModeProvider } from "../lib/data-mode.js";
import { ShortcutsProvider } from "../lib/shortcuts.js";
import { ChromeSlotsProvider } from "./slots.js";

/** `?motion=full|reduced|low` forces a renderer for tests and recordings (S2.10); otherwise the system's. */
export function motionFromLocation(
  search: string = typeof window === "undefined" ? "" : window.location.search,
): MotionPreference {
  const value = new URLSearchParams(search).get("motion");
  return value === "full" || value === "reduced" || value === "low" ? value : "system";
}

export interface AppProvidersProps {
  readonly runtime: DataRuntime;
  readonly motion?: MotionPreference;
  readonly children: ReactNode;
}

export function AppProviders({ runtime, motion = "system", children }: AppProvidersProps) {
  return (
    <DataProvider runtime={runtime}>
      <UiProvider lang="en" motion={motion}>
        <AnnouncerProvider>
          <ShortcutsProvider>
            <DataModeProvider>
              <ChromeSlotsProvider>{children}</ChromeSlotsProvider>
            </DataModeProvider>
          </ShortcutsProvider>
        </AnnouncerProvider>
      </UiProvider>
    </DataProvider>
  );
}
