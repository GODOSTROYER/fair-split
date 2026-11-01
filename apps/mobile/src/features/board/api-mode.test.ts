import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boardApiMode, sessionSurfaceKey } from "./api-mode";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("frame API handoff", () => {
  it("labels the local preview until a frame token, then uses HTTP for each persona", () => {
    expect(boardApiMode("http://localhost", true, null)).toBe("demo");
    expect(boardApiMode("http://localhost", true, { role: "board", bearer: "demo-session" })).toBe("demo");
    for (const role of ["board", "member"]) {
      expect(boardApiMode("http://localhost", true, { role, bearer: "accepted-frame-token" })).toBe("live");
    }
    expect(boardApiMode("http://localhost", true, { role: "clerk", bearer: "accepted-frame-token" })).toBe(
      "demo",
    );
  });

  it("drops local screen state on demo-to-HTTP and workspace/persona transitions without keying on a secret", () => {
    const session = { workspaceId: "judge-workspace", persona: "board:ernesto" };
    const live = sessionSurfaceKey("live", session);
    expect(live).not.toBe(sessionSurfaceKey("demo", session));
    expect(live).not.toBe(sessionSurfaceKey("live", { ...session, workspaceId: "other-workspace" }));
    expect(live).not.toBe(sessionSurfaceKey("live", { ...session, persona: "member:M-014" }));
    expect(live).toBe(sessionSurfaceKey("live", { ...session }));
    expect(sessionSurfaceKey("demo", null)).not.toBe(live);
  });

  it("wires the session boundary, demo label and fresh frame route into the actual shell", () => {
    const app = read("state/app.tsx");
    expect(app).toContain("apiOrigin(inFrame)");
    expect(app).toMatch(/<AppContext\.Provider\s+key=\{sessionSurfaceKey\(api\.mode, session\)\}/);
    expect(read("app/_layout.tsx")).toMatch(/router\.replace\("\/"\)/);
    expect(read("ui/primitives.tsx")).toMatch(
      /function DemoLabel[\s\S]*?if \(!demo\) return null;[\s\S]*?common\.demoData/,
    );
  });
});
