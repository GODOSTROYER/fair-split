// One weigh slip, drawn from the seed: the printed A6 form in press grey with its serial, and Jessie's ballpoint
// capitals in each box (./hand.ts). The pink duplicate is the office's carbon: softer and fainter. Slip 0462 carries one water stain across the second digit of gross and net; slip 0449 carries the
// margin note the reading quarantines. Evidence only: the drawing is aria-hidden and its <Paper> or photo
// says what it shows, with "Synthetic sample" in the alt text. IC-11's photographs replace it when they land.

import type { SlipFieldName, SnapshotSlip } from "@fairsplit/contracts";
import { memo, useId } from "react";
import { handRun } from "./hand.js";
import {
  boxText,
  copyKind,
  HAND_INSET,
  HAND_SIZE,
  SLIP_BOXES,
  SLIP_H,
  SLIP_W,
  type SlipBox,
  stainedIndex,
} from "./slip.js";

export interface SlipPaperProps {
  readonly slip: SnapshotSlip;
  /** "thumb" drops the printed labels (illegible at contact-sheet size) and keeps the writing. */
  readonly detail?: "full" | "thumb";
  /** The box outlined in pencil (MM-2's reduced form: "a 2 px pencil outline on the crop"). */
  readonly outline?: SlipFieldName | null;
  /** Draw only this part of the slip (a crop, in the slip's own units), filling the element. */
  readonly crop?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
  readonly className?: string;
}

