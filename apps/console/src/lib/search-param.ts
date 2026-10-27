// Query parameters the frozen route files do not declare. Kept apart from route-params.ts, which the route files
// import, so its router-typed hook never feeds back into the route tree's own type.

import { useRouterState } from "@tanstack/react-router";

/**
 * A query parameter the frozen route files do not declare (`?play=1` on /judge, `?verify=1` on Proof): the raw
 * value, or undefined. Routes validate only the register's own params (`?photo=`, `?hold=`, `?member=`); a
 * screen that reads anything else validates it itself and treats a bad value as absent.
 */
export function useSearchParam(name: string): string | undefined {
  const search = useRouterState({ select: (s) => s.location.search });
  return searchParamValue(search as Readonly<Record<string, unknown>>, name);
}

/** The value of one parsed query parameter as a string (TanStack Router parses `?play=1` as the number 1). */
export function searchParamValue(
  search: Readonly<Record<string, unknown>>,
  name: string,
): string | undefined {
  const value = search[name];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}
