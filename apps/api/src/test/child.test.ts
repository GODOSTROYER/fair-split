import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForChild } from "./child.js";

function childFixture() {
  const child = new ChildProcess();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const kill = vi.spyOn(child, "kill").mockReturnValue(true);
  return { child, kill };
}

afterEach(() => vi.useRealTimers());

describe("boot child completion", () => {
  it("waits for exit and drained output, even when a refusal log arrives first", async () => {
    vi.useFakeTimers();
    const { child, kill } = childFixture();
    const done = vi.fn();
    const result = waitForChild(child, 120_000).then(done);
    child.stdout?.emit("data", "fs-api refuses to boot\n");
    await vi.advanceTimersByTimeAsync(110_000);
    expect(done).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
    child.emit("exit", 1, null);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    child.stderr?.emit("data", "FS_APP_DB_PASSWORD\n");
    child.emit("close", 1, null);
    await result;
    expect(done).toHaveBeenCalledWith({
      status: 1,
      output: "fs-api refuses to boot\nFS_APP_DB_PASSWORD\n",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("kills an over-budget child, waits for close, and reports a timeout instead of a null status", async () => {
    vi.useFakeTimers();
    const { child, kill } = childFixture();
    const failed = vi.fn();
    const result = waitForChild(child, 120_000).catch(failed);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(failed).not.toHaveBeenCalled();
    child.emit("close", null, "SIGKILL");
    await result;
    expect(failed.mock.calls[0]?.[0]).toEqual(new Error("Boot child timed out after 120000 ms"));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports spawn errors and clears the deadline", async () => {
    vi.useFakeTimers();
    const { child } = childFixture();
    const result = expect(waitForChild(child, 120_000)).rejects.toThrow("spawn failed");
    child.emit("error", new Error("spawn failed"));
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the deadline and waits for close after an error from an already spawned child", async () => {
    vi.useFakeTimers();
    const { child, kill } = childFixture();
    Object.defineProperty(child, "pid", { value: 1234 });
    const failed = vi.fn();
    const result = waitForChild(child, 120_000).catch(failed);
    child.emit("error", new Error("child operation failed"));
    await Promise.resolve();
    expect(failed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    child.emit("close", 1, null);
    await result;
    expect(failed.mock.calls[0]?.[0]).toEqual(new Error("child operation failed"));
    expect(kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not abandon a spawned child when killing it reports an error", async () => {
    vi.useFakeTimers();
    const { child, kill } = childFixture();
    Object.defineProperty(child, "pid", { value: 1234 });
    kill.mockImplementation(() => {
      child.emit("error", new Error("kill failed"));
      return false;
    });
    const failed = vi.fn();
    const result = waitForChild(child, 120_000).catch(failed);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(failed).not.toHaveBeenCalled();
    child.emit("close", 1, null);
    await result;
    expect(failed.mock.calls[0]?.[0]).toEqual(new Error("Boot child timed out after 120000 ms"));
  });

  it("rejects signal termination rather than returning a null status", async () => {
    const { child } = childFixture();
    const result = expect(waitForChild(child, 120_000)).rejects.toThrow("Boot child ended with SIGTERM");
    child.emit("close", null, "SIGTERM");
    await result;
  });
});
