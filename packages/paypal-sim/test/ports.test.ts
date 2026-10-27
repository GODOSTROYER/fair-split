// test/setup.ts runs before every test file: a server in a test binds port 0 and reads the bound port back,
// so concurrent runs of this suite (or other worktrees' suites) can never clash on a port.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { fixedPort } from "./setup.js";

describe("tests bind ephemeral ports only", () => {
  it("reads the fixed port a listen() call asks for (none for port 0, a pipe or a handle)", () => {
    expect(fixedPort([4010, "127.0.0.1"])).toBe(4010);
    expect(fixedPort(["8787"])).toBe(8787);
    expect(fixedPort([{ port: 4010, host: "127.0.0.1" }])).toBe(4010);
    expect(fixedPort([{ port: "4010" }])).toBe(4010);
    expect(fixedPort([0, "127.0.0.1", () => {}])).toBeNull();
    expect(fixedPort([{ port: 0, host: "127.0.0.1" }])).toBeNull();
    expect(fixedPort([])).toBeNull();
    expect(fixedPort([() => {}])).toBeNull();
    expect(fixedPort(["\\\\.\\pipe\\paypal-sim-test"])).toBeNull();
    expect(fixedPort([{ path: "/tmp/paypal-sim-test.sock" }])).toBeNull();
    expect(fixedPort([{ fd: 3 }])).toBeNull();
  });

  it("refuses a fixed port before binding it, and binds port 0 to an ephemeral port that is read back", async () => {
    const server = createServer();
    expect(() => server.listen(4010, "127.0.0.1")).toThrow(/bind port 0/);
    expect(() => server.listen({ port: 4010, host: "127.0.0.1" })).toThrow(/bind port 0/);
    expect(server.listening).toBe(false);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    expect((server.address() as AddressInfo).port).toBeGreaterThan(0);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
