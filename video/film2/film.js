/* Fair Split film v7: the scene builders' helper (CONTRACT.md). Loaded by index.html after film-data.js, which
   tools/sync.mjs generates from timing.json, audio/words.json and stills/stills.json. Everything here is a pure
   function of that data: no clocks, no network, no randomness. */
(() => {
  const data = window.FILM_DATA;
  if (!data) throw new Error("film-data.js is missing: run `node tools/sync.mjs` in video/film2");
  const { timing, words, stills } = data;
  const SVG = "http://www.w3.org/2000/svg";
  const fail = (message) => {
    throw new Error(`[FILM] ${message}`);
  };
  const norm = (text) =>
    String(text)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "");

  const sections = new Map(
    timing.sections.map((section) => [section.id, { ...section, end: section.start + section.duration }]),
  );
  const section = (id) => sections.get(id) ?? fail(`no section "${id}" in timing.json`);

  /** Every narration word of a section: [{ w, start, end, line? }], times in film seconds. */
  const sectionWords = (id) => {
    section(id);
    return words.sections?.[id]?.words ?? fail(`audio/words.json has no words for section "${id}"`);
  };

  /** The nth time a word or a run of words is spoken in a section: { start, end } in film seconds.
      Matching ignores case and punctuation: "sixty-four farmers", "Fair Split", "co-op". */
  const word = (id, text, nth = 1) => {
    const list = sectionWords(id);
    const want = String(text).trim().split(/\s+/).map(norm).filter(Boolean);
    if (want.length === 0) fail(`empty word for section "${id}"`);
    let seen = 0;
    for (let index = 0; index + want.length <= list.length; index += 1) {
      if (want.every((token, offset) => norm(list[index + offset].w) === token)) {
        seen += 1;
        if (seen === nth) return { start: list[index].start, end: list[index + want.length - 1].end, index };
      }
    }
    return fail(`"${text}" (occurrence ${nth}) is not spoken in section "${id}"`);
  };

  /** Seconds from the section's own start to that word: the position to give the section's timeline. */
  const at = (id, text, nth = 1, offset = 0) =>
    Math.max(0, round(word(id, text, nth).start - section(id).start + offset));
  const atEnd = (id, text, nth = 1, offset = 0) =>
    Math.max(0, round(word(id, text, nth).end - section(id).start + offset));

  /** A narration line: section 4's "4a" to "4h" and section 6's "one" to "four" (words.json `lines`).
      Returns { section, start, end, text } in film seconds, plus localStart and localEnd from the section's start. */
  const line = (lineId) => {
    for (const id of sections.keys()) {
      const found = words.sections?.[id]?.lines?.[lineId];
      if (!found) continue;
      const zero = section(id).start;
      return {
        section: id,
        start: found.start,
        end: found.end,
        text: found.text,
        localStart: round(found.start - zero),
        localEnd: round(found.end - zero),
      };
    }
    return fail(`audio/words.json has no line "${lineId}"`);
  };

  /** A named moment SOUND marks for the music: "fairSplit" (38 s, the wordmark), "fairSplitFinal" (the last
      hit), "everyPesoTraced". Returns { start, end } in film seconds plus localStart within `sectionId`. */
  const mark = (name, sectionId) => {
    const found = words.marks?.[name] ?? fail(`audio/words.json has no mark "${name}"`);
    const zero = sectionId ? section(sectionId).start : 0;
    return {
      start: found.start,
      end: found.end,
      localStart: round(found.start - zero),
      localEnd: round(found.end - zero),
    };
  };

  function round(value) {
    return Math.round(value * 1000) / 1000;
  }

  /** A still's record from stills/stills.json plus src and maxK, the largest display scale that keeps it at or
      under its native pixels in the final render (scale / timing.outputScale). */
  const still = (id) => {
    const record = stills.stills?.[id] ?? fail(`stills/stills.json has no still "${id}"`);
    return {
      id,
      ...record,
      src: `stills/${record.file}`,
      maxK: record.scale / timing.outputScale,
    };
  };
  const box = (id, name) => {
    const record = still(id);
    return record.boxes?.[name] ?? fail(`still "${id}" has no box "${name}"`);
  };

  /** Show a still (or one named box of it) inside a positioned element, usually a .window.
      options: { width (CSS px of the element), box (a box name, else the whole still), pad (CSS px of the still
      kept around the box, default 0), maxScale (the largest GSAP scale you will tween this element to, default 1) }.
      Sets the element's width and height, adds one <img>, and returns { k, rect(name) } where rect() gives a named
      box in the element's own coordinates for FILM.outline(). Throws if the still would pass its native pixels. */
  const mountStill = (target, id, options = {}) => {
    const element = typeof target === "string" ? document.querySelector(target) : target;
    if (!element) fail(`mountStill: no element for ${target}`);
    const record = still(id);
    const pad = options.pad ?? 0;
    const full = { x: 0, y: 0, w: record.width, h: record.height };
    const named = options.box ? box(id, options.box) : full;
    const crop = {
      x: Math.max(0, named.x - pad),
      y: Math.max(0, named.y - pad),
      w: 0,
      h: 0,
    };
    crop.w = Math.min(record.width, named.x + named.w + pad) - crop.x;
    crop.h = Math.min(record.height, named.y + named.h + pad) - crop.y;
    const width = options.width ?? crop.w;
    const k = width / crop.w;
    const peak = k * (options.maxScale ?? 1);
    if (peak > record.maxK + 1e-6)
      fail(
        `still "${id}" would show at ${peak.toFixed(3)}x its CSS size; the limit is ${record.maxK}x ` +
          `(scale ${record.scale} at output scale ${timing.outputScale}). Crop to one element or make it smaller.`,
      );
    element.style.width = `${round(crop.w * k)}px`;
    element.style.height = `${round(crop.h * k)}px`;
    const image = document.createElement("img");
    image.src = record.src;
    image.alt = "";
    image.decoding = "sync";
    image.setAttribute("data-still", id);
    image.style.width = `${round(record.width * k)}px`;
    image.style.height = `${round(record.height * k)}px`;
    image.style.left = `${round(-crop.x * k)}px`;
    image.style.top = `${round(-crop.y * k)}px`;
    element.appendChild(image);
    const rect = (name) => {
      const inner = box(id, name);
      return {
        x: round((inner.x - crop.x) * k),
        y: round((inner.y - crop.y) * k),
        w: round(inner.w * k),
        h: round(inner.h * k),
      };
    };
    return { k, crop, rect, image };
  };

  /** The outline highlight: a 3 px indigo outline, radius 10, drawn on in 0.3 s. `parent` is the positioned
      element the rect's coordinates belong to (a .window, or the section root); `rect` is { x, y, w, h } in its
      CSS px; `grow` is the gap between the element and the line (default 6). Adds the draw-on to `timeline` at
      `position` and returns the <svg>, so the section can remove it later with an opacity tween. */
  const outline = (timeline, parent, rect, position, options = {}) => {
    const host = typeof parent === "string" ? document.querySelector(parent) : parent;
    if (!host) fail(`outline: no element for ${parent}`);
    const grow = options.grow ?? 6;
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("class", "hl");
    const w = rect.w + grow * 2;
    const h = rect.h + grow * 2;
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.style.left = `${rect.x - grow}px`;
    svg.style.top = `${rect.y - grow}px`;
    const shape = document.createElementNS(SVG, "rect");
    shape.setAttribute("x", "1.5");
    shape.setAttribute("y", "1.5");
    shape.setAttribute("width", String(w - 3));
    shape.setAttribute("height", String(h - 3));
    shape.setAttribute("rx", String(options.radius ?? 10));
    shape.setAttribute("pathLength", "1");
    shape.setAttribute("stroke-dasharray", "1");
    shape.setAttribute("stroke-dashoffset", "1");
    svg.appendChild(shape);
    host.appendChild(svg);
    timeline.fromTo(
      shape,
      { attr: { "stroke-dashoffset": 1 } },
      { attr: { "stroke-dashoffset": 0 }, duration: options.duration ?? 0.3, ease: "power2.out" },
      position,
    );
    return svg;
  };

  window.FILM = {
    timing,
    estimated: words.estimated === true,
    section,
    words: sectionWords,
    word,
    at,
    atEnd,
    line,
    mark,
    still,
    box,
    mountStill,
    outline,
    /** The house move: 0.5 to 0.9 s, ease-out, then hold. */
    ease: "power3.out",
    move: 0.7,
  };
})();
