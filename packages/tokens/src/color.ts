// Colour maths for the token pipeline: hex ↔ sRGB ↔ OKLab ↔ OKLCH (Björn Ottosson's matrices), the sRGB
// blend S2 calls "mix n%", and WCAG 2.x contrast. Pure functions; no platform code.

export type Rgb = readonly [number, number, number];
export type Oklch = readonly [l: number, c: number, h: number];

export function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: Rgb): string {
  const part = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = parseHex(hex).map((v) => toLinear(v / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.sqrt(A * A + B * B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, C, C < 1e-6 ? 0 : H];
}

/** OKLCH to 8-bit sRGB, clamped into gamut. */
export function oklchToRgb([L, C, H]: Oklch): Rgb {
  const hr = (H * Math.PI) / 180;
  const A = C * Math.cos(hr);
  const B = C * Math.sin(hr);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [r, g, b].map((c) => Math.round(Math.max(0, Math.min(1, fromLinear(c))) * 255)) as unknown as Rgb;
}

export function oklchToHex(value: Oklch): string {
  return toHex(oklchToRgb(value));
}

/** CSS `oklch()` with 4-decimal lightness and chroma and 2-decimal hue: enough to round-trip 8-bit sRGB. */
export function formatOklch([l, c, h]: Oklch, alpha?: number): string {
  const round = (x: number, d: number) => Number(x.toFixed(d));
  const a = alpha === undefined || alpha === 1 ? "" : ` / ${round(alpha, 3)}`;
  return `oklch(${round(l, 4)} ${round(c, 4)} ${round(h, 2)}${a})`;
}

/** S2 §2.2 "mix n%": blend `top` over `under` in sRGB, round each channel, emit opaque hex. */
export function mixHex(top: string, under: string, amount: number): string {
  const a = parseHex(top);
  const b = parseHex(under);
  return toHex([0, 1, 2].map((i) => (a[i] ?? 0) * amount + (b[i] ?? 0) * (1 - amount)) as unknown as Rgb);
}

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => toLinear(v / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function rgbTriplet(hex: string): string {
  return parseHex(hex).join(" ");
}
