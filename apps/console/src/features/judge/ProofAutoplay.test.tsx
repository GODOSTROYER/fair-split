import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ProofAutoplay } from "./ProofAutoplay.js";
import { continueProof } from "./proof-autoplay.js";

afterEach(() => vi.useRealTimers());
it("verifies, opens the computed plate, and taps the member peso", async () => {
  vi.useFakeTimers();
  const verify = vi.fn();
  const peso = vi.fn();
  function Page() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" data-testid="W-PF-01.verify.face" onClick={verify}>
          Verify
        </button>
        <div data-testid="W-PF-01.verdict" data-state="sample" />
        <button type="button" data-testid="W-PF-01.plate.computed.toggle" onClick={() => setOpen(true)}>
          Computed
        </button>
        {open && (
          <button type="button" data-testid="W-PF-01.peso.M-014" onClick={peso}>
            Peso
          </button>
        )}
        <ProofAutoplay runSlug="2026A-r38" />
      </>
    );
  }
  continueProof("2026A-r38");
  render(<Page />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(verify).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(screen.queryByTestId("W-PF-01.peso.M-014")).not.toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(peso).toHaveBeenCalledTimes(1);
});
