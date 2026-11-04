// ADR-0016: the app's system colours (splash, web theme-color, notification accent, the adaptive icon's ground and
// the push channel's light) are Hayag's, never the v1 cacao and brown the owner asked to lose.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const V1 = ["#201712", "#1C1511", "#EEEEEA", "#2FD3A0", "#FF8A2A"];

describe("the app's system colours", () => {
  it("are Hayag's in app.config.ts: ground #F3F5F8, ink #0B1220", () => {
    const config = read("app.config.ts");
    for (const hex of V1) expect(config.toUpperCase(), hex).not.toContain(hex);
    expect(config).toContain('themeColor: "#F3F5F8"');
    expect(config).toContain('primaryColor: "#0B1220"');
  });

  it("light the co-sign channel in Hayag's jade", () => {
    const push = read("src/platform/push.ts");
    for (const hex of V1) expect(push.toUpperCase(), hex).not.toContain(hex);
    expect(push).toContain('lightColor: "#14CC90"');
  });
});
