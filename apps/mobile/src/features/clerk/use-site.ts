import { useMemo } from "react";
import { useApp } from "../../state/app";
import { useCashDay } from "./cash-provider";
import { type ClerkSite, clerkSite } from "./clerk-site";

/** This phone's station, the co-op's treasurer and the clerk's initials (see `clerkSite`), kept current. */
export function useClerkSite(): ClerkSite {
  const { session, api } = useApp();
  const { day } = useCashDay();
  const station = day?.station ?? null;
  const treasurer = day?.treasurer?.first ?? null;
  return useMemo(
    () =>
      clerkSite({
        session,
        demo: api.mode === "demo",
        day: { station, treasurer: treasurer ? { first: treasurer } : null },
      }),
    [session, api.mode, station, treasurer],
  );
}
