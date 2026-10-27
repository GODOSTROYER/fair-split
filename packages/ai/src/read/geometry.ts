import type { NormRect } from "./_shims/contracts.js";
import type { Box } from "./schema.js";

export const ZERO_BOX: Box = { x1: 0, y1: 0, x2: 0, y2: 0 };

export const isZeroBox = (b: Box): boolean => b.x1 === 0 && b.y1 === 0 && b.x2 === 0 && b.y2 === 0;

export const centre = (b: Box): { x: number; y: number } => ({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 });

export const width = (b: Box): number => Math.max(0, b.x2 - b.x1);
export const height = (b: Box): number => Math.max(0, b.y2 - b.y1);

/** A 0-1 rectangle in pixels of an image of the given size. */
export function toPixels(r: NormRect, w: number, h: number): Box {
  return {
    x1: Math.round(r.x1 * w),
    y1: Math.round(r.y1 * h),
    x2: Math.round(r.x2 * w),
    y2: Math.round(r.y2 * h),
  };
}

export function expand(b: Box, by: number): Box {
  return { x1: b.x1 - by, y1: b.y1 - by, x2: b.x2 + by, y2: b.y2 + by };
}

export function contains(outer: Box, p: { x: number; y: number }): boolean {
  return p.x >= outer.x1 && p.x <= outer.x2 && p.y >= outer.y1 && p.y <= outer.y2;
}

/**
 * S4.2 box validator: the model box's centre must fall inside the fixture (or template) rectangle,
 * with a tolerance of 4% of the slip's width.
 */
export function centreInRect(box: Box, rect: Box, slipWidthPx: number): boolean {
  return contains(expand(rect, 0.04 * slipWidthPx), centre(box));
}

export function intersectionArea(a: Box, b: Box): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return w > 0 && h > 0 ? w * h : 0;
}

export const overlaps = (a: Box, b: Box): boolean => intersectionArea(a, b) > 0;

export function union(a: Box, b: Box): Box {
  if (isZeroBox(a)) return b;
  if (isZeroBox(b)) return a;
  return {
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
    x2: Math.max(a.x2, b.x2),
    y2: Math.max(a.y2, b.y2),
  };
}

export function iou(a: Box, b: Box): number {
  const i = intersectionArea(a, b);
  const u = width(a) * height(a) + width(b) * height(b) - i;
  return u > 0 ? i / u : 0;
}
