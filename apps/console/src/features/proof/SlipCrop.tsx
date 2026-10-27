// The slip a peso traces to (MM-7 on Proof): the printed weigh-slip form with Jessie's ballpoint entries, drawn
// from the slip's recorded boxes until WS-MEDIA's synthetic photo tiles land (IC-11). It is evidence, so it is
// paper (the only thing with a shadow) and says "Synthetic sample". The name box is withheld on Proof (C-23,
// RA 10173): Proof shows member IDs, never names.

import type { SnapshotSlip } from "@fairsplit/contracts";
import { type MotionValue, motion } from "motion/react";

export interface SlipCropProps {
  readonly slip: SnapshotSlip;
  /** Crop scale from MM-7's timeline (1 → 2.4), about the payable-kilos box. */
  readonly zoom: MotionValue<number>;
  /** The ballpoint layer (MM-7 "tiled"): 0 → 1. */
  readonly tiles: MotionValue<number>;
  readonly panX: MotionValue<number>;
  readonly panY: MotionValue<number>;
  readonly testId: string;
}

const W = 360;
const H = 232;
/** The payable-kilos box: where the money comes from, and where the zoom centres. */
export const PAYABLE_BOX = { x: 246, y: 150, w: 100, h: 34 } as const;

interface Box {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
}

function boxesOf(slip: SnapshotSlip): Box[] {
  const b = slip.boxes;
  return [
    { key: "date", label: "Date", value: b["1"], x: 14, y: 56, w: 104 },
    { key: "member", label: "Member no.", value: b["2"], x: 128, y: 56, w: 104 },
    { key: "plot", label: "Plot", value: b["4"], x: 242, y: 56, w: 104 },
    { key: "gross", label: "Gross kg", value: b["6"], x: 14, y: 104, w: 104 },
    { key: "tare", label: "Tare kg", value: b["7"], x: 128, y: 104, w: 104 },
    { key: "net", label: "Net kg", value: b["8"], x: 242, y: 104, w: 104 },
    { key: "mc", label: "MC %", value: b["9"], x: 14, y: 150, w: 104 },
    { key: "grade", label: "Grade", value: b["12"], x: 128, y: 150, w: 104 },
  ];
}

const COPY_FILL: Readonly<Record<SnapshotSlip["copy"], string>> = {
  WHITE_ORIGINAL: "var(--fs-copy-white)",
  PINK_DUPLICATE: "var(--fs-copy-pink)",
  YELLOW_TRIPLICATE: "var(--fs-copy-yellow)",
  LOGBOOK_LINE: "var(--fs-copy-white)",
  UNKNOWN: "var(--fs-copy-white)",
};

/** Alt text: what the slip says, in words, with the synthetic label (design §2.6). */
export function slipAlt(slip: SnapshotSlip): string {
  const b = slip.boxes;
  return `Slip ${slip.serial} for ${b["2"]}, ${b["1"]}: gross ${b["6"]} kg, tare ${b["7"]} kg, net ${b["8"]} kg, payable ${b["11"]} kg, grade ${b["12"]}. Name withheld on Proof`;
}

export function SlipCrop({ slip, zoom, tiles, panX, panY, testId }: SlipCropProps) {
  const boxes = boxesOf(slip);
  const faint = slip.copy === "PINK_DUPLICATE";
  const originX = PAYABLE_BOX.x + PAYABLE_BOX.w / 2;
  const originY = PAYABLE_BOX.y + PAYABLE_BOX.h / 2;
  return (
    <div className="pf-crop__viewport" data-testid={testId}>
      <motion.svg
        className="pf-crop__slip"
        viewBox={`0 0 ${W} ${H}`}
        aria-hidden
        style={{
          scale: zoom,
          x: panX,
          y: panY,
          transformOrigin: `${(originX / W) * 100}% ${(originY / H) * 100}%`,
        }}
      >
        <rect width={W} height={H} fill={COPY_FILL[slip.copy]} />
        <text x={14} y={24} className="pf-crop__print pf-crop__print--head">
          Bulawanon Kakaw Growers MPC, weigh slip
        </text>
        <text x={346} y={26} textAnchor="end" className="pf-crop__serial" opacity={faint ? 0.6 : 1}>
          {slip.serial}
        </text>
        <line x1={14} x2={346} y1={34} y2={34} className="pf-crop__rule" />
        <g>
          <text x={14} y={46} className="pf-crop__print">
            Name
          </text>
          <rect x={46} y={39} width={186} height={10} className="pf-crop__withheld" />
          <text x={240} y={46} className="pf-crop__print pf-crop__print--note">
            Withheld on Proof
          </text>
        </g>
        {boxes.map((box) => (
          <g key={box.key}>
            <text x={box.x} y={box.y} className="pf-crop__print">
              {box.label}
            </text>
            <rect x={box.x} y={box.y + 4} width={box.w} height={28} className="pf-crop__box" />
          </g>
        ))}
        <text x={PAYABLE_BOX.x} y={PAYABLE_BOX.y} className="pf-crop__print">
          Payable kg
        </text>
        <rect
          x={PAYABLE_BOX.x}
          y={PAYABLE_BOX.y + 4}
          width={PAYABLE_BOX.w}
          height={PAYABLE_BOX.h - 6}
          className="pf-crop__box pf-crop__box--payable"
        />
        <text x={14} y={212} className="pf-crop__print">
          Clerk
        </text>
        <motion.g
          style={{ opacity: tiles }}
          className={faint ? "pf-crop__pen pf-crop__pen--faint" : "pf-crop__pen"}
        >
          {boxes.map((box, i) => (
            <text
              key={box.key}
              x={box.x + 8}
              y={box.y + 25}
              transform={`rotate(${i % 2 === 0 ? -1.2 : 0.8} ${box.x + 8} ${box.y + 25})`}
            >
              {box.value}
            </text>
          ))}
          <text
            x={PAYABLE_BOX.x + 8}
            y={PAYABLE_BOX.y + 25}
            transform={`rotate(-1 ${PAYABLE_BOX.x + 8} ${PAYABLE_BOX.y + 25})`}
          >
            {slip.boxes["11"]}
          </text>
          <text x={52} y={212}>
            {slip.clerkInitials}
          </text>
        </motion.g>
      </motion.svg>
    </div>
  );
}
