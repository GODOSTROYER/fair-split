// The seal sheet (S2 §2.12, plan gate G1): 300 seeded batch digests drawn at 64, 200 and 320 px exactly as
// every surface draws them, and the 80 mm print as the 203 dpi head prints it, one bit per dot at 48 mm. The
// user flags any ugly draw before the seal freezes with IC-09; the seal's number is in the address.

import { SEAL_PRINT, seal, sealPrintSvg, sealStroke, sealSvg } from "@fairsplit/seal";
import { RESOLVED } from "@fairsplit/tokens";
import { Seal } from "@fairsplit/ui-web";
import { useNavigate } from "@tanstack/react-router";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "../controls.js";
import { BATCH_SHA256 } from "../fixture.js";
import { hashPrefix } from "../format.js";
import { sha256Hex } from "../hash.js";
import { PageTitle, Section, useProtoSearch } from "../Shell.js";
import { SHEET_COUNT, SHEET_SIZES, type SheetSize } from "../search.js";

/** Seal n of the sheet grows from sha256("fs-seal-sheet-n"): stable, so a flagged number stays the same seal. */
const DIGESTS: readonly string[] = Array.from({ length: SHEET_COUNT }, (_, i) =>
  sha256Hex(`fs-seal-sheet-${i + 1}`),
);

const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const label = (n: number) => String(n).padStart(3, "0");
const devicePixelRatio = () =>
  typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;

export function SealSheetPage() {
  const search = useProtoSearch();
  const navigate = useNavigate();
  const size: SheetSize = search.px ?? 200;
  const theme = search.theme ?? "tablea";
  const colours = RESOLVED[theme];
  const selected = search.seal;
  const set = (patch: { px?: SheetSize; seal?: number }) =>
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }),
      replace: true,
    });

  return (
    <div data-testid="W-DP-01.seal-sheet">
      <PageTitle
        title="Seal sheet"
        lede={
          <>
            Three hundred batch digests, grown the way the console, the phone, the push image and Proof grow
            them. Look for an ugly draw: a ring that clumps into grey, a band that reads empty, two seals that
            look alike. Pick one to see its rings; its number stays in the address, so a flag is a link.
          </>
        }
      />

      <div className="sheet-controls">
        <Segmented
          label="Drawn at"
          value={String(size)}
          options={SHEET_SIZES.map((s) => ({ value: String(s), label: `${s} px` }))}
          onChange={(v) => set({ px: Number(v) as SheetSize })}
          testId="W-DP-01.seal-sheet.size"
        />
        <p className="fs-t-caption proto-label">
          {size < 96
            ? "Below 96 px each seal draws one ring per key."
            : "Five rings: key 1 engraves the inner three, key 2 the outer two."}{" "}
          Both keys signed. Stroke {formatStroke(sealStroke(size, devicePixelRatio()))} px on this screen.
        </p>
      </div>

      {selected !== undefined && (
        <Inspector
          n={selected}
          digest={DIGESTS[selected - 1] ?? BATCH_SHA256}
          size={size}
          onClose={() => set({ seal: undefined })}
        />
      )}

      <ol
        className="sheet-grid"
        style={{ "--sheet-seal": `${size}px` } as CSSProperties}
        aria-label={`${SHEET_COUNT} seeded seals at ${size} px`}
      >
        {DIGESTS.map((digest, i) => (
          <li key={digest}>
            <SheetSeal
              n={i + 1}
              digest={digest}
              size={size}
              ink={colours.ink.hex}
              rule={colours.rule.hex}
              selected={selected === i + 1}
              onSelect={() => set({ seal: i + 1 })}
            />
          </li>
        ))}
      </ol>

      <Section
        title="The 80 mm print"
        brief={`The same seal on Merlyn’s cash statement: five rings at ${SEAL_PRINT.mm} mm with ${SEAL_PRINT.strokeMm} mm strokes, thresholded to one bit per dot as the ${SEAL_PRINT.dpi} dpi head prints it (${SEAL_PRINT.px} × ${SEAL_PRINT.px} dots).`}
        testId="W-DP-01.seal-sheet.print"
      >
        <PrintPreview
          digest={selected !== undefined ? (DIGESTS[selected - 1] ?? BATCH_SHA256) : BATCH_SHA256}
        />
      </Section>
    </div>
  );
}

function formatStroke(px: number): string {
  return String(Math.round(px * 100) / 100);
}

