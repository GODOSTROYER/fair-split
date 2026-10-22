import { createHash } from "node:crypto";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  AmountDisplay,
  feedback,
  HOLD_CARD_STATES,
  HoldCard,
  type HoldView,
  isFinalHoldState,
  MassBalanceDial,
  MomentRoot,
  Print,
  ReceiptBar,
  Seal,
  type StatementLineView,
  StatusCapsule,
  StatusChip,
  UiProvider,
} from "../src/index.js";

const wrap = (node: ReactNode, lang: "en" | "ceb" | "fil" = "en") => (
  <UiProvider lang={lang} motion="full">
    {node}
  </UiProvider>
);

const digest = createHash("sha256").update("fs:2026A:r37:batch").digest("hex");

describe("Print", () => {
  it("prints machine output flat in pencil, with its provenance footer", () => {
    render(
      wrap(
        <Print
          value="38.45"
          provenance="claude"
          state="pencil"
          footer="Read by Claude (claude-opus-5-5)"
          testId="p"
        />,
      ),
    );
    const el = screen.getByTestId("p");
    expect(el.dataset).toMatchObject({ state: "pencil", provenance: "claude" });
    expect(el.textContent).toContain("Read by Claude (claude-opus-5-5)");
    expect(el.querySelector("button")).toBeNull();
  });

  it("puts a value read below 0.85 into a You cell for a person", () => {
    render(wrap(<Print value="6?.80" provenance="claude" state="pencil" confidence={0.4} testId="p" />));
    expect(screen.getByTestId("p").dataset.confidence).toBe("low");
    expect(screen.getByTestId("p.you").textContent).toContain("You");
  });

  it("accepts a confident read without the You cell", () => {
    render(wrap(<Print value="38.45" provenance="claude" state="pencil" confidence={0.97} testId="p" />));
    expect(screen.queryByTestId("p.you")).toBeNull();
  });

  it("wipes in on reveal, or fades under reduced motion", () => {
    const { rerender } = render(
      wrap(<Print value="64.45" provenance="engine" state="ink" reveal testId="p" />),
    );
    expect(screen.getByTestId("p").dataset.reveal).toBe("wipe");
    rerender(
      <UiProvider lang="en" motion="reduced">
        <Print value="64.45" provenance="engine" state="ink" reveal testId="p" />
      </UiProvider>,
    );
    expect(screen.getByTestId("p").dataset.reveal).toBe("fade");
  });

  it("draws hollow amounts", () => {
    render(
      wrap(<Print value="US$64.45" provenance="engine" state="hollow" typeRole="amount-l" testId="p" />),
    );
    expect(screen.getByTestId("p").dataset.state).toBe("hollow");
  });
});

describe("Seal", () => {
  it("is an image labelled with the hash in groups of four and the keys signed", () => {
    render(wrap(<Seal batchSha256={digest} size={200} keys={1} testId="seal" />));
    const svg = screen.getByRole("img", { name: /Batch seal [0-9a-f]{4} [0-9a-f]{4}\. 1 of 2/ });
    expect(svg.getAttribute("data-state")).toBe("keys-1");
  });

  it("draws unsigned bands as rule circles and engraves rings per key", () => {
    const { container, rerender } = render(wrap(<Seal batchSha256={digest} size={200} keys={0} />));
    expect(container.querySelectorAll("path.fs-seal__ring")).toHaveLength(0);
    expect(container.querySelectorAll("circle.fs-seal__band")).toHaveLength(5);
    rerender(wrap(<Seal batchSha256={digest} size={200} keys={1} />));
    expect(container.querySelectorAll("path.fs-seal__ring")).toHaveLength(3);
    rerender(wrap(<Seal batchSha256={digest} size={200} keys={2} />));
    expect(container.querySelectorAll("path.fs-seal__ring")).toHaveLength(5);
  });

  it("draws the same seal for the same digest on every render", () => {
    const a = render(wrap(<Seal batchSha256={digest} size={200} keys={2} />));
    const first = [...a.container.querySelectorAll("path")].map((p) => p.getAttribute("d"));
    a.unmount();
    const b = render(wrap(<Seal batchSha256={digest} size={200} keys={2} />));
    expect([...b.container.querySelectorAll("path")].map((p) => p.getAttribute("d"))).toEqual(first);
  });

  it("renders a motion-study frame with partial rings", () => {
    const { container } = render(
      wrap(
        <Seal
          batchSha256={digest}
          size={200}
          keys={1}
          frame={{ rings: [1, 0.5, 0, 0, 0], opacity: [1, 1, 0, 0, 0] }}
        />,
      ),
    );
    expect(container.querySelectorAll("path.fs-seal__ring")).toHaveLength(2);
    expect(container.querySelectorAll("path.fs-seal__ring")[1]?.getAttribute("stroke-dashoffset")).toBe(
      "0.5",
    );
  });
});

