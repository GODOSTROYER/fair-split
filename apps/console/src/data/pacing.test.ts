import { ApiClientError } from "@fairsplit/api-client";
import { describe, expect, it, vi } from "vitest";
import { pacedCall } from "./pacing.js";

function queued() {
  return new ApiClientError(
    { code: "QUEUED", status: 429, message: "Queue", retryAfterMs: 25 },
    { command: "markPaid", rail: "simulated", requestId: null },
  );
}
describe("paced PayPal commands", () => {
  it("shows the server delay and re-presses exactly once", async () => {
    const call = vi.fn().mockRejectedValueOnce(queued()).mockResolvedValue("done");
    const notify = vi.fn();
    expect(await pacedCall(call, notify)).toBe("done");
    expect(call).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(25);
    expect(notify).toHaveBeenLastCalledWith(null);
  });
  it("does not loop when the retry is also queued", async () => {
    const call = vi.fn().mockRejectedValue(queued());
    await expect(pacedCall(call, () => undefined)).rejects.toMatchObject({ code: "QUEUED" });
    expect(call).toHaveBeenCalledTimes(2);
  });
});

it("Reset cancels the queued timer before a second request", async () => {
  const controller = new AbortController();
  const call = vi.fn().mockRejectedValue(queued());
  const pending = pacedCall(
    call,
    () => undefined,
    () => true,
    controller.signal,
  );
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(call).toHaveBeenCalledTimes(1);
});
