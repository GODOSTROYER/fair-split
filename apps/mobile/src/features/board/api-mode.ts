/** Every stage persona switches from labelled preview only on an accepted IC-12 session. */
export function boardApiMode(
  origin: string | null,
  framed: boolean,
  session: { role: string; bearer: string } | null,
): "live" | "demo" {
  if (!origin) return "demo";
  if (!framed) return session?.bearer === "demo-session" ? "demo" : "live";
  return session && session.bearer !== "demo-session" ? "live" : "demo";
}

/** Remount role state when a preview becomes a workspace, or a different workspace/persona replaces it. */
export function sessionSurfaceKey(
  mode: "live" | "demo",
  session: { workspaceId: string; persona: string } | null,
): string {
  return JSON.stringify([mode, session?.workspaceId ?? null, session?.persona ?? null]);
}
