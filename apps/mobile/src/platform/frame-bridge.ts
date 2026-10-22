/** Native has no judge stage; frame tokens only exist in the web export. */
export interface FrameGrant {
  token: string;
  persona: string;
  role: "member" | "clerk" | "board";
  workspaceId: string;
  memberNo: string | null;
  displayName: string;
  expiresAt: string;
}

export const inFrame = false;

export function listenForFrameGrant(_onGrant: (g: FrameGrant) => void): () => void {
  return () => {};
}
