import { Allow, parse } from "partial-json";
import { coerceEnumCase, jsonSchemaOf } from "../gateway/index.js";
import { type Box, ROW_FIELDS, Row, type RowField } from "./schema.js";

/**
 * Turns streamed structured-output snapshots into "field complete" and "row complete" signals (S4.2
 * "Streaming", MM-2). `partial-json` with OBJ|ARR exposes strings and numbers only once they are
 * complete, and every property is required, so a field is complete once its last key
 * (`overwritten_from`) exists and a row once its last key (`signature`) exists. Replays drive the
 * same code from recorded deltas, so live and replayed runs emit identical signals.
 */
export interface TrackerHandlers {
  /** A field's box is final; its value is not exposed (the band moves, nothing prints). */
  onField?: (
    row: number,
    field: RowField | "deductions",
    box: Box,
    slipBox: Box | null,
    deductionIndex?: number,
  ) => void;
  /** A row is complete and schema-valid. */
  onRow?: (row: number, data: Row) => void;
  /** The page header (rotation, issues) is complete: rows follow it in schema order. */
  onPage?: (page: { rotation: string; issues: string[] }) => void;
  /** A mid-stream fallback discarded the partial snapshot. */
  onReset?: () => void;
}

const PARTIAL = Allow.OBJ | Allow.ARR;
const ROW_SCHEMA = jsonSchemaOf(Row);

function isBox(v: unknown): v is Box {
  const b = v as Box | undefined;
  return (
    !!b &&
    typeof b.x1 === "number" &&
    typeof b.y1 === "number" &&
    typeof b.x2 === "number" &&
    typeof b.y2 === "number"
  );
}

export class ExtractionStreamTracker {
  private fields = new Set<string>();
  private rows = new Set<number>();
  private last = "";
  private pageSeen = false;

  constructor(private readonly handlers: TrackerHandlers) {}

  /** Feed the full JSON text so far (the gateway's `onSnapshot`). An empty string means reset. */
  readonly push = (snapshot: string): void => {
    if (snapshot === "") {
      this.fields = new Set();
      this.rows = new Set();
      this.last = "";
      this.pageSeen = false;
      this.handlers.onReset?.();
      return;
    }
    if (snapshot === this.last) return;
    this.last = snapshot;
    let doc: unknown;
    try {
      doc = parse(snapshot, PARTIAL);
    } catch {
      return; // not yet parseable (or a continuation after a fallback); wait for more
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return;
    const d = doc as { page?: { rotation?: unknown; issues?: unknown }; rows?: unknown };
    if (
      !this.pageSeen &&
      "rows" in d &&
      typeof d.page?.rotation === "string" &&
      Array.isArray(d.page.issues)
    ) {
      this.pageSeen = true;
      this.handlers.onPage?.({ rotation: d.page.rotation, issues: d.page.issues as string[] });
    }
    const rows = d.rows;
    if (!Array.isArray(rows)) return;
    rows.forEach((raw, i) => {
      this.visitRow(i, raw as Record<string, unknown>);
    });
  };

  private visitRow(i: number, row: Record<string, unknown>): void {
    if (!row || typeof row !== "object") return;
    const slipBox = isBox(row.slip_box) && "copy" in row ? row.slip_box : null;
    for (const field of ROW_FIELDS) {
      const f = row[field] as Record<string, unknown> | undefined;
      const id = `${i}:${field}`;
      if (f && "overwritten_from" in f && isBox(f.box) && !this.fields.has(id)) {
        this.fields.add(id);
        this.handlers.onField?.(i, field, f.box, slipBox);
      }
    }
    const deductions = row.deductions;
    if (Array.isArray(deductions)) {
      deductions.forEach((d: Record<string, unknown>, j) => {
        const id = `${i}:deductions:${j}`;
        if (d && "overwritten_from" in d && isBox(d.box) && !this.fields.has(id)) {
          this.fields.add(id);
          this.handlers.onField?.(i, "deductions", d.box, slipBox, j);
        }
      });
    }
    if ("signature" in row && !this.rows.has(i)) {
      const parsed = Row.safeParse(coerceEnumCase(ROW_SCHEMA, row));
      if (parsed.success) {
        this.rows.add(i);
        this.handlers.onRow?.(i, parsed.data);
      }
    }
  }
}
