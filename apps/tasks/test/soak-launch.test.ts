import { expect, it } from "vitest";
import { apiStartArgs } from "../../../tools/soak/launch.js";

it("preserves the production memory limits when profiling the dist server", () => {
  expect(
    apiStartArgs("node --max-old-space-size=128 --max-semi-space-size=8 apps/api/dist/index.js"),
  ).toEqual(["--max-old-space-size=128", "--max-semi-space-size=8", "apps/api/dist/index.js"]);
  expect(apiStartArgs("node apps/api/dist/index.js")).toEqual(["apps/api/dist/index.js"]);
  for (const command of [
    "node --eval=x apps/api/dist/index.js",
    "node x.js",
    "node apps/api/dist/index.js && echo x",
  ]) {
    expect(() => apiStartArgs(command)).toThrow(/start command/);
  }
});
