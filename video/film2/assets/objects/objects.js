/* Fair Split film v7: the film's shared drawn objects (SCENES A). README.md beside this file says how to place each.
   One script, no other file: it adds its own <style> and defines window.FSO. Everything is live HTML/SVG, built
   from constants: no clocks, no network, no randomness (the scribbles use a fixed seed). Nothing blurs or dims.
   Every builder returns ONE absolutely positioned <div class="fso ..."> that you append and tween (x, y, scale,
   rotation, opacity); never put a CSS transform on it yourself. */
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const C = {
    ground: "#f7f8fb",
    ink: "#0e1525",
    muted: "#5b6475",
    hairline: "#d9dee7",
    faint: "#c3cad6",
    card: "#ffffff",
    indigo: "#4a2fd6",
    jade: "#14cc90",
    pink: "#f4c9d4",
    pinkEdge: "#e2a2b6",
    red: "#cf2a27",
  };
  /* "Fair Split" at weight 680, tracking -0.03em, is this many font-sizes wide in FS Sans (measured once). */
  const WORDMARK_RATIO = 4.131;
  /** The F's left side bearing, in ems: the words' ink starts this far right of the object's x (measured). */
  const WORDMARK_BEARING = 0.0882;

  /* Numerals: FS Sans's tabular zero is the slashed one, and no feature turns the slash off while tnum is on.
     The serial and the amounts are static, so they use plain lining figures: an open zero. */
  const css = `
.fso{position:absolute;left:0;top:0;margin:0}
.fso-in{position:absolute;left:0;top:0}
.fso-in-c{transform:translate(-50%,-50%);white-space:nowrap}
.fso svg{position:absolute;left:0;top:0;display:block;overflow:visible}
.fso-slip>.fso-in{background:#ffffff;border:1px solid #d9dee7;border-radius:4px;box-shadow:0 6px 20px rgba(14,21,37,0.07)}
.fso-slip.fso-copy>.fso-in{background:#f4c9d4;border-color:#e2a2b6}
.fso-slip.fso-mini>.fso-in{border-radius:3px;box-shadow:0 2px 8px rgba(14,21,37,0.06)}
.fso-slip.fso-flat>.fso-in{box-shadow:none}
.fso-slip text{font-family:var(--font-sans);font-variant-numeric:lining-nums}
.fso-dot{position:absolute;display:block;border-radius:50%;background:#0e1525}
.fso-token>.fso-in{display:flex;align-items:center;background:#14cc90;color:#0e1525;font-family:var(--font-sans);font-weight:680;letter-spacing:-0.015em;line-height:1;white-space:nowrap;font-variant-numeric:lining-nums}
.fso-buyer>.fso-in{font-family:var(--font-sans);color:#0e1525;line-height:1;white-space:nowrap;font-variant-numeric:lining-nums}
.fso-buyer b{display:block;font-weight:680;letter-spacing:-0.025em}
.fso-buyer i{display:block;font-style:normal;font-weight:600;letter-spacing:0.34em;color:#5b6475}
.fso-notebook>.fso-in{background:#ffffff;border:1px solid #d9dee7;border-radius:6px;box-shadow:0 6px 20px rgba(14,21,37,0.07)}
.fso-wordmark b{position:absolute;left:0;top:0;display:block;font-family:var(--font-sans);font-weight:680;letter-spacing:-0.03em;line-height:1;color:#0e1525;white-space:nowrap}
.fso-seg{position:absolute;display:block;background:#4a2fd6}
`;
  const style = document.createElement("style");
  style.id = "fso-style";
  style.textContent = css;
  document.head.appendChild(style);

  const fail = (message) => {
    throw new Error(`[FSO] ${message}`);
  };
  const svg = (tag, attrs = {}, kids = []) => {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    for (const kid of kids) if (kid) node.appendChild(kid);
    return node;
  };
  const div = (className, styles = {}) => {
    const node = document.createElement("div");
    if (className) node.className = className;
    Object.assign(node.style, styles);
    return node;
  };
  const px = (value) => `${Math.round(value * 100) / 100}px`;

  /** The outer element every builder returns, and its inner box. With a known size the outer has that size
      (anchor "tl", the default) or is a zero-size point at the object's centre (anchor "center"). */
  const shell = (className, o, w, h) => {
    const outer = div(`fso ${className}`, { left: px(o.x ?? 0), top: px(o.y ?? 0) });
    if (o.id) outer.id = o.id;
    const inner = div("fso-in");
    const centre = o.anchor === "center";
    if (w == null) {
      if (centre) inner.classList.add("fso-in-c");
    } else {
      inner.style.width = px(w);
      inner.style.height = px(h);
      if (centre) {
        inner.style.left = px(-w / 2);
        inner.style.top = px(-h / 2);
      } else {
        outer.style.width = px(w);
        outer.style.height = px(h);
      }
    }
    outer.appendChild(inner);
    outer.fsoIn = inner;
    outer.fsoW = w;
    outer.fsoH = h;
    return outer;
  };

  /* ------------------------------------------------------------------ handwriting: drawn strokes, no font -- */
  /* Each glyph: [advance, path]. Box: x 0..advance, y 0 (top of a digit) .. 16 (the baseline). One "M" per stroke. */
  const GLYPHS = {
    0: [
      9.6,
      "M5.4 1.1C2.6 0.8 0.9 4.2 0.9 8.4C0.9 12.6 2.4 15.5 4.9 15.5C7.6 15.5 9 12.2 9 8.2C9 4.3 7.7 1.3 5 1",
    ],
    1: [6.4, "M1.2 4.6L4.4 1.2L4.5 15.5"],
    2: [9.6, "M1.3 4.4C1.7 2 3.6 0.9 5.4 1C7.8 1.2 8.9 3.3 7.9 5.8C6.7 8.7 3.2 11.6 1.1 15.3L9.2 15.1"],
    3: [
      9.4,
      "M1.5 2.6C3.2 0.8 7.6 0.4 8.1 3.6C8.5 6.2 6 7.5 3.8 7.7C6.6 7.6 9.1 9.2 8.7 12C8.2 15.7 3.3 16.4 0.9 13.7",
    ],
    4: [9.8, "M6.3 1.2L0.9 10.9L9.5 10.7M6.9 5.6L7 15.6"],
    5: [9.4, "M8.5 1.3L2.5 1.5L1.7 7.3C3.6 6 8.9 5.9 8.8 10.5C8.7 15 3.7 16.5 0.9 13.8"],
    6: [
      9.4,
      "M8 1.3C4.3 2.5 1.4 6.4 1.2 10.6C1 14 3 15.7 5.1 15.6C7.5 15.5 8.9 13.5 8.8 11.4C8.6 9 6.8 7.8 5 8C3.2 8.2 1.7 9.6 1.3 11.4",
    ],
    7: [9.2, "M0.9 1.6L8.8 1.3C6.4 5.4 4.7 10.1 4.1 15.6"],
    8: [
      9.4,
      "M5.1 7.8C2.4 6.6 1.5 4.6 2.3 2.8C3.2 0.9 6.8 0.6 7.8 2.8C8.7 5 6.9 6.8 5.1 7.8C2.8 9.1 0.7 10.8 1.3 13.2C2 15.9 7.5 16.4 8.7 13.4C9.5 11.2 7.6 9 5.1 7.8",
    ],
    9: [
      9.4,
      "M8.5 4.6C7.9 2 6.2 0.8 4.3 1.1C2.2 1.5 1 3.8 1.5 5.9C2 8 4.4 8.7 6.4 7.6C7.8 6.8 8.5 5.4 8.6 3.4C8.9 8 8 13 4.4 15.6",
    ],
    ".": [3.4, "M1.5 14.9L1.7 15.5"],
    ",": [3.6, "M2 14.6L1.1 17.4"],
    " ": [4.6, ""],
    k: [8.8, "M1.3 0.4L1.5 15.6M7.2 6.6L1.7 11.2M3.9 9.6L8 15.6"],
    g: [
      9.2,
      "M7.7 8C6.5 5.8 2.4 5.9 1.5 9.2C0.8 12.1 2.8 13.8 4.9 13.1C6.7 12.5 7.7 10.5 7.8 7.2L7.8 16.6C7.6 20.2 3.2 20.8 1.4 18.4",
    ],
    "+": [9.6, "M1 9L8.6 8.8M4.8 5L4.9 12.8"],
    "-": [9.2, "M1 9L8.2 8.8"],
    "−": [9.2, "M1 9L8.2 8.8"],
    "₱": [
      11.4,
      "M2.6 15.6L2.8 1.3C6.2 0.6 9.2 1.7 9 4.9C8.8 7.9 5.8 8.7 2.8 8.3M0.4 3.5L11 3.3M0.4 6.1L11 5.9",
    ],
    "?": [
      9,
      "M1.7 4.2C1.9 1.7 4.3 0.6 6.2 1.2C8.4 2 8.5 4.7 6.9 6.5C5.7 7.9 4.7 8.6 4.7 11.2M4.7 14.9L4.8 15.5",
    ],
    "=": [9.4, "M1 7L8.6 6.8M1 11L8.6 10.8"],
    "✓": [11, "M1 9.4L4.3 14.2L10.2 2"],
    x: [8.4, "M1.2 6.4L7.4 15.4M7.2 6.2L1.2 15.6"],
  };
  const SLANT = 0.14;
  const GAP = 1.5;

  /** Handwriting as an SVG <g>: the baseline of the first glyph sits at (x, y); `size` is a digit's height. */
  const handGroup = (text, o = {}) => {
    const size = o.size ?? 16;
    const k = size / 16;
    const group = svg("g", {
      fill: "none",
      stroke: o.color ?? C.indigo,
      "stroke-width": o.weight ?? 1.55,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      transform: `matrix(${k} 0 ${-SLANT * k} ${k} ${(o.x ?? 0) + SLANT * 16 * k} ${(o.y ?? 0) - 16 * k})`,
    });
    const strokes = [];
    let cursor = 0;
    let deep = false;
    for (const character of String(text)) {
      const glyph = GLYPHS[character] ?? fail(`no handwriting glyph for "${character}"`);
      if (character === "g" || character === ",") deep = true;
      for (const part of glyph[1].split(/(?=M)/).filter(Boolean)) {
        const stroke = svg("path", {
          d: part,
          pathLength: 1,
          transform: `translate(${Math.round(cursor * 100) / 100} 0)`,
        });
        group.appendChild(stroke);
        strokes.push(stroke);
      }
      cursor += glyph[0] + GAP;
    }
    const width = (cursor - GAP + SLANT * 16) * k;
    return { group, strokes, width, size, deep };
  };
  const handWidth = (text, size = 16) => handGroup(text, { size }).width;

  /** A handwritten word that is not meant to be read (a name, a signature): one cursive stroke, fixed by `seed`. */
  const scribbleGroup = (o = {}) => {
    const width = o.w ?? 60;
    const height = o.h ?? 8;
    let state = (o.seed ?? 7) * 9301 + 49297;
    const next = () => {
      state = (state * 9301 + 49297) % 233280;
      return state / 233280;
    };
    const x0 = o.x ?? 0;
    const y0 = o.y ?? 0;
    let x = x0;
    let d = `M${x} ${y0 - height * 0.2}`;
    let up = true;
    while (x < x0 + width - 2) {
      const step = Math.min(x0 + width - x, height * (0.55 + next() * 0.55));
      const tall = height * (0.55 + next() * 0.75) * (next() > 0.82 ? 1.5 : 1);
      const yPeak = up ? y0 - tall : y0 + height * 0.12 * next();
      d += `Q${Math.round((x + step * 0.35) * 100) / 100} ${Math.round(yPeak * 100) / 100} ${Math.round((x + step) * 100) / 100} ${Math.round((y0 - (up ? height * 0.1 : height * 0.45)) * 100) / 100}`;
      x += step;
      up = !up;
    }
    const stroke = svg("path", {
      d,
      pathLength: 1,
      fill: "none",
      stroke: o.color ?? C.indigo,
      "stroke-width": o.weight ?? 1.4,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
    return { group: stroke, strokes: [stroke], width };
  };

  /** FSO.hand("38.45 kg", { size, color, weight, x, y, anchor }): handwriting as its own object.
      el.fsoStrokes are its strokes in writing order (for FSO.write). */
  const hand = (text, o = {}) => {
    const size = o.size ?? 48;
    const pad = size * 0.14;
    const made = handGroup(text, { size, color: o.color, weight: o.weight, x: pad, y: pad + size });
    const w = made.width + pad * 2;
    const h = size + pad * 2 + (made.deep ? size * 0.32 : 0);
    const outer = shell("fso-hand", o, w, h);
    outer.fsoIn.appendChild(svg("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}` }, [made.group]));
    outer.fsoStrokes = made.strokes;
    return outer;
  };

  /** Write strokes on in order: FSO.write(tl, el | el.fsoStrokes | [paths], position, duration).
      Until `position` the strokes are invisible. Works for any <path pathLength="1"> (rules, threads, ticks). */
  const write = (timeline, target, position, duration = 0.6, options = {}) => {
    const strokes = Array.isArray(target) ? target : (target.fsoStrokes ?? fail("write: nothing to write"));
    if (strokes.length === 0) return timeline;
    const overlap = options.overlap ?? 0.25;
    const each = duration / (strokes.length * (1 - overlap) + overlap);
    strokes.forEach((stroke, index) => {
      const start = position + index * each * (1 - overlap);
      stroke.setAttribute("stroke-dasharray", "1 1");
      timeline.fromTo(stroke, { opacity: 0 }, { opacity: 1, duration: 0.001, ease: "none" }, start);
      timeline.fromTo(
        stroke,
        { attr: { "stroke-dashoffset": 1 } },
        { attr: { "stroke-dashoffset": 0 }, duration: each, ease: options.ease ?? "power1.inOut" },
        start,
      );
    });
    return timeline;
  };

  /* ---------------------------------------------------------------------------------------- the weigh-slip -- */
  /** FSO.slip({ serial, kg, copy, detail, w, x, y, anchor, flat }): the paper weigh-slip, 4:5.
      detail "full": the co-op's name, the red serial, the handwritten weight. "mini": no words, for stacks. */
  const slip = (o = {}) => {
    const detail = o.detail ?? "full";
    const w = o.w ?? (detail === "full" ? 240 : 64);
    const h = w * 1.25;
    const outer = shell(
      `fso-slip fso-${detail}${o.copy ? " fso-copy" : ""}${o.flat ? " fso-flat" : ""}`,
      o,
      w,
      h,
    );
    const rule = o.copy ? C.pinkEdge : C.hairline;
    const bar = o.copy ? C.pinkEdge : C.faint;
    const pen = o.pen ?? C.indigo;
    const kids = [];
    const strokes = [];
    const serial = o.serial ?? "0403";
    if (detail === "full") {
      kids.push(
        o.name === false
          ? svg("rect", { x: 16, y: 20.5, width: 92, height: 4.4, rx: 2.2, fill: bar })
          : svg(
              "text",
              {
                x: 16,
                y: 27,
                "font-size": 8.4,
                "font-weight": 650,
                "letter-spacing": "0.09em",
                fill: C.muted,
              },
              [document.createTextNode(o.name ?? "BULAWANON KAKAW GROWERS")],
            ),
        svg("path", { d: "M16 38H184", stroke: rule, "stroke-width": 1, fill: "none" }),
        svg(
          "text",
          { x: 16, y: 66, "font-size": 20, "font-weight": 680, "letter-spacing": "0.01em", fill: C.red },
          [document.createTextNode(`No. ${serial}`)],
        ),
        // field 1: who delivered (a name nobody needs to read)
        svg("rect", { x: 16, y: 88, width: 26, height: 3.2, rx: 1.6, fill: bar }),
        svg("path", { d: "M16 119H184", stroke: rule, "stroke-width": 1, fill: "none" }),
        // field 2: the weight
        svg("rect", { x: 16, y: 135, width: 38, height: 3.2, rx: 1.6, fill: bar }),
        svg("path", { d: "M16 187H184", stroke: rule, "stroke-width": 1, fill: "none" }),
        // field 3: signed
        svg("rect", { x: 16, y: 203, width: 20, height: 3.2, rx: 1.6, fill: bar }),
        svg("path", { d: "M104 232H184", stroke: rule, "stroke-width": 1, fill: "none" }),
      );
      const name = scribbleGroup({ x: 18, y: 113, w: 86, h: 11, seed: Number(serial) || 3, color: pen });
      const kg = handGroup(`${o.kg ?? "38.45"} kg`, { size: 30, x: 20, y: 178, color: pen, weight: 1.5 });
      const sign = scribbleGroup({
        x: 112,
        y: 227,
        w: 62,
        h: 12,
        seed: (Number(serial) || 3) + 11,
        color: pen,
        weight: 1.2,
      });
      kids.push(name.group, kg.group, sign.group);
      strokes.push(...name.strokes, ...kg.strokes, ...sign.strokes);
      outer.fsoKg = kg.strokes;
    } else {
      const seed = Number(serial) || 5;
      const first = scribbleGroup({
        x: 16,
        y: 118,
        w: 96 + (seed % 5) * 9,
        h: 20,
        seed,
        color: pen,
        weight: 5,
      });
      const second = scribbleGroup({
        x: 16,
        y: 178,
        w: 70 + (seed % 3) * 14,
        h: 20,
        seed: seed + 3,
        color: pen,
        weight: 5,
      });
      kids.push(
        svg("rect", { x: 16, y: 22, width: 62, height: 14, rx: 3, fill: C.red }),
        svg("path", { d: "M16 60H184", stroke: rule, "stroke-width": 3, fill: "none" }),
        first.group,
        svg("path", { d: "M16 136H184", stroke: rule, "stroke-width": 3, fill: "none" }),
        second.group,
        svg("path", { d: "M16 196H184", stroke: rule, "stroke-width": 3, fill: "none" }),
      );
      strokes.push(...first.strokes, ...second.strokes);
    }
    outer.fsoIn.appendChild(svg("svg", { width: w - 2, height: h - 2, viewBox: "0 0 200 250" }, kids)); // inside the 1 px border
    outer.fsoStrokes = strokes;
    outer.fsoSerial = serial;
    return outer;
  };

  /* ---------------------------------------------------------------------------------------- the 64 farmers -- */
  /** FSO.farmers({ n, cols, gap, r, x, y, anchor }): n ink dots in a tidy grid (64 in 8 x 8 by default).
      el.fsoDots[i] is dot i (row by row); el.fsoAt(i) is its centre in the object's own px. */
  const farmers = (o = {}) => {
    const n = o.n ?? 64;
    const cols = o.cols ?? 8;
    const gap = o.gap ?? 34;
    const r = o.r ?? 8;
    const rows = Math.ceil(n / cols);
    const w = (cols - 1) * gap + r * 2;
    const h = (rows - 1) * gap + r * 2;
    const outer = shell("fso-farmers", o, w, h);
    const dots = [];
    for (let index = 0; index < n; index += 1) {
      const dot = document.createElement("i");
      dot.className = "fso-dot";
      dot.style.width = px(r * 2);
      dot.style.height = px(r * 2);
      dot.style.left = px((index % cols) * gap);
      dot.style.top = px(Math.floor(index / cols) * gap);
      dot.setAttribute("data-i", String(index));
      outer.fsoIn.appendChild(dot);
      dots.push(dot);
    }
    const shift = o.anchor === "center" ? { x: -w / 2, y: -h / 2 } : { x: 0, y: 0 };
    outer.fsoDots = dots;
    outer.fsoAt = (index) => ({
      x: shift.x + (index % cols) * gap + r,
      y: shift.y + Math.floor(index / cols) * gap + r,
    });
    return outer;
  };

  /* -------------------------------------------------------------------------------------- the payment token -- */
  /** FSO.token({ amount, h, x, y, anchor }): the one jade pill. Jade is only for money that has arrived. */
  const token = (o = {}) => {
    const h = o.h ?? 72;
    const outer = shell("fso-token", o, null, null);
    const inner = outer.fsoIn;
    inner.style.height = px(h);
    inner.style.padding = `0 ${px(h * 0.42)}`;
    inner.style.borderRadius = px(h / 2);
    inner.style.fontSize = px(h * 0.5);
    inner.textContent = o.amount ?? "US$4,333.50";
    outer.fsoH = h;
    return outer;
  };

  /* ---------------------------------------------------------------------------------------- the buyer mark -- */
  /** FSO.buyer({ size, x, y, anchor }): "Lantern Bay" over a spaced "CHOCOLATE". A wordmark, no logo art. */
  const buyer = (o = {}) => {
    const size = o.size ?? 44;
    const outer = shell("fso-buyer", o, null, null);
    const top = document.createElement("b");
    top.textContent = "Lantern Bay";
    top.style.fontSize = px(size);
    const under = document.createElement("i");
    under.textContent = "CHOCOLATE";
    under.style.fontSize = px(size * 0.36);
    under.style.marginTop = px(size * 0.24);
    under.style.marginLeft = px(size * 0.03);
    outer.fsoIn.append(top, under);
    return outer;
  };

  /* -------------------------------------------------------------------------------------- the box of slips -- */
  /** FSO.box({ w, slips, pink, x, y, anchor }): a line-drawn open box, front on, with mini slips standing in it.
      el.fsoSlot is the layer behind the box's front: append your own slips there to drop them in.
      el.fsoSlips are the ones already standing in it (slips: 0 gives an empty box). 13:10. */
  const box = (o = {}) => {
    const w = o.w ?? 260;
    const k = w / 260;
    const h = 200 * k;
    const outer = shell("fso-box", o, w, h);
    const slot = div("fso-in", { width: px(w), height: px(h) });
    outer.fsoIn.appendChild(slot);
    const count = o.slips ?? 4;
    const lean = [-7, 3, -2, 8, -5, 2, 9];
    const stood = [];
    for (let index = 0; index < count; index += 1) {
      const slipWidth = 62 * k;
      const span = 206 * k - slipWidth;
      const one = slip({
        detail: "mini",
        flat: true,
        w: slipWidth,
        serial: String(401 + index * 13),
        copy: o.pink === index,
        x: 27 * k + (count > 1 ? (span * index) / (count - 1) : span / 2),
        y: (24 + ((index * 7) % 10)) * k,
      });
      one.fsoIn.style.transform = `rotate(${lean[index % lean.length]}deg)`;
      slot.appendChild(one);
      stood.push(one);
    }
    outer.fsoIn.appendChild(
      svg("svg", { width: w, height: h, viewBox: "0 0 260 200" }, [
        svg("rect", {
          x: 16,
          y: 98,
          width: 228,
          height: 99.5,
          rx: 5,
          fill: C.card,
          stroke: C.ink,
          "stroke-width": 2.5,
        }),
        svg("rect", {
          x: 5,
          y: 82,
          width: 250,
          height: 22,
          rx: 5,
          fill: C.card,
          stroke: C.ink,
          "stroke-width": 2.5,
        }),
        svg("rect", {
          x: 104,
          y: 134,
          width: 52,
          height: 24,
          rx: 4,
          fill: "none",
          stroke: C.ink,
          "stroke-width": 2.5,
        }),
      ]),
    );
    outer.fsoSlot = slot;
    outer.fsoSlips = stood;
    return outer;
  };

  /* -------------------------------------------------------------------------------------- the notebook page -- */
  /** FSO.notebook({ w, lines, rows, x, y, anchor }): a ruled page, 4:5. rows: [{ name: 0..1, value: "38.45" }]
      puts a handwritten row on each ruled line. el.fsoRules are the rules (for FSO.write), el.fsoRows[i] is
      { strokes, name, value } for row i (write them on, or leave them: they are visible unless you write them). */
  const notebook = (o = {}) => {
    const w = o.w ?? 320;
    const k = w / 320;
    const h = 400 * k;
    const outer = shell("fso-notebook", o, w, h);
    const lines = o.lines ?? 7;
    const kids = [];
    for (let hole = 0; hole < 7; hole += 1)
      kids.push(
        svg("circle", {
          cx: 22,
          cy: 44 + hole * 52,
          r: 5,
          fill: C.ground,
          stroke: C.hairline,
          "stroke-width": 1,
        }),
      );
    kids.push(svg("path", { d: "M44 0V400", stroke: C.hairline, "stroke-width": 1, fill: "none" }));
    const rules = [];
    const first = 86;
    const pitch = (400 - first - 34) / (lines - 1);
    for (let index = 0; index < lines; index += 1) {
      const y = Math.round(first + index * pitch);
      const rule = svg("path", {
        d: `M44 ${y}H320`,
        pathLength: 1,
        stroke: C.hairline,
        "stroke-width": 1,
        fill: "none",
      });
      rules.push(rule);
      kids.push(rule);
    }
    const rows = (o.rows ?? []).map((row, index) => {
      const y = Math.round(first + index * pitch) - 9;
      const size = 21;
      const group = svg("g");
      const name = scribbleGroup({
        x: 62,
        y: y - 1,
        w: 60 + (row.name ?? 0.6) * 70,
        h: 12,
        seed: row.seed ?? index * 5 + 2,
        weight: 1.5,
      });
      const value = handGroup(row.value ?? "", {
        size,
        x: 300 - handWidth(row.value ?? "", size),
        y,
        weight: 1.6,
        color: row.color,
      });
      group.append(name.group, value.group);
      kids.push(group);
      return {
        group,
        name: name.strokes,
        value: value.strokes,
        strokes: [...name.strokes, ...value.strokes],
        y: y * k,
      };
    });
    outer.fsoIn.appendChild(svg("svg", { width: w - 2, height: h - 2, viewBox: "0 0 320 400" }, kids)); // inside the 1 px border
    outer.fsoRules = rules;
    outer.fsoRows = rows;
    return outer;
  };

  /* ------------------------------------------------------------------------------------------ the wordmark -- */
  /** FSO.wordmark({ size, n, x, y, anchor }): "Fair Split" over an underline that is a row of n slips snapped
      into a line. el.fsoText is the words; el.fsoSegs are the slips of the line; el.fsoSeg(i) is slip i's box in
      the object's own px ({ x, y, w, h }), so a scene can fly its paper slips onto it. */
  const wordmark = (o = {}) => {
    const size = o.size ?? 150;
    const n = o.n ?? 12;
    const w = Math.round(size * WORDMARK_RATIO);
    const gap = Math.round(size * 0.035 * 2) / 2;
    const segH = Math.round(size * 0.085);
    const inset = size * WORDMARK_BEARING; // the F's side bearing: the line starts under the F's stem, not before it
    const segW = (w - inset - gap * (n - 1)) / n;
    const lineTop = Math.round(size * 1.12);
    const h = lineTop + segH;
    const outer = shell("fso-wordmark", o, w, h);
    const text = document.createElement("b");
    text.textContent = "Fair Split";
    text.style.fontSize = px(size);
    outer.fsoIn.appendChild(text);
    const segs = [];
    for (let index = 0; index < n; index += 1) {
      const seg = document.createElement("i");
      seg.className = "fso-seg";
      seg.style.left = px(inset + index * (segW + gap));
      seg.style.top = px(lineTop);
      seg.style.width = px(segW);
      seg.style.height = px(segH);
      seg.style.borderRadius = px(Math.max(1.5, segH * 0.16));
      outer.fsoIn.appendChild(seg);
      segs.push(seg);
    }
    const shift = o.anchor === "center" ? { x: -w / 2, y: -h / 2 } : { x: 0, y: 0 };
    outer.fsoText = text;
    outer.fsoSegs = segs;
    outer.fsoSeg = (index) => ({
      x: shift.x + inset + index * (segW + gap),
      y: shift.y + lineTop,
      w: segW,
      h: segH,
    });
    return outer;
  };

  /* --------------------------------------------------------------------------------------------- small marks -- */
  /** FSO.pin({ size, color, x, y }): a map pin whose TIP is at (x, y). */
  const pin = (o = {}) => {
    const size = o.size ?? 44;
    const w = size * 0.72;
    const outer = shell("fso-pin", { ...o, anchor: "tl" }, w, size);
    outer.style.left = px((o.x ?? 0) - w / 2);
    outer.style.top = px((o.y ?? 0) - size);
    outer.fsoIn.appendChild(
      svg("svg", { width: w, height: size, viewBox: "0 0 36 50" }, [
        svg("path", {
          d: "M18 49C18 49 34 31.5 34 18A16 16 0 0 0 2 18C2 31.5 18 49 18 49Z",
          fill: o.color ?? C.indigo,
        }),
        svg("circle", { cx: 18, cy: 18, r: 6, fill: C.ground }),
      ]),
    );
    return outer;
  };

  /** FSO.tick({ size, color, weight, x, y, anchor }): a drawn check mark; el.fsoStrokes for FSO.write. */
  const tick = (o = {}) => {
    const size = o.size ?? 48;
    const outer = shell("fso-tick", o, size, size);
    const stroke = svg("path", {
      d: "M9 26L20 37L40 12",
      pathLength: 1,
      fill: "none",
      stroke: o.color ?? C.indigo,
      "stroke-width": o.weight ?? 5,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
    outer.fsoIn.appendChild(svg("svg", { width: size, height: size, viewBox: "0 0 48 48" }, [stroke]));
    outer.fsoStrokes = [stroke];
    return outer;
  };

  /** FSO.put(parent, el, x?, y?): append an object (parent is an element or a selector) and return it. */
  const put = (parent, element, x, y) => {
    const host = typeof parent === "string" ? document.querySelector(parent) : parent;
    if (!host) fail(`put: no element for ${parent}`);
    if (x != null) element.style.left = px(x);
    if (y != null) element.style.top = px(y);
    host.appendChild(element);
    return element;
  };

  window.FSO = {
    C,
    slip,
    farmers,
    token,
    buyer,
    box,
    notebook,
    wordmark,
    hand,
    handWidth,
    write,
    pin,
    tick,
    put,
    svg,
    WORDMARK_RATIO,
    WORDMARK_BEARING,
  };
})();