/** A soft, irregular water mark: a closed Catmull-Rom curve through seeded radii, with a tide line. */
function stainPath(cx: number, cy: number, rx: number, ry: number, seed: number): string {
  const n = 14;
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = 0.8 + rand() * 0.34;
    return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k] as const;
  });
  const at = (i: number) => pts[(i + n) % n] as readonly [number, number];
  let d = `M${at(0)[0].toFixed(2)} ${at(0)[1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0]?.toFixed(2)} ${c1[1]?.toFixed(2)} ${c2[0]?.toFixed(2)} ${c2[1]?.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return `${d}Z`;
}

/** Moves every point of a run's path (only M and L commands) by (dx, dy). */
function offsetPath(d: string, dx: number, dy: number): string {
  return d.replace(/([ML])(-?[\d.]+) (-?[\d.]+)/g, (_m, cmd: string, x: string, y: string) => {
    const nx = Math.round((Number(x) + dx) * 100) / 100;
    const ny = Math.round((Number(y) + dy) * 100) / 100;
    return `${cmd}${nx} ${ny}`;
  });
}

interface ThumbPaths {
  readonly bars: string;
  readonly boxes: string;
  readonly hand: string;
}

const THUMBS = new Map<string, ThumbPaths>();

/**
 * A contact-sheet slip in three paths (the press, the boxes, the hand), computed once per slip: a sheet of
 * twelve photos stays a few hundred nodes, not thousands.
 */
function thumbPaths(slip: SnapshotSlip): ThumbPaths {
  const key = `${slip.serial}:${slip.copy}`;
  const cached = THUMBS.get(key);
  if (cached) return cached;
  const bars = ["M10 10h84v6h-84z", "M10 22h52v8h-52z"];
  const boxes = ["M10 38H200", "M10 280H118", "M146 280H200"];
  const hand: string[] = [];
  for (const box of SLIP_BOXES) {
    boxes.push(`M${box.x} ${box.y}h${box.w}v${box.h}h${-box.w}z`);
    bars.push(`M${box.x + 3} ${box.y + 3}h${Math.min(28, box.w - 6)}v3h${-Math.min(28, box.w - 6)}z`);
    const hidden = stainedIndex(slip, box.field);
    const size = box.id === "13" ? 9 : HAND_SIZE;
    boxText(slip, box.id)
      .filter((l) => l.length > 0)
      .forEach((line, i) => {
        const run = handRun(line, { size, seed: `${slip.serial}:${box.id}:${i}` });
        const x = box.x + HAND_INSET.x;
        const y = box.y + HAND_INSET.y + i * (size + 7);
        const d =
          hidden === null
            ? run.d
            : run.glyphs
                .filter((_g, gi) => gi !== hidden)
                .map((g) => g.d)
                .join("");
        hand.push(offsetPath(d, x, y));
      });
  }
  hand.push(offsetPath(handRun(slip.clerkInitials, { size: 10, seed: `${slip.serial}:clerk` }).d, 156, 266));
  if (slip.signature === "SIGNED") hand.push("M18 276c8-10 14 4 22-3s10-8 16 0 12-6 19-1 9 5 16-2");
  const out = { bars: bars.join(""), boxes: boxes.join(""), hand: hand.join("") };
  THUMBS.set(key, out);
  return out;
}

function ThumbSlip({ slip, className }: { readonly slip: SnapshotSlip; readonly className?: string }) {
  const paths = thumbPaths(slip);
  const stained = slip.artifacts.includes("WATER_STAIN");
  const gross = SLIP_BOXES.find((b) => b.field === "gross_kg");
  const stainX = gross ? gross.x + HAND_INSET.x + 14 : 100;
  const stainSeed = Number.parseInt(slip.serial, 10) * 7919;
  return (
    <svg
      className={["fsc-slip", className].filter(Boolean).join(" ")}
      viewBox={`0 0 ${SLIP_W} ${SLIP_H}`}
      preserveAspectRatio="xMidYMid meet"
      data-serial={slip.serial}
      data-copy={copyKind(slip.copy)}
      data-detail="thumb"
      aria-hidden
      focusable="false"
    >
      <rect className="fsc-slip__sheet" width={SLIP_W} height={SLIP_H} />
      <path className="fsc-slip__bar" d={paths.bars} />
      <path className="fsc-slip__box" d={paths.boxes} />
      <path className="fsc-slip__hand" d={paths.hand} />
      {stained && <path d={stainPath(stainX, 145, 18, 30, stainSeed)} className="fsc-slip__stain-body" />}
    </svg>
  );
}

function BoxWriting({
  slip,
  box,
  hiddenIndex,
  blurId,
}: {
  readonly slip: SnapshotSlip;
  readonly box: SlipBox;
  readonly hiddenIndex: number | null;
  readonly blurId: string;
}) {
  const lines = boxText(slip, box.id).filter((l) => l.length > 0);
  const size = box.id === "13" ? 9 : HAND_SIZE;
  return (
    <>
      {lines.map((line, i) => {
        const run = handRun(line, { size, seed: `${slip.serial}:${box.id}:${i}` });
        const x = box.x + HAND_INSET.x;
        const y = box.y + HAND_INSET.y + i * (size + 7);
        if (hiddenIndex === null) {
          return <path key={line} className="fsc-slip__hand" d={run.d} transform={`translate(${x} ${y})`} />;
        }
        return (
          <g key={line} transform={`translate(${x} ${y})`}>
            {run.glyphs.map((g, gi) => (
              <path
                key={`${g.char}${g.x}`}
                className={gi === hiddenIndex ? "fsc-slip__hand fsc-slip__hand--stained" : "fsc-slip__hand"}
                d={g.d}
                filter={gi === hiddenIndex ? `url(#${blurId})` : undefined}
              />
            ))}
          </g>
        );
      })}
    </>
  );
}

export const SlipPaper = memo(function SlipPaper({
  slip,
  detail = "full",
  outline = null,
  crop = null,
  className,
}: SlipPaperProps) {
  if (detail === "thumb" && !outline && !crop) return <ThumbSlip slip={slip} className={className} />;
  return <FullSlip slip={slip} detail={detail} outline={outline} crop={crop} className={className} />;
});