const line: StatementLineView = {
  memberNo: "M-014",
  kg: "148.0 kg",
  rate: "US$0.2952",
  premiumRule: "R0",
  premium: { display: "US$43.69", spoken: "forty-three dollars and sixty-nine cents" },
  bonus: { display: "US$21.85", spoken: "twenty-one dollars and eighty-five cents" },
  deductions: [
    {
      id: "cbu",
      name: "CBU",
      rule: "R1",
      card: "BR 2026-04",
      amount: { display: "−US$1.09", spoken: "minus one dollar and nine cents" },
    },
  ],
  credits: [],
  net: { display: "US$64.45", spoken: "sixty-four dollars and forty-five cents" },
  netPhp: "₱4,028",
};

describe("ReceiptBar", () => {
  it("reads kilos × rate, premium, bonus, rule chips, credits, net, in that order", () => {
    render(wrap(<ReceiptBar line={line} onSegment={() => undefined} testId="rb" />));
    const order = [...screen.getByTestId("rb").querySelectorAll("[data-segment]")].map((el) =>
      el.getAttribute("data-segment"),
    );
    expect(order).toEqual(["kg-rate", "premium", "bonus", "rule:cbu", "net"]);
  });

  it("reports the tapped segment and its rect (MM-7 starts here)", () => {
    const onSegment = vi.fn();
    render(wrap(<ReceiptBar line={line} onSegment={onSegment} testId="rb" />));
    fireEvent.click(screen.getByTestId("rb.premium"));
    expect(onSegment).toHaveBeenCalledWith("premium", expect.objectContaining({ width: expect.any(Number) }));
  });

  it("speaks each segment in full, and says the premium has no deductions in the member's language", () => {
    render(wrap(<ReceiptBar line={line} onSegment={() => undefined} testId="rb" />, "ceb"));
    expect(screen.getByTestId("rb.premium").getAttribute("aria-label")).toBe(
      "Premium, forty-three dollars and sixty-nine cents, walay kaltas",
    );
    expect(screen.getByTestId("rb.rule:cbu").textContent).toContain("R1, BR 2026-04");
  });
});

const hold: HoldView = {
  id: "H1",
  kind: "DUPLICATE_SLIP",
  title: "Slip 0457 counted twice",
  engineLine: "Slip 0457 is in two photos: the white original (B) and the pink duplicate (D).",
  claudeLine: "The second image is the office’s pink copy of the same receipt.",
  effect: "Counting it once returns US$17.94 to 63 members and brings shrink to 1.62%.",
  state: "open",
};

