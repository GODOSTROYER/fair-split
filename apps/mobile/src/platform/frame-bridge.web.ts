/**
 * Judge stage phone frames (S3.8): the frame posts `fs.ready` to its same-origin parent, which answers with a frame
 * token for `member:M-014`, `board:ernesto` or `clerk:jessie`. The token arrives by postMessage only, never in a
 * URL, and only from our own origin.
 */
import type { FrameGrant } from "./frame-bridge";

export type { FrameGrant } from "./frame-bridge";

export const inFrame = typeof window !== "undefined" && window.parent !== window;

function isGrant(d: unknown): d is { type: "fs.frame-token" } & FrameGrant {
  if (!d || typeof d !== "object") return false;
  const g = d as Record<string, unknown>;
  return (
    g.type === "fs.frame-token" &&
    typeof g.token === "string" &&
    typeof g.persona === "string" &&
    (g.role === "member" || g.role === "clerk" || g.role === "board") &&
    typeof g.workspaceId === "string" &&
    typeof g.displayName === "string" &&
    typeof g.expiresAt === "string"
  );
}

export function listenForFrameGrant(onGrant: (g: FrameGrant) => void): () => void {
  if (!inFrame) return () => {};
  const handler = (e: MessageEvent) => {
    if (e.origin !== window.location.origin || e.source !== window.parent) return;
    if (!isGrant(e.data)) return;
    const { token, persona, role, workspaceId, displayName, expiresAt } = e.data;
    onGrant({ token, persona, role, workspaceId, displayName, expiresAt, memberNo: e.data.memberNo ?? null });
  };
  window.addEventListener("message", handler);
  window.parent.postMessage({ type: "fs.ready" }, window.location.origin);
  return () => window.removeEventListener("message", handler);
}