function FullSlip({ slip, detail = "full", outline = null, crop = null, className }: SlipPaperProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const blurId = `fsc-stain-blur-${uid}`;
  const kind = copyKind(slip.copy);
  const stained = slip.artifacts.includes("WATER_STAIN");
  const full = detail === "full";
  const gross = SLIP_BOXES.find((b) => b.field === "gross_kg");
  const stainX = gross ? gross.x + HAND_INSET.x + 14 : 100;
  const stainSeed = Number.parseInt(slip.serial, 10) * 7919;
  return (
    <svg
      className={["fsc-slip", className].filter(Boolean).join(" ")}
      viewBox={crop ? `${crop.x} ${crop.y} ${crop.w} ${crop.h}` : `0 0 ${SLIP_W} ${SLIP_H}`}
      preserveAspectRatio={crop ? "xMidYMid slice" : "xMidYMid meet"}
      data-serial={slip.serial}
      data-copy={kind}
      data-detail={detail}
      aria-hidden
      focusable="false"
    >
      {stained && (
        <defs>
          <filter id={blurId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>
      )}
      <rect className="fsc-slip__sheet" width={SLIP_W} height={SLIP_H} />
      {/* The press: header, serial, boxes and their labels. */}
      {full ? (
        <>
          <text className="fsc-slip__print fsc-slip__print--coop" x={10} y={16}>
            Bulawanon Kakaw Growers MPC
          </text>
          <text className="fsc-slip__print fsc-slip__print--title" x={10} y={31}>
            Weigh slip
          </text>
          <text className="fsc-slip__print" x={150} y={30} textAnchor="end">
            No.
          </text>
        </>
      ) : (
        <>
          <rect className="fsc-slip__bar" x={10} y={10} width={84} height={6} />
          <rect className="fsc-slip__bar" x={10} y={22} width={52} height={8} />
        </>
      )}
      <text className="fsc-slip__serial" x={200} y={31} textAnchor="end">
        {slip.serial}
      </text>
      <line className="fsc-slip__rule" x1={10} x2={200} y1={38} y2={38} />
      {SLIP_BOXES.map((box) => (
        <g key={box.id}>
          <rect
            className="fsc-slip__box"
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            data-field={box.field}
          />
          {full ? (
            <text className="fsc-slip__print fsc-slip__print--label" x={box.x + 3} y={box.y + 7}>
              {box.label}
            </text>
          ) : (
            <rect
              className="fsc-slip__bar"
              x={box.x + 3}
              y={box.y + 3}
              width={Math.min(28, box.w - 6)}
              height={3}
            />
          )}
          <BoxWriting slip={slip} box={box} hiddenIndex={stainedIndex(slip, box.field)} blurId={blurId} />
        </g>
      ))}
      {/* Signatures: the member's mark and the clerk's initials. */}
      <line className="fsc-slip__rule" x1={10} x2={118} y1={280} y2={280} />
      <line className="fsc-slip__rule" x1={146} x2={200} y1={280} y2={280} />
      {full && (
        <>
          <text className="fsc-slip__print fsc-slip__print--label" x={10} y={289}>
            Received by member
          </text>
          <text className="fsc-slip__print fsc-slip__print--label" x={146} y={289}>
            Clerk
          </text>
        </>
      )}
      <path
        className="fsc-slip__hand"
        d={handRun(slip.clerkInitials, { size: 10, seed: `${slip.serial}:clerk` }).d}
        transform="translate(156 266)"
      />
      {slip.signature === "THUMBMARK" ? (
        <g className="fsc-slip__thumb" transform="translate(40 268)">
          {[9, 7, 5, 3].map((r) => (
            <ellipse key={r} cx={0} cy={0} rx={r * 0.8} ry={r} />
          ))}
        </g>
      ) : slip.signature === "SIGNED" ? (
        <path
          className="fsc-slip__hand fsc-slip__hand--signature"
          d="M18 276c8-10 14 4 22-3s10-8 16 0 12-6 19-1 9 5 16-2"
        />
      ) : null}
      {slip.marginNote && (
        <g className="fsc-slip__margin" transform="translate(12 246) rotate(-4)">
          {wrap(slip.marginNote, 34).map((line, i) => (
            <path
              key={line}
              className="fsc-slip__hand"
              d={handRun(line, { size: 6.4, seed: `${slip.serial}:margin:${i}`, wobble: 1.3 }).d}
              transform={`translate(0 ${i * 11})`}
            />
          ))}
        </g>
      )}
      {stained && (
        <g className="fsc-slip__stain" aria-hidden>
          <path d={stainPath(stainX, 145, 18, 30, stainSeed)} className="fsc-slip__stain-body" />
          <path d={stainPath(stainX + 2, 147, 11, 19, stainSeed + 31)} className="fsc-slip__stain-bloom" />
        </g>
      )}
      {outline && <SlipOutline field={outline} />}
    </svg>
  );
}

function SlipOutline({ field }: { readonly field: SlipFieldName }) {
  const box = SLIP_BOXES.find((b) => b.field === field);
  if (!box) return null;
  return (
    <rect
      className="fsc-slip__outline"
      x={box.x - 2}
      y={box.y - 2}
      width={box.w + 4}
      height={box.h + 4}
      data-outline={field}
    />
  );
}

/** Splits a margin note into lines of at most `max` characters, on spaces. */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && `${line} ${word}`.length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}
