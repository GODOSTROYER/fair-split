// Fair Split film v7: one shape for stills, whatever stills/stills.json looks like on disk.
// CAPTURE's manifest (e2e/film/stills-kit.ts) is a list of full frames, each with its crops; the film wants a flat
// map where a full frame and each of its crops is a still of its own (CONTRACT.md section 4):
//   "<id>"              the full frame          { file, kind: "full", width, height, scale, boxes }
//   "<id>.<crop name>"  one element of it       { file, kind: "crop", width, height, scale, boxes, cropOf, origin }
// A crop uses its high-scale copy when CAPTURE shot one. Boxes are { x, y, w, h } in CSS px of that image.
const box = (source) => ({
  x: source.x,
  y: source.y,
  w: source.w ?? source.width,
  h: source.h ?? source.height,
});

export function normalizeStills(raw) {
  if (!raw) return { version: 1, deviceScaleFactor: 2, stills: {} };
  if (!Array.isArray(raw.stills)) {
    // already the flat map
    const stills = {};
    for (const [id, still] of Object.entries(raw.stills ?? {}))
      stills[id] = {
        ...still,
        boxes: Object.fromEntries(
          Object.entries(still.boxes ?? {}).map(([name, value]) => [name, box(value)]),
        ),
      };
    return { version: raw.version ?? 1, deviceScaleFactor: raw.deviceScaleFactor ?? 2, stills };
  }
  const stills = {};
  for (const entry of raw.stills) {
    const boxes = Object.fromEntries(
      Object.entries(entry.boxes ?? {}).map(([name, value]) => [name, box(value)]),
    );
    stills[entry.id] = {
      file: entry.file,
      state: entry.state,
      title: entry.title,
      kind: "full",
      width: entry.css.width,
      height: entry.css.height,
      scale: entry.deviceScale,
      boxes,
      ...(entry.flags?.length
        ? { flags: entry.flags.map((flag) => ({ text: flag.text, box: box(flag.box) })) }
        : {}),
    };
    for (const crop of entry.crops ?? []) {
      const best = crop.hi ?? crop;
      const origin = { x: crop.box.x, y: crop.box.y };
      const inside = {};
      for (const [name, value] of Object.entries(boxes)) {
        const fits =
          value.x >= origin.x - 0.5 &&
          value.y >= origin.y - 0.5 &&
          value.x + value.w <= origin.x + crop.box.width + 0.5 &&
          value.y + value.h <= origin.y + crop.box.height + 0.5;
        if (fits) inside[name] = { x: value.x - origin.x, y: value.y - origin.y, w: value.w, h: value.h };
      }
      stills[`${entry.id}.${crop.name}`] = {
        file: best.file,
        state: entry.state,
        kind: "crop",
        width: crop.box.width,
        height: crop.box.height,
        scale: best.deviceScale,
        boxes: inside,
        cropOf: entry.id,
        origin,
        ...(crop.flags?.length ? { flags: crop.flags } : {}),
        ...(crop.variant ? { variant: true } : {}),
        ...(crop.note ? { note: crop.note } : {}),
      };
    }
  }
  return { version: raw.version ?? 1, deviceScaleFactor: raw.deviceScale ?? 2, stills };
}
