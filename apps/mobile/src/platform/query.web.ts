/**
 * The page's query string (stage frames pass `?theme=&tier=`, S2.1; demo links pass `?demo=&stage=`; tests pass
 * `?motion=` and `?fsTrace=`).
 *
 * The index redirect replaces the URL right after the first render, so flags that hold for the whole visit are read
 * from the URL the app was opened with (`bootQuery`), captured when this module is first evaluated, before any
 * route renders. `webQuery` reads the address bar as it is now.
 */
const BOOT_SEARCH: string = (() => {
  try {
    return typeof window !== "undefined" ? window.location.search : "";
  } catch {
    return "";
  }
})();

export function webQuery(name: string): string | null {
  try {
    return typeof window !== "undefined" ? new URLSearchParams(window.location.search).get(name) : null;
  } catch {
    return null;
  }
}

/** A flag from the URL the app was opened with: it survives the index redirect and tab changes. */
export function bootQuery(name: string): string | null {
  try {
    return new URLSearchParams(BOOT_SEARCH).get(name);
  } catch {
    return null;
  }
}

/** The query string the app was opened with (`?demo=member&stage=sent`), or "". */
export function bootSearch(): string {
  return BOOT_SEARCH;
}
