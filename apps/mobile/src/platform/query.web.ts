/** Reads a query parameter of the current page (stage frames pass `?theme=&tier=`, S2.1). */
export function webQuery(name: string): string | null {
  try {
    return typeof window !== "undefined" ? new URLSearchParams(window.location.search).get(name) : null;
  } catch {
    return null;
  }
}
