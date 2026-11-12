// Fair Split film v7: the sharpness lint (research/film-1111/storyboard.md, "Sharpness rules"; CONTRACT.md).
// The last cut was rejected for blur, veils, darker shades and a corner mark. This fails the build on any of them.
//   node tools/lint.mjs                       every file of the film
//   node tools/lint.mjs compositions/s4-demo.html   only the files you name
// Exit 1 on any error. Warnings are things a person must look at; they do not fail.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeStills } from "./stills-shape.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file, fallback) =>
  existsSync(join(root, file)) ? JSON.parse(readFileSync(join(root, file), "utf8")) : fallback;
const timing = readJson("timing.json");
const stillsFile = readJson("stills/stills.json", null);
const stills = normalizeStills(stillsFile).stills;
const stillByFile = new Map(Object.entries(stills).map(([id, still]) => [still.file, { id, ...still }]));

const GROUND = "#f7f8fb";
const WINDOW_SHADOW = { y: 8, blur: 30, alpha: 0.08, rgb: [14, 21, 37] };
const DISCLOSURE =
  /\b(simulat(?:ed|or|ion|e|es|ing)|synthetic|samples?|sampled|replay(?:ed|s|ing)?|sandbox(?:ed|es)?)\b/gi;

const named = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const files =
  named.length > 0
    ? named.map((file) => file.replaceAll("\\", "/"))
    : [
        "index.html",
        "film.css",
        "film.js",
        ...(existsSync(join(root, "assets", "objects"))
          ? readdirSync(join(root, "assets", "objects"))
              .filter((name) => /\.(js|css|html|svg)$/.test(name))
              .sort()
              .map((name) => `assets/objects/${name}`)
          : []),
        ...readdirSync(join(root, "compositions"))
          .filter((name) => name.endsWith(".html"))
          .sort()
          .map((name) => `compositions/${name}`),
      ];

const errors = [];
const warnings = [];

/** Blank out comments but keep every newline and column, so findings still point at the right line. */
const stripComments = (text) =>
  text
    .replace(/<!--[\s\S]*?-->/g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[\s;{}(),])\/\/[^\n]*/g, (match, lead) => lead + " ".repeat(match.length - lead.length));

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

const parseColour = (value) => {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4)
      digits = [...digits].map((digit) => digit + digit).join("");
    if (digits.length !== 6 && digits.length !== 8) return null;
    const channel = (offset) => Number.parseInt(digits.slice(offset, offset + 2), 16);
    return { r: channel(0), g: channel(2), b: channel(4), a: digits.length === 8 ? channel(6) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/i.exec(
    value.trim(),
  );
  if (rgb) {
    const alpha =
      rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? Number.parseFloat(rgb[4]) / 100 : Number(rgb[4]);
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: alpha };
  }
  return null;
};
const luma = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const chroma = ({ r, g, b }) => Math.max(r, g, b) - Math.min(r, g, b);
const hue = ({ r, g, b }) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const delta = max - min;
  const raw = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (raw * 60 + 360) % 360;
};
const COLOUR = /#[0-9a-f]{3,8}\b|rgba?\([^()]*\)/gi;

/** A shadow is allowed only if it is a hard ring (no blur) or no stronger than the window shadow. */
const shadowAllowed = (value) => {
  const text = value
    .trim()
    .replace(/!important/g, "")
    .trim();
  if (text === "none" || text === "var(--shadow-window)" || text === "") return true;
  // split on commas that are not inside rgba( )
  const layers = text.split(/,(?![^()]*\))/);
  return layers.every((layer) => {
    if (/\binset\b/.test(layer)) return false;
    const colourText = layer.match(COLOUR)?.[0];
    const lengths =
      layer
        .replace(COLOUR, " ")
        .match(/-?[\d.]+(?:px)?/g)
        ?.map(Number.parseFloat) ?? [];
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    if (blur === 0) return true; // a hard ring is a line, not a blur
    const colour = colourText ? parseColour(colourText) : null;
    if (!colour) return false;
    const sameInk =
      colour.r === WINDOW_SHADOW.rgb[0] &&
      colour.g === WINDOW_SHADOW.rgb[1] &&
      colour.b === WINDOW_SHADOW.rgb[2];
    return (
      sameInk &&
      x === 0 &&
      y <= WINDOW_SHADOW.y &&
      blur <= WINDOW_SHADOW.blur &&
      spread <= 0 &&
      colour.a <= WINDOW_SHADOW.alpha + 1e-9
    );
  });
};

