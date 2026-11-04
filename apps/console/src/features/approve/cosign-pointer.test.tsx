import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CosignCard } from "./parts.js";

it("raises the Chair frame without first lowering it through the console pointer handler", () => {
  const lowerPhone = vi.fn();
  const raiseChair = vi.fn();
  render(
    <div role="presentation" onPointerDown={lowerPhone}>
      <CosignCard code={null} busy={false} onMake={vi.fn()} onChairFrame={raiseChair} />
    </div>,
  );
  const chair = screen.getByTestId("W-TR-07.cosign.frame");
  fireEvent.pointerDown(chair);
  fireEvent.click(chair);
  expect(lowerPhone).not.toHaveBeenCalled();
  expect(raiseChair).toHaveBeenCalledTimes(1);

  fireEvent.pointerDown(screen.getByTestId("W-TR-07.cosign.make"));
  expect(lowerPhone).toHaveBeenCalledTimes(1);
});
