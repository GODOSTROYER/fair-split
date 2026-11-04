import { ApiClientError } from "@fairsplit/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverMemberLine } from "./discovery";

const failure = (status: number, code: "NOT_FOUND" | "UNAUTHENTICATED" | "FORBIDDEN" = "NOT_FOUND") =>
  new ApiClientError(
    { code, status, message: "No available member statement." },
    { command: "statements.memberStatementLine", rail: null, requestId: null },
  );

describe("member statement discovery before computation finishes", () => {
  afterEach(() => vi.useRealTimers());

  it("waits at most thirty seconds, then returns the original missing-line error", async () => {
    vi.useFakeTimers();
    const missing = failure(404);
    const read = vi.fn().mockRejectedValue(missing);
    const result = discoverMemberLine(read).catch((error) => error);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(read).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(missing);
    expect(read).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
    [404, "FORBIDDEN"],
    [410, "NOT_FOUND"],
  ] as const)("does not retry a %s refusal", async (status, code) => {
    vi.useFakeTimers();
    const refused = failure(status, code);
    const read = vi.fn().mockRejectedValue(refused);
    await expect(discoverMemberLine(read)).rejects.toBe(refused);
    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the pending delay when the member screen unmounts or the session changes", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const read = vi.fn().mockRejectedValue(failure(404));
    const result = discoverMemberLine(read, controller.signal).catch((error) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    expect(await result).toBeInstanceOf(Error);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("never reads for a session that was already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const read = vi.fn();
    await expect(discoverMemberLine(read, controller.signal)).rejects.toThrow("cancelled");
    expect(read).not.toHaveBeenCalled();
  });
});
