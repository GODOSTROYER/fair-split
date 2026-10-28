// The console's test setup supplies the browser APIs jsdom lacks. jsdom defines some of them as "Not
// implemented" placeholders (native functions that print to the virtual console), so a guard like
// `if (!window.scrollTo)` never installs the stub. These checks expect the console's own stubs instead.

import { describe, expect, it } from "vitest";

describe("test setup", () => {
  it("stubs window.scrollTo, so router scroll restoration prints nothing", () => {
    expect(String(window.scrollTo)).not.toContain("[native code]");
    expect(window.scrollTo(0, 0)).toBeUndefined();
  });
});