const section = (file) => /compositions\/s(\d)-/.exec(file)?.[1];

for (const file of files) {
  const path = resolve(root, file);
  if (!existsSync(path)) {
    errors.push({ file, line: 0, rule: "missing", text: "file does not exist" });
    continue;
  }
  const raw = readFileSync(path, "utf8");
  const text = stripComments(raw);
  const isTemplate = file.includes("/_");
  const error = (index, rule, message) =>
    errors.push({ file, line: lineOf(text, index), rule, text: message });
  const warn = (index, rule, message) =>
    warnings.push({ file, line: lineOf(text, index), rule, text: message });
  const each = (pattern, callback) => {
    for (const match of text.matchAll(pattern)) callback(match, match.index);
  };

  // 1. no blur, at rest or in motion
  each(/blur\s*\(/gi, (_, index) =>
    error(index, "blur", "blur( is forbidden everywhere, at rest and in motion"),
  );
  each(/backdrop-?filter/gi, (_, index) => error(index, "backdrop-filter", "backdrop-filter is forbidden"));
  each(/<\s*(filter|feGaussianBlur|feDropShadow)\b/gi, (match, index) =>
    error(index, "svg-filter", `<${match[1]}> is forbidden: no SVG filters`),
  );
  each(/drop-shadow\s*\(/gi, (_, index) =>
    error(index, "drop-shadow", "drop-shadow( is forbidden; the only shadow is the window's box-shadow"),
  );
  // any other filter: CSS `filter:` or a GSAP `filter:` / `webkitFilter:` key
  each(/(^|[\s;{,"'])(-webkit-)?filter\s*:\s*([^;}\n]*)/gim, (match, index) => {
    if (/^\s*["']?none["']?\s*,?$/.test(match[3])) return;
    error(
      index + match[1].length,
      "filter",
      `filter effects are forbidden (found "${match[0].trim().slice(0, 60)}")`,
    );
  });
  each(/webkitFilter\s*:/g, (_, index) => error(index, "filter", "filter effects are forbidden"));
  each(/text-?shadow\s*:/gi, (_, index) => error(index, "text-shadow", "text-shadow is forbidden"));
  each(/box-?shadow\s*:\s*["'`]?([^;}"'`\n]*)/gi, (match, index) => {
    if (!shadowAllowed(match[1]))
      error(
        index,
        "shadow",
        `shadow "${match[1].trim()}" is beyond the window shadow (at most 0 8px 30px rgba(14,21,37,0.08); use var(--shadow-window))`,
      );
  });

  // 2. no scrims, veils, dimming or darkening overlays
  each(/mix-?blend-?mode\s*:\s*["']?(?!normal)[a-z-]+/gi, (_, index) =>
    error(index, "blend", "mix-blend-mode is forbidden: it changes the brightness of what is under it"),
  );
  each(/(linear|radial|conic)-gradient\s*\(|<\s*(linearGradient|radialGradient)\b/gi, (_, index) =>
    error(index, "gradient", "gradients are forbidden (a flat tint is a single colour, not a gradient)"),
  );
  each(
    /(?:class|id)\s*=\s*["'][^"']*\b[\w-]*(scrim|veil|dimmer|vignette|grain|bloom|backdrop|overlay)[\w-]*/gi,
    (match, index) =>
      error(
        index,
        "scrim-name",
        `an element named "${match[1]}": no scrims, veils, vignettes, grain or glow layers`,
      ),
  );
  // a dark, near-neutral colour with partial alpha is a dimming layer wherever it is used (the window shadow aside)
  const withoutShadows = text
    .replace(/box-?shadow\s*:\s*[^;}\n]*/gi, (match) => " ".repeat(match.length))
    .replace(/--shadow-window\s*:[^;}\n]*/gi, (match) => " ".repeat(match.length));
  for (const match of withoutShadows.matchAll(COLOUR)) {
    const colour = parseColour(match[0]);
    if (!colour) continue;
    if (colour.a > 0 && colour.a < 1 && luma(colour) < 0.5 && chroma(colour) < 48)
      error(
        match.index,
        "scrim",
        `${match[0]} is a translucent dark colour: no dimming or darkening overlays`,
      );
    // no brown, amber, tan or cream
    const angle = hue(colour);
    if (chroma(colour) >= 24 && angle >= 18 && angle <= 62)
      error(
        match.index,
        "brown",
        `${match[0]} is a brown, amber, tan or cream (hue ${Math.round(angle)}): not in this film`,
      );
  }
  // a full-frame layer may only be transparent or the one ground
  each(/([^{}]+)\{([^{}]*)\}/g, (match, index) => {
    const selector = match[1].trim();
    const body = match[2];
    if (!/(^|[;\s])(background|background-color)\s*:/.test(body)) return;
    const fullFrame =
      /(^|[;\s])inset\s*:\s*0(px)?\s*(;|$)/.test(body) ||
      (/width\s*:\s*(100%|1920px)/.test(body) && /height\s*:\s*(100%|1080px)/.test(body));
    if (!fullFrame) return;
    const value = /(?:background|background-color)\s*:\s*([^;]*)/.exec(body)?.[1].trim().toLowerCase() ?? "";
    const opacity = /(^|[;\s])opacity\s*:\s*([\d.]+)/.exec(body)?.[2];
    const isGround =
      value === GROUND || value === "var(--ground)" || value === "transparent" || value === "none";
    if (!isGround)
      error(
        index + match[0].indexOf("{"),
        "ground",
        `"${selector.split("\n").pop().trim()}" is a full-frame layer filled with ${value}: the one ground is ${GROUND}, and nothing may veil it`,
      );
    else if (
      opacity !== undefined &&
      Number(opacity) > 0 &&
      Number(opacity) < 1 &&
      value !== "transparent" &&
      value !== "none"
    )
      error(
        index,
        "scrim",
        `"${selector.split("\n").pop().trim()}" is a full-frame layer at opacity ${opacity}: that is a veil`,
      );
  });

  // 3. the frame holds still: no loops, drift, tilt or parallax
  each(/repeat\s*:\s*-1|yoyo\s*:\s*true/g, (_, index) =>
    error(index, "drift", "endless or yoyo motion is forbidden: a move ends, then the frame holds still"),
  );
  each(
    /\b(rotationX|rotationY|rotateX|rotateY|skewX|skewY|perspective|transformPerspective)\b\s*[:(]/g,
    (match, index) => error(index, "tilt", `${match[1]} is forbidden: no tilting, 3D or parallax`),
  );
  each(/duration\s*:\s*([\d.]+)/g, (match, index) => {
    if (Number(match[1]) > 0.9)
      warn(
        index,
        "slow-move",
        `a ${match[1]} s tween: moves take 0.5 to 0.9 s (a line drawing itself may take longer; a drifting camera may not)`,
      );
  });

  // 4. the one disclosure is said and shown once, in section 7
  const sectionNumber = section(file);
  if (sectionNumber && Number(sectionNumber) <= 6) {
    // still ids and box names are data, not screen text
    const screen = text
      .replace(/FILM\.(still|box|mountStill)\s*\(([^)]*)\)/g, (match) =>
        match.replace(/["'`][^"'`]*["'`]/g, (literal) => " ".repeat(literal.length)),
      )
      .replace(/(\.rect\s*\(|box\s*:|data-still\s*=)\s*["'`][^"'`]*["'`]/g, (match) =>
        " ".repeat(match.length),
      )
      .replace(/stills\/[\w./-]+/g, (match) => " ".repeat(match.length));
    for (const match of screen.matchAll(DISCLOSURE))
      error(
        match.index,
        "disclosure",
        `"${match[0]}" in section ${sectionNumber}: Simulated, Synthetic, Sample, Replayed and sandbox appear once, in section 7`,
      );
  }

  // 5. pictures: product only from stills/, never above native pixels; nothing else is a raster
  if (file.startsWith("compositions/") && !isTemplate) {
    each(/["'(]([\w./-]+\.(png|jpe?g|webp|gif|avif|mp4|webm|mov))\b/gi, (match, index) => {
      const source = match[1];
      if (!/(^|\/)stills\//.test(source))
        return error(
          index,
          "raster",
          `${source}: everything that is not product is live HTML or SVG, never a raster or a video`,
        );
      const name = source.replace(/^.*stills\//, "");
      if (stillsFile && !stillByFile.has(name))
        error(index, "still-unknown", `${source} is not listed in stills/stills.json`);
    });
    const limit = (still) => still.scale / timing.outputScale;
    // <img src="stills/x.png" width="N"> or style="width: Npx"
    each(/<img\b[^>]*>/gi, (match, index) => {
      const source = /src\s*=\s*["'][^"']*stills\/([^"']+)["']/.exec(match[0])?.[1];
      if (!source) return;
      const still = stillByFile.get(source);
      const width =
        /\bwidth\s*=\s*["']?([\d.]+)/.exec(match[0])?.[1] ??
        /style\s*=\s*["'][^"']*\bwidth\s*:\s*([\d.]+)px/.exec(match[0])?.[1];
      if (!still) return;
      if (width === undefined)
        return warn(
          index,
          "still-size",
          `stills/${source} has no literal width here: check by eye that it stays at or under ${still.width * limit(still)} px wide`,
        );
      const k = Number(width) / still.width;
      if (k > limit(still) + 1e-6)
        error(
          index,
          "still-native",
          `stills/${source} shown ${width} px wide is ${k.toFixed(2)}x its CSS size; the limit at output scale ${timing.outputScale} is ${limit(still)}x (${still.width * limit(still)} px)`,
        );
    });
    // FILM.mountStill(target, "id", { width, box, pad, maxScale }) with literal values
    each(/FILM\.mountStill\s*\(\s*[^,]+,\s*["'`]([^"'`]+)["'`]\s*(?:,\s*\{([^}]*)\})?/g, (match, index) => {
      const id = match[1];
      const options = match[2] ?? "";
      if (!stillsFile) return;
      const still = stills[id];
      if (!still) return error(index, "still-unknown", `still "${id}" is not in stills/stills.json`);
      const number = (key) => {
        const found = new RegExp(`\\b${key}\\s*:\\s*([\\d.]+)\\s*(,|$)`).exec(options);
        return found ? Number(found[1]) : undefined;
      };
      const boxName = /\bbox\s*:\s*["'`]([^"'`]+)["'`]/.exec(options)?.[1];
      if (boxName && !still.boxes?.[boxName])
        return error(index, "box-unknown", `still "${id}" has no box "${boxName}" in stills/stills.json`);
      const pad = number("pad") ?? 0;
      const area = boxName ? still.boxes[boxName] : { x: 0, y: 0, w: still.width, h: still.height };
      const left = Math.max(0, area.x - pad);
      const cropWidth = Math.min(still.width, area.x + area.w + pad) - left;
      // a disclosure word CAPTURE could not hide must stay outside what is shown
      const right = left + cropWidth;
      const top = Math.max(0, area.y - pad);
      const bottom = Math.min(still.height, area.y + area.h + pad);
      for (const flag of still.flags ?? []) {
        const words = flag.text ?? flag;
        const at = flag.box;
        const shown = !at || (at.x < right && at.x + at.w > left && at.y < bottom && at.y + at.h > top);
        if (shown && Number(sectionNumber) <= 6)
          error(
            index,
            "disclosure",
            `still "${id}" still shows "${words}"${at ? "" : " somewhere"}: crop it out with box and pad, or use another still`,
          );
      }
      const width = number("width");
      if (width === undefined && /\bwidth\s*:/.test(options))
        return warn(
          index,
          "still-size",
          `still "${id}": width is computed, so the native-pixel limit is checked only when the film runs (FILM.mountStill throws)`,
        );
      const k = (width ?? cropWidth) / cropWidth;
      const peak = k * (number("maxScale") ?? 1);
      if (peak > limit(still) + 1e-6)
        error(
          index,
          "still-native",
          `still "${id}" would show at ${peak.toFixed(2)}x its CSS size; the limit at output scale ${timing.outputScale} is ${limit(still)}x. Crop to one element or make it smaller`,
        );
    });
    // a GSAP scale above 1 on anything: say so, a person checks it is not a still
    each(/\bscale[XY]?\s*:\s*([\d.]+)/g, (match, index) => {
      if (Number(match[1]) > 1)
        warn(
          index,
          "scale-up",
          `a tween to scale ${match[1]}: if its target holds a still, pass maxScale: ${match[1]} to FILM.mountStill so the limit is checked`,
        );
    });
  }
}

const show = (kind, list) => {
  for (const item of list) console.log(`${kind}  ${item.file}:${item.line}  [${item.rule}] ${item.text}`);
};
show("warn ", warnings);
show("ERROR", errors);
if (!stillsFile) console.log("note: stills/stills.json is not there yet, so still sizes were not checked");
console.log(`film lint: ${files.length} file(s), ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length > 0 ? 1 : 0);
