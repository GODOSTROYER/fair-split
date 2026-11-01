/** Clerk stays on its labelled demo rail; the Chair switches only on an accepted IC-12 session. */
export function boardApiMode(
  origin: string | null,
  framed: boolean,
  session: { role: string; bearer: string } | null,
): "live" | "demo" {
  if (!origin) return "demo";
  if (!framed) return session?.bearer === "demo-session" ? "demo" : "live";
  return session?.role === "board" && session.bearer !== "demo-session" ? "live" : "demo";
}
