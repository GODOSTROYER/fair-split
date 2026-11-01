import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({ default: { expoConfig: {} } }));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

import { apiOrigin } from "./build";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("frame API origin", () => {
  it("uses its own origin after a frame handoff even with an unset build origin", () => {
    vi.stubEnv("EXPO_PUBLIC_API_ORIGIN", "");
    vi.stubGlobal("window", { location: { origin: "http://localhost:4317" } });
    expect(apiOrigin(true)).toBe("http://localhost:4317");
  });

  it("never sends a frame token to a configured foreign API origin", () => {
    vi.stubEnv("EXPO_PUBLIC_API_ORIGIN", "https://foreign.invalid");
    vi.stubGlobal("window", { location: { origin: "http://localhost:4317" } });
    expect(apiOrigin(true)).toBe("http://localhost:4317");
    expect(apiOrigin(false)).toBe("https://foreign.invalid");
  });

  it("keeps a standalone export with no configured API in labelled demo mode", () => {
    vi.stubEnv("EXPO_PUBLIC_API_ORIGIN", "");
    expect(apiOrigin(false)).toBeNull();
  });
});