describe("HoldCard", () => {
  const actions = (onCommit = vi.fn(), onSelect = vi.fn()) =>
    [
      {
        kind: "slab",
        label: "Count it once",
        srLabel: "Count it once, changes a line",
        onCommit,
        testId: "h1.once",
      },
      {
        kind: "flat",
        label: "These are two deliveries",
        note: "Needs a reason, then the Chair",
        onSelect,
        testId: "h1.two",
      },
    ] as const;

  it("shows two voices, the gate and at most one slab and one flat action", () => {
    render(wrap(<HoldCard hold={hold} gate="BLOCKS_APPROVAL" actions={actions()} testId="h1" />));
    const card = screen.getByTestId("h1");
    expect(card.dataset).toMatchObject({ state: "open", gate: "BLOCKS_APPROVAL" });
    expect(screen.getByTestId("h1.gate").textContent).toBe("Blocks approval. Changes kilos.");
    expect(card.querySelector('[data-voice="claude"] [data-state="pencil"]')?.textContent).toContain(
      "pink copy",
    );
    expect(card.querySelectorAll(".fs-slab")).toHaveLength(1);
    expect(screen.getByTestId("h1.two").textContent).toBe("These are two deliveries");
  });

  it("Claude's line carries no digits", () => {
    expect(hold.claudeLine).not.toMatch(/\d/);
  });

  it("resolves flush in ink with the resolver's stamp and time", () => {
    render(
      wrap(
        <HoldCard
          hold={{ ...hold, state: "resolved" }}
          gate="BLOCKS_APPROVAL"
          actions={actions()}
          resolution={{ initials: "AS", name: "Analyn R. Sumalinog", at: "10:24" }}
          testId="h1"
        />,
      ),
    );
    expect(screen.getByTestId("h1").dataset.state).toBe("resolved");
    expect(screen.getByTestId("h1.resolution").textContent).toContain("Resolved by AS at 10:24");
    expect(screen.queryByTestId("h1.once")).toBeNull();
  });

  it("an excluded hold is decided too: flush, stamped, carried over, with no actions", () => {
    const onCommit = vi.fn();
    render(
      wrap(
        <HoldCard
          hold={{ ...hold, state: "excluded" }}
          gate="RESERVES_LINE"
          actions={actions(onCommit)}
          resolution={{ initials: "AS", name: "Analyn R. Sumalinog", at: "10:31" }}
          testId="h1"
        />,
      ),
    );
    expect(screen.getByTestId("h1").dataset.state).toBe("excluded");
    const resolution = screen.getByTestId("h1.resolution");
    expect(resolution.textContent).toContain("Excluded, carried over");
    expect(resolution.querySelector(".fs-stamp")?.getAttribute("aria-label")).toBe(
      "Analyn R. Sumalinog, 10:31",
    );
    expect(screen.queryByTestId("h1.once")).toBeNull();
    expect(screen.queryByTestId("h1.two")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("a resolved hold without a stamp still reads as resolved and offers no actions", () => {
    render(
      wrap(
        <HoldCard
          hold={{ ...hold, state: "resolved" }}
          gate="BLOCKS_APPROVAL"
          actions={actions()}
          testId="h1"
        />,
      ),
    );
    expect(screen.getByTestId("h1.resolution").textContent).toBe("Resolved");
    expect(screen.queryByTestId("h1.once")).toBeNull();
  });

  it("every state the card can show is in the contract, and only resolved and excluded are final", () => {
    expect(HOLD_CARD_STATES.filter(isFinalHoldState)).toEqual(["resolved", "excluded"]);
  });

  it("names the Chair when he is involved", () => {
    render(
      wrap(
        <HoldCard
          hold={{ ...hold, state: "asked-chair" }}
          gate="RESERVES_LINE"
          actions={actions()}
          testId="h1"
        />,
      ),
    );
    expect(screen.getByTestId("h1").textContent).toContain("Asked Ernesto");
    expect(screen.getByTestId("h1.gate").textContent).toBe("Reserves this line only. Never redistributed.");
  });
});

describe("status words and money", () => {
  it("never shows a raw state: members read their language, the console its own words", () => {
    render(
      wrap(
        <>
          <StatusChip state="HELD" testId="a" />
          <StatusChip state="UNCLAIMED" surface="console" testId="b" />
        </>,
        "ceb",
      ),
    );
    expect(screen.getByTestId("a").textContent).toBe("Gisusi pa");
    expect(screen.getByTestId("a").getAttribute("lang")).toBe("ceb");
    expect(screen.getByTestId("b").textContent).toBe("Parked");
  });

  it("speaks amounts in full with the peso estimate, and draws them hollow until paid", () => {
    render(
      wrap(
        <AmountDisplay
          amount={{ display: "US$64.45", spoken: "sixty-four dollars and forty-five cents" }}
          estimate="mga ₱4,028 (gibanabana)"
          hollow
          testId="amt"
        />,
      ),
    );
    const amount = screen.getByTestId("amt");
    expect(amount.dataset.state).toBe("hollow");
    expect(amount.querySelector(".fs-sr")?.textContent).toBe(
      "sixty-four dollars and forty-five cents, mga ₱4,028 (gibanabana)",
    );
    expect(amount.querySelector(".fs-amount__figure")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("the paid capsule is flush jade; the sent capsule keeps its 5 px inset", () => {
    const { rerender } = render(
      wrap(<StatusCapsule state="sent" text="Gipadala na, naghulat sa PayPal 0:14" testId="cap" />),
    );
    expect(screen.getByTestId("cap").dataset.raised).toBe("");
    rerender(wrap(<StatusCapsule state="paid" text="Bayad na, 30 Okt" testId="cap" />));
    expect(screen.getByTestId("cap").dataset.raised).toBeUndefined();
    expect(screen.getByTestId("cap").dataset.state).toBe("paid");
  });

  it("the mass-balance dial marks a value over the limit", () => {
    render(
      wrap(
        <MassBalanceDial
          value={2.05}
          display="2.05%"
          limitDisplay="Limit ±2.0%"
          label="Mass balance"
          testId="dial"
        />,
      ),
    );
    expect(screen.getByTestId("dial").dataset.over).toBe("");
    expect(screen.getByTestId("dial").textContent).toContain("2.05%");
  });

  it("moment roots expose data-moment and data-moment-phase", () => {
    render(
      <MomentRoot id="MM-5" phase="hold-1" testId="m">
        x
      </MomentRoot>,
    );
    expect(screen.getByTestId("m").dataset).toMatchObject({ moment: "MM-5", momentPhase: "hold-1" });
  });
});

describe("feedback", () => {
  it("is silent until the viewer turns sound on, but still records events", () => {
    expect(feedback.isSoundOn()).toBe(false);
    feedback.play("hold.quarter");
    expect(feedback.log.at(-1)).toMatchObject({ event: "hold.quarter", sound: "tick" });
  });

  it("throttles printed-row ticks and plays the next scale note per payout", () => {
    const before = feedback.log.length;
    feedback.play("row.printed");
    feedback.play("row.printed");
    expect(feedback.log.length - before).toBe(1);
    feedback.play("item.paid.console", { index: 3 });
    expect(feedback.log.at(-1)?.sound).toBe("scale-3");
  });

  it("a duplicate webhook delivery is silent", () => {
    feedback.play("webhook.duplicate");
    expect(feedback.log.at(-1)).toMatchObject({ event: "webhook.duplicate", sound: null });
  });
});
