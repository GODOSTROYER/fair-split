import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const mobile = fileURLToPath(new URL("..", import.meta.url));
const seal = path.resolve(mobile, "../../packages/seal/src");

function config() {
  const module = { exports: {} };
  runInNewContext(readFileSync(path.join(mobile, "metro.config.js"), "utf8"), {
    module,
    __dirname: mobile,
    require(name) {
      if (name === "node:path") return path;
      if (name === "expo/metro-config") return { getDefaultConfig: () => ({ resolver: {} }) };
      throw new Error(`Unexpected Metro dependency: ${name}`);
    },
  });
  return module.exports;
}

describe("Metro's shared TypeScript package imports", () => {
  it.each(["golden", "seal"])(
    "resolves the seal package's NodeNext ./%s.js to its real TS source",
    (name) => {
      const resolveRequest = vi.fn((context, request) => {
        const file = path.resolve(path.dirname(context.originModulePath), request);
        if (existsSync(file)) return { type: "sourceFile", filePath: file };
        if (existsSync(`${file}.ts`)) return { type: "sourceFile", filePath: `${file}.ts` };
        throw new Error(`Unresolved module: ${request}`);
      });
      const context = { originModulePath: path.join(seal, "index.ts"), resolveRequest };
      const resolve = config().resolver.resolveRequest ?? resolveRequest;
      expect(resolve(context, `./${name}.js`, "web")).toEqual({
        type: "sourceFile",
        filePath: path.join(seal, `${name}.ts`),
      });
    },
  );

  it("keeps an existing JavaScript resolution and the platform", () => {
    const answer = { type: "sourceFile", filePath: "existing.js" };
    const resolveRequest = vi.fn(() => answer);
    const context = { originModulePath: path.join(seal, "index.ts"), resolveRequest };
    const resolve = config().resolver.resolveRequest ?? resolveRequest;
    expect(resolve(context, "./existing.js", "android")).toBe(answer);
    expect(resolveRequest.mock.calls).toEqual([[context, "./existing.js", "android"]]);
  });

  it("does not remap missing JavaScript imports outside workspace package sources", () => {
    const missing = new Error("Not found");
    const resolveRequest = vi.fn(() => {
      throw missing;
    });
    const context = { originModulePath: path.join(mobile, "src/app/index.tsx"), resolveRequest };
    const resolve = config().resolver.resolveRequest ?? resolveRequest;
    expect(() => resolve(context, "./missing.js", "web")).toThrow(missing);
    expect(resolveRequest).toHaveBeenCalledTimes(1);
  });
});
