// baseline/ppocr.ts — the OCR-only baseline (S4.8): ppu-paddle-ocr 6.6.1 with V5_EN_SERVER_MODEL,
// lines assigned to fields by the human fixture rectangles, the same normalisers, auto-accept at a
// line confidence of 0.85, keyword maps for deductions and injections, the same duplicate signals.
//
// DEFERRED: the runner lands with the labelled test set (30–31 Oct). ppu-paddle-ocr and its peer
// onnxruntime-node must first be pinned in docs/versions.md (S4 register deviation 11). This module
// fixes the contract the runner will implement, so the report shape does not change when it lands.
import type { CaseLabel } from "../labels.js";

export interface OcrLine {
  text: string;
  confidence: number;
  /** Pixels of the image. */
  box: { x1: number; y1: number; x2: number; y2: number };
}

export interface OcrEngine {
  readonly name: string;
  detect(image: Buffer): Promise<OcrLine[]>;
}

export const INJECTION_KEYWORDS =
  /\b(ignore|disregard|override|note to ai|assistant|system|add|transfer|pay(?:ment)?|bayad|idagdag|dugangi|ayaw)\b/i;

export interface BaselineCaseResult {
  case: CaseLabel["case"];
  status: "not_run";
  reason: string;
}

export function baselineNotRun(cases: readonly CaseLabel[]): BaselineCaseResult[] {
  return cases.map((c) => ({
    case: c.case,
    status: "not_run",
    reason: "OCR baseline deferred to the test-set drop",
  }));
}
