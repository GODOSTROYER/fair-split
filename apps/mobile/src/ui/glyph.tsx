/**
 * TEMPORARY: app-drawn glyphs until WS-DS ships the Material Symbols Sharp set and the 14 domain glyphs
 * (S2.6). Same grammar: a 24 px grid, 2 px strokes, square caps, mitred joins, 45° chamfers. Never emoji or
 * sparkles; Claude is the word plus the pencil.
 */
import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";

const STROKE = {
  listen: "M4 9h4l5-4v14l-5-4H4z M16.5 8.5a5 5 0 0 1 0 7 M19 6a8.5 8.5 0 0 1 0 12",
  slip: "M6 3h8l4 4v14H6z M14 3v4h4 M9 11h6 M9 14.5h6 M9 18h3",
  question: "M4 4h16v12h-8l-4 4v-4H4z M10 8.4a2 2 0 1 1 2.9 1.8c-.6.3-.9.8-.9 1.4 M12 13.2v.6",
  scan: "M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M4 12h16",
  outbox: "M4 14v6h16v-6 M4 14h4l1 2h6l1-2h4 M12 3v9 M8.5 6.5L12 3l3.5 3.5",
  sign: "M4 21h16 M14.5 4.5l5 5L10 19H5v-5z M12.5 6.5l5 5",
  check: "M5 12.5l4.5 4.5L19 7.5",
  close: "M6 6l12 12 M18 6L6 18",
  back: "M20 12H5 M11 6l-6 6 6 6",
  forward: "M4 12h15 M13 6l6 6-6 6",
  wifiOff:
    "M3 3l18 18 M2 8.5a15 15 0 0 1 5-2.9 M22 8.5a15 15 0 0 0-8.6-3.4 M5.5 12a10 10 0 0 1 3-1.9 M18.5 12a10 10 0 0 0-2.2-1.5 M9 15.5a5 5 0 0 1 6 0 M12 19v.5",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z M12 7v5l3 2",
  lock: "M5 11h14v10H5z M8 11V8a4 4 0 0 1 8 0v3",
  qr: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2v2h-2z M18 18h2v2h-2z M14 19h2 M19 14h1",
  seal: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9z",
  cash: "M3 7h18v10H3z M12 10a2 2 0 1 0 0 4 2 2 0 1 0 0-4z M6 10v4 M18 10v4",
  pencil: "M4 20l1-5L15.5 4.5l4 4L9 19z M13.5 6.5l4 4",
  fingerprint:
    "M8 20.5c1.4-2.1 2-4.4 2-7.5a2 2 0 0 1 4 0c0 3.2-.6 5.8-1.7 7.9 M5.4 17.4c.9-1.6 1.3-3.2 1.3-4.9a5.3 5.3 0 0 1 10.6 0c0 1.3-.1 2.6-.4 3.8 M4 9.5a8.6 8.6 0 0 1 16 0",
  scale: "M12 2.5V6 M5 13a7 7 0 1 0 14 0 7 7 0 1 0-14 0z M12 13l3-4 M8 13h1 M15 13h1",
  translate:
    "M3 5h10 M8 3v2 M5.5 5c1 3.8 3.4 6.6 6.5 8 M10.5 5c-1 3.8-3.6 6.8-7 8.5 M13 21l4-10 4 10 M14.5 17.5h5",
  contrast: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z",
  refresh: "M20 12a8 8 0 1 1-2.3-5.7 M20 4v5h-5",
  chevron: "M9 6l6 6-6 6",
  chevronDown: "M6 9l6 6 6-6",
  bolt: "M12 3a2 2 0 1 0 0 4 2 2 0 1 0 0-4z M12 17a2 2 0 1 0 0 4 2 2 0 1 0 0-4z",
  people:
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 1 0 0 7z M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6 M16 4.5a3.5 3.5 0 0 1 0 6.5 M21 20c0-2.8-1.7-5-4-5.8",
  camera: "M4 8h4l2-3h4l2 3h4v12H4z M12 10.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 1 0 0-7z",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z M12 11v6 M12 7.5v.6",
  /** Domain glyphs (design §2.6): the jute sack, the duplicate copy, the thumbmark. */
  sack: "M7 5h10l-1 3 3 4v8H5v-8l3-4z M8 8h8",
  duplicate: "M8 4h9l3 3v11H8z M5 7v13h11",
  thumb: "M12 3c3.3 0 6 2.7 6 6v6a6 6 0 0 1-12 0V9c0-3.3 2.7-6 6-6z M12 7v9 M9 9v5 M15 9v5",
} as const;

const FILLED = {
  play: "M7 4.5l13 7.5-13 7.5z",
  pause: "M6 5h4.5v14H6z M13.5 5H18v14h-4.5z",
  contrastHalf: "M12 3a9 9 0 0 0 0 18z",
  stop: "M6 6h12v12H6z",
} as const;

export type GlyphName = keyof typeof STROKE | keyof typeof FILLED;

function isFilled(name: GlyphName): name is keyof typeof FILLED {
  return name in FILLED;
}

/** Decorative by default: the word beside it carries the meaning, so screen readers skip the drawing. */
export function Glyph({ name, size = 24, color }: { name: GlyphName; size?: number; color: ColorValue }) {
  if (isFilled(name)) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} importantForAccessibility="no">
        <Path d={FILLED[name]} fill={color} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} importantForAccessibility="no">
      <Path
        d={STROKE[name]}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      {name === "contrast" ? <Path d={FILLED.contrastHalf} fill={color} /> : null}
    </Svg>
  );
}