function SheetSeal({
  n,
  digest,
  size,
  ink,
  rule,
  selected,
  onSelect,
}: {
  readonly n: number;
  readonly digest: string;
  readonly size: SheetSize;
  readonly ink: string;
  readonly rule: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [near, setNear] = useState(false);
  // Grow a seal only when it nears the viewport: 300 seals at 320 px are 1,500 paths.
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const src = useMemo(
    () =>
      near
        ? svgUri(
            sealSvg(digest, size, { keys: 2, ink, rule, strokeWidth: sealStroke(size, devicePixelRatio()) }),
          )
        : undefined,
    [near, digest, size, ink, rule],
  );
  const hash = hashPrefix(digest, 2);
  return (
    <button
      ref={ref}
      type="button"
      className="sheet-cell"
      aria-pressed={selected}
      aria-label={`Seal ${n}, batch ${hash}. Inspect`}
      data-testid={`W-DP-01.seal-sheet.${n}`}
      onClick={onSelect}
    >
      <span className="sheet-cell__seal" style={{ width: size, height: size }}>
        {src && <img src={src} width={size} height={size} alt="" decoding="async" />}
      </span>
      <span className="sheet-cell__caption fs-t-caption">
        <span className="sheet-cell__n">{label(n)}</span> {hash}
      </span>
    </button>
  );
}

function Inspector({
  n,
  digest,
  size,
  onClose,
}: {
  readonly n: number;
  readonly digest: string;
  readonly size: SheetSize;
  readonly onClose: () => void;
}) {
  const geometry = useMemo(() => seal(digest, size), [digest, size]);
  return (
    <section className="sheet-inspect" aria-label={`Seal ${n}`} data-testid="W-DP-01.seal-sheet.inspect">
      <div className="sheet-inspect__seals">
        <figure className="sheet-inspect__seal">
          <Seal batchSha256={digest} size={size} keys={2} showHash />
          <figcaption className="fs-t-caption">{size} px, as on the sheet</figcaption>
        </figure>
        {size !== 320 && (
          <figure className="sheet-inspect__seal">
            <Seal batchSha256={digest} size={320} keys={2} />
            <figcaption className="fs-t-caption">320 px</figcaption>
          </figure>
        )}
      </div>
      <div className="sheet-inspect__data">
        <p className="fs-t-title-2">Seal {label(n)}</p>
        <p className="fs-t-caption proto-label">
          sha256(“fs-seal-sheet-{n}”) at {size} px, {geometry.variant === "two" ? "two rings" : "five rings"}
        </p>
        <table className="proto-table">
          <thead>
            <tr>
              <th scope="col">Ring</th>
              <th scope="col">Key</th>
              <th scope="col">Lobes N</th>
              <th scope="col">Turns M</th>
              <th scope="col">Pen p</th>
              <th scope="col">Turned</th>
              <th scope="col">Points</th>
            </tr>
          </thead>
          <tbody>
            {geometry.rings.map((r) => (
              <tr key={r.index}>
                <td className="fs-t-figure">{r.index}</td>
                <td className="fs-t-figure">{r.owner}</td>
                <td className="fs-t-figure">{r.lobes}</td>
                <td className="fs-t-figure">{r.turns}</td>
                <td className="fs-t-figure">{r.pen.toFixed(2)}</td>
                <td className="fs-t-figure">{((r.rotation * 180) / Math.PI).toFixed(1)}°</td>
                <td className="fs-t-figure">{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="fs-flat" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  );
}

/** Draws the print SVG onto a canvas and thresholds it to one bit per dot, as the thermal head will. */
function PrintPreview({ digest }: { readonly digest: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [dots, setDots] = useState(false);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let live = true;
    const image = new Image();
    image.onload = () => {
      if (!live) return;
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, SEAL_PRINT.px, SEAL_PRINT.px);
      ctx.drawImage(image, 0, 0, SEAL_PRINT.px, SEAL_PRINT.px);
      const pixels = ctx.getImageData(0, 0, SEAL_PRINT.px, SEAL_PRINT.px);
      const d = pixels.data;
      for (let i = 0; i < d.length; i += 4) {
        const luminance = 0.2126 * (d[i] ?? 255) + 0.7152 * (d[i + 1] ?? 255) + 0.0722 * (d[i + 2] ?? 255);
        const v = luminance < 128 ? 0 : 255;
        d[i] = v;
        d[i + 1] = v;
        d[i + 2] = v;
        d[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
    };
    image.src = svgUri(sealPrintSvg(digest));
    return () => {
      live = false;
    };
  }, [digest]);
  const width = dots ? `${SEAL_PRINT.px * 2}px` : `${SEAL_PRINT.mm}mm`;
  return (
    <div className="sheet-print">
      <div className="sheet-print__paper">
        <canvas
          ref={canvas}
          width={SEAL_PRINT.px}
          height={SEAL_PRINT.px}
          style={{ width, height: width }}
          className="sheet-print__canvas"
          role="img"
          aria-label={`Print seal for batch ${hashPrefix(digest, 2)}, one bit per dot`}
          data-testid="W-DP-01.seal-sheet.print.canvas"
        />
      </div>
      <Segmented
        label="Scale"
        value={dots ? "dots" : "paper"}
        options={[
          { value: "paper", label: `${SEAL_PRINT.mm} mm` },
          { value: "dots", label: "Two pixels a dot" },
        ]}
        onChange={(v) => setDots(v === "dots")}
        testId="W-DP-01.seal-sheet.print.scale"
      />
    </div>
  );
}
