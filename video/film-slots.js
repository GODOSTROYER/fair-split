// Fair Split film: the driver for every capture-slot beat (the highlight reel and the deep dive, 44-143 s), in the
// motion language of video/proto/STYLE.md. One shared day field and one camera on the film's own clock: the windows
// have places in a world (plan.mjs CAPTURE_RUN), the camera holds beside each, pushes in on a long hold and glides
// to the next with the mid-move zoom-out dip and a directional motion blur, so the eleven beat compositions cut into
// each other without a seam (each also carries its neighbours' windows as ghosts for the glides across its edges).
// One keyword per slot at the film's one anchor, one honesty tag, and the placeholder accent beats. Every pixel is
// computed from the time alone; the only noise is seeded. Each beat composition calls FairSplitSlots.build(tl,
// config) with its own paused timeline; config comes from video/build.mjs.
window.FairSplitSlots = (() => {
  const gsap = window.gsap;
  const PE = (name) => gsap.parseEase(name);
  const E = {
    p2i: PE("power2.in"),
    p2o: PE("power2.out"),
    p2io: PE("power2.inOut"),
    p3o: PE("power3.out"),
    eo: PE("expo.out"),
    sio: PE("sine.inOut"),
    so: PE("sine.out"),
  };
  const EASE = { "sine.inOut": E.sio, "sine.out": E.so, none: (u) => u };
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const prog = (t, a, b) => (b <= a ? (t >= a ? 1 : 0) : clamp01((t - a) / (b - a)));
  const lerp = (a, b, u) => a + (b - a) * u;
  const wrap = (v, lo, period) => lo + ((((v - lo) % period) + period) % period);
  const TAU = 2 * Math.PI;
  const SVGNS = "http://www.w3.org/2000/svg";
  const INK = { pod: "#4A2FD6", jade: "#14CC90" };
  function mulberry32(seed) {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // grain: four seeded grey tiles shared by every beat; one per frame at a seeded offset (STYLE §10)
  let tiles = null;
  function grainTiles() {
    if (tiles) return tiles;
    const rng = mulberry32(1104);
    tiles = [0, 1, 2, 3].map(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext("2d");
      const image = context.createImageData(256, 256);
      for (let i = 0; i < 256 * 256; i++) {
        const v = Math.round((255 * (rng() + rng())) / 2);
        image.data[4 * i] = v;
        image.data[4 * i + 1] = v;
        image.data[4 * i + 2] = v;
        image.data[4 * i + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      return canvas;
    });
    return tiles;
  }
  /** The run's camera at film time T: keyframes [t, x, y, s, ease, dip], the dip a zoom-out at mid-move. */
  function cameraAt(keys, T) {
    if (T <= keys[0][0]) return { x: keys[0][1], y: keys[0][2], s: keys[0][3] };
    for (let i = 1; i < keys.length; i++) {
      const [ta, xa, ya, sa] = keys[i - 1];
      const [tb, xb, yb, sb, name, dip] = keys[i];
      if (T <= tb) {
        const u = (T - ta) / (tb - ta);
        const e = EASE[name](u);
        const k = dip ? 1 - dip * Math.sin(Math.PI * E.sio(u)) : 1;
        return { x: lerp(xa, xb, e), y: lerp(ya, yb, e), s: lerp(sa, sb, e) * k };
      }
    }
    const [, x, y, s] = keys[keys.length - 1];
    return { x, y, s };
  }
  const el = (tag, className, parent) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    parent?.appendChild(node);
    return node;
  };
  const svgEl = (tag, attrs, parent) => {
    const node = document.createElementNS(SVGNS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    parent?.appendChild(node);
    return node;
  };
  const place = (node, [x, y, w, h]) => {
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.width = `${w}px`;
    node.style.height = `${h}px`;
  };
  const bezier = (p0, p3, n = 40) => {
    const dx = p3.x - p0.x;
    const c1 = { x: p0.x + dx * 0.5, y: p0.y };
    const c2 = { x: p3.x - dx * 0.5, y: p3.y };
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const v = 1 - u;
      pts.push({
        x: v * v * v * p0.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u * u * u * p3.x,
        y: v * v * v * p0.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u * u * u * p3.y,
      });
    }
    return pts;
  };
  /** The part of a polyline from 0 to `b` (0-1) as an SVG path, and the point at its head. */
  function partial(pts, b) {
    const n = pts.length - 1;
    const ib = b * n;
    const i = Math.min(Math.floor(ib), n - 1);
    const f = ib - i;
    const head = { x: lerp(pts[i].x, pts[i + 1].x, f), y: lerp(pts[i].y, pts[i + 1].y, f) };
    let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let k = 1; k <= i; k++) d += `L${pts[k].x.toFixed(1)} ${pts[k].y.toFixed(1)}`;
    d += `L${head.x.toFixed(1)} ${head.y.toFixed(1)}`;
    return { d, head };
  }

  // ------------------------------------------------------------------------------------------- accent beats
  // Placeholder accents (plan.mjs ACCENTS), drawn inside their window so they float, tilt and blur with it.
  function accentFor(win, slot) {
    const a = slot.accent;
    const [bx, by, bw, bh] = a.box;
    const colour = INK[a.colour] ?? "#0B1220";
    const at = a.at;
    if (a.kind === "pulse") {
      // a button press: a ring that pulses twice, 0.8 s each, 0.1 s apart (STYLE §6)
      const ring = el("div", "pf-acc pf-acc--ring", win);
      place(ring, a.box);
      ring.style.borderRadius = `${bh / 2}px`;
      ring.style.borderColor = colour;
      return (T) => {
        const k = T < at + 0.9 ? 0 : 1;
        const u = prog(T, at + 0.9 * k, at + 0.9 * k + 0.8);
        const on = T >= at && u < 1;
        ring.style.opacity = on ? (0.95 * (1 - E.p2o(u))).toFixed(3) : "0";
        ring.style.transform = `scale(${(1 + 0.16 * E.p2o(u)).toFixed(4)})`;
      };
    }
    if (a.kind === "hit") {
      // money that arrived: the element lights jade, and one jade pulse runs out of it
      const lit = el("div", "pf-acc pf-acc--lit", win);
      place(lit, a.box);
      const cx = bx + bw / 2;
      const cy = by + bh / 2;
      const svg = svgEl(
        "svg",
        { class: "pf-acc pf-acc--svg pf-acc--jade", viewBox: `${cx - 220} ${cy - 160} 440 320` },
        win,
      );
      place(svg, [cx - 220, cy - 160, 440, 320]);
      const ring = svgEl("ellipse", { cx, cy, fill: "none", stroke: INK.jade, "stroke-width": 4 }, svg);
      return (T) => {
        const shown = E.p2o(prog(T, at, at + 0.25)) * (1 - E.p2i(prog(T, slot.kwOut, slot.kwOut + 0.3)));
        lit.style.opacity = shown.toFixed(3);
        const u = prog(T, at, at + 0.7);
        const r = 18 + 92 * E.eo(u);
        ring.setAttribute("rx", (r * 1.35).toFixed(1));
        ring.setAttribute("ry", r.toFixed(1));
        svg.style.opacity = T >= at && u < 1 ? (0.95 * (1 - u)).toFixed(3) : "0";
      };
    }
    if (a.kind === "box") {
      // Claude's reading or a person's hand: an indigo box drawn round the figure (0.5 s), held, then lifted
      const svg = svgEl("svg", { class: "pf-acc pf-acc--svg", viewBox: `0 0 ${bw + 20} ${bh + 20}` }, win);
      place(svg, [bx - 10, by - 10, bw + 20, bh + 20]);
      const rect = svgEl(
        "rect",
        { x: 10, y: 10, width: bw, height: bh, rx: 16, fill: "none", stroke: colour, "stroke-width": 5 },
        svg,
      );
      const L = 2 * (bw + bh) + 40;
      rect.setAttribute("stroke-dasharray", `${L} ${L + 40}`);
      return (T) => {
        const u = E.p2io(prog(T, at, at + 0.5));
        rect.setAttribute("stroke-dashoffset", (L * (1 - u) + 20 * (1 - u)).toFixed(1));
        svg.style.opacity = T < at ? "0" : (1 - E.p2i(prog(T, slot.kwOut, slot.kwOut + 0.3))).toFixed(3);
      };
    }
    if (a.kind === "trace") {
      // her net pay traced to her four slips: four indigo threads converge on the amount (0.45 s each, a light
      // at each head, white nodes at both ends) and end in one jade pulse on the amount they prove (STYLE §4)
      const anchor = { x: bx, y: by + bh / 2 };
      const SLIPS = [
        { x: -470, y: 300, r: -6 },
        { x: -330, y: 430, r: 4 },
        { x: -580, y: 520, r: -3 },
        { x: -400, y: 650, r: 7 },
      ];
      const cards = a.slips.map((serial, i) => {
        const card = el("div", "pf-acc pf-acc--slip", win);
        card.style.backgroundImage = `url("proto/assets/slip-${serial}.jpg")`;
        place(card, [SLIPS[i].x - 60, SLIPS[i].y - 75, 120, 150]);
        return card;
      });
      const svg = svgEl("svg", { class: "pf-acc pf-acc--svg pf-acc--glow", viewBox: "-720 0 1060 760" }, win);
      place(svg, [-720, 0, 1060, 760]);
      const defs = svgEl("defs", {}, svg);
      const grad = svgEl("radialGradient", { id: `${win.id}-light` }, defs);
      for (const [offset, c] of [
        [0, "rgba(255,255,255,1)"],
        [0.25, "rgba(255,255,255,0.9)"],
        [0.5, "rgba(156,140,255,0.45)"],
        [1, "rgba(156,140,255,0)"],
      ])
        svgEl("stop", { offset, "stop-color": c }, grad);
      const threads = SLIPS.map((s, i) => {
        const pts = bezier({ x: s.x + 58, y: s.y }, anchor);
        const t0 = a.threads + 0.1 * i;
        const line = svgEl(
          "path",
          { fill: "none", stroke: colour, "stroke-width": 5, "stroke-linecap": "round" },
          svg,
        );
        const core = svgEl(
          "path",
          { fill: "none", stroke: "rgba(255,255,255,0.35)", "stroke-width": 1.5, "stroke-linecap": "round" },
          svg,
        );
        const node0 = svgEl(
          "circle",
          { cx: pts[0].x, cy: pts[0].y, r: 6, fill: "#fff", stroke: colour, "stroke-width": 3 },
          svg,
        );
        const light = svgEl("circle", { r: 22, fill: `url(#${win.id}-light)` }, svg);
        return { pts, t0, line, core, node0, light };
      });
      const node1 = svgEl(
        "circle",
        { cx: anchor.x, cy: anchor.y, r: 6, fill: "#fff", stroke: colour, "stroke-width": 3 },
        svg,
      );
      const { landed } = a;
      const pulse = svgEl(
        "ellipse",
        { cx: bx + bw / 2, cy: anchor.y, fill: "none", stroke: INK.jade, "stroke-width": 4 },
        svg,
      );
      return (T) => {
        // the trace leaves with its keyword, before the cut: the next beat draws only this window, not its accent
        const gone = 1 - E.p2i(prog(T, slot.kwOut, slot.kwOut + 0.3));
        svg.style.opacity = gone.toFixed(3);
        cards.forEach((card, i) => {
          const u = E.p3o(prog(T, at - 0.35 + 0.08 * i, at + 0.35 + 0.08 * i));
          card.style.opacity = (u * gone).toFixed(3);
          card.style.transform = `translateY(${(30 * (1 - u)).toFixed(2)}px) rotate(${SLIPS[i].r}deg)`;
          card.style.filter = u < 0.98 ? `blur(${(10 * (1 - u)).toFixed(2)}px)` : "none";
        });
        for (const th of threads) {
          const u = E.p2io(prog(T, th.t0, th.t0 + 0.45));
          const on = u > 0;
          th.line.style.opacity = on ? "1" : "0";
          th.core.style.opacity = on ? "1" : "0";
          th.node0.style.opacity = on ? "1" : "0";
          if (on) {
            const { d, head } = partial(th.pts, Math.max(u, 0.001));
            th.line.setAttribute("d", d);
            th.core.setAttribute("d", d);
            th.light.setAttribute("cx", head.x.toFixed(1));
            th.light.setAttribute("cy", head.y.toFixed(1));
          }
          th.light.style.opacity = u > 0 && u < 1 ? "1" : "0";
        }
        node1.style.opacity = T >= landed ? "1" : "0";
        const u = prog(T, landed, landed + 0.7);
        const r = 18 + 92 * E.eo(u);
        pulse.setAttribute("rx", (r * 1.35).toFixed(1));
        pulse.setAttribute("ry", r.toFixed(1));
        pulse.style.opacity = T >= landed && u < 1 ? (0.95 * (1 - u)).toFixed(3) : "0";
      };
    }
    if (a.kind === "wave") {
      // her statement plays: an echo of the night's sound wave flows into the play control (ink, not an accent)
      const anchor = { x: bx + bw / 2, y: by + bh / 2 };
      const svg = svgEl("svg", { class: "pf-acc pf-acc--svg", viewBox: "-720 0 1060 760" }, win);
      place(svg, [-720, 0, 1060, 760]);
      svg.style.opacity = "1";
      const path = svgEl(
        "path",
        { fill: "none", stroke: "rgba(90,100,118,0.62)", "stroke-width": 2.6, "stroke-linecap": "round" },
        svg,
      );
      const x0 = -560;
      return (T) => {
        const head = E.p2o(prog(T, at, at + 0.55));
        const tail = E.p2i(prog(T, at + 0.5, at + 0.95));
        if (head <= tail) {
          path.style.opacity = "0";
          return;
        }
        path.style.opacity = "1";
        const pts = [];
        for (let i = 0; i <= 120; i++) {
          const u = i / 120;
          const x = x0 + u * (anchor.x - x0);
          const amp = 20 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - u * 0.6);
          pts.push({ x, y: anchor.y + amp * Math.sin((TAU * (x - x0)) / 64 - T * 10.5) });
        }
        const a0 = Math.floor(tail * 120);
        const a1 = Math.ceil(head * 120);
        path.setAttribute(
          "d",
          pts
            .slice(a0, a1 + 1)
            .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
            .join(""),
        );
      };
    }
    return null;
  }

  function build(tl, cfg) {
    const $ = (id) => document.getElementById(id);
    const T0 = cfg.filmStart;
    const { keys, outro } = cfg.run;
    const runSlots = new Map(cfg.run.slots.map((slot) => [slot.id, slot]));
    const day = $(`${cfg.id}-day`);
    const world = $(`${cfg.id}-world`);

    // the field: three large light shapes and the leaf shadows, in parallax with the camera (STYLE §1)
    const lights = [
      { el: $(`${cfg.id}-lightA`), x: -700, y: -620, k: 0.12, dx: 60, dy: 40, f: 0.05, w: 1900 },
      { el: $(`${cfg.id}-lightC`), x: 900, y: -560, k: 0.2, dx: -50, dy: 50, f: 0.04, w: 1800 },
      { el: $(`${cfg.id}-lightB`), x: 160, y: 120, k: 0.28, dx: 70, dy: -40, f: 0.035, w: 1700 },
    ];
    const dapple = $(`${cfg.id}-dapple`);

    // directional motion blur keyed to the camera's speed, on the world's own container (STYLE §5)
    const defs = svgEl("svg", { width: 0, height: 0, "aria-hidden": "true", class: "pf-defs" }, day);
    const filter = svgEl(
      "filter",
      {
        id: `${cfg.id}-mblur`,
        x: "-10%",
        y: "-10%",
        width: "120%",
        height: "120%",
        "color-interpolation-filters": "sRGB",
      },
      defs,
    );
    const mblur = svgEl("feGaussianBlur", { stdDeviation: "0 0" }, filter);

    // the windows: this beat's own and its neighbours' ghosts, each at its place in the world
    const wins = [...world.querySelectorAll(".pf-win")]
      .map((node) => ({ el: node, slot: runSlots.get(node.dataset.slot ?? node.dataset.ghost) }))
      .filter((win) => win.slot);
    const drawers = [];
    for (const win of wins) {
      if (win.el.dataset.ghost || !win.slot.accent) continue;
      const drawer = accentFor(win.el, win.slot);
      if (drawer) drawers.push(drawer);
    }

    // the daylight veil: over the deep dive's bumper, and before the cut out of the run (STYLE §5)
    const bumperVeil = cfg.bumper ? $(`${cfg.id}-veil`) : null;
    const endsRun = T0 < outro.glide[1] && T0 + cfg.duration >= outro.glide[1] - 1e-6;
    let outroVeil = null;
    if (endsRun) {
      outroVeil = el("div", "pf-veil");
      day.insertBefore(outroVeil, world.nextSibling);
    }
    function veilAt(T) {
      if (bumperVeil) {
        const up = E.sio(prog(T, T0, T0 + 0.35));
        const down = E.sio(prog(T, T0 + cfg.bumper - 0.3, T0 + cfg.bumper + 0.15));
        return up * (1 - down);
      }
      if (outroVeil) return 0.92 * E.p2io(prog(T, outro.veil[0], outro.veil[1]));
      return 0;
    }

    const grain = $(`${cfg.id}-grain`);
    const gctx = grain.getContext("2d");
    const patterns = grainTiles().map((canvas) => gctx.createPattern(canvas, "repeat"));

    // the night insert (plan.mjs ACCENTS kind "night", review v3 item 9): on the slot's cut the lights go out (Gabii
    // navy and its glows over the field, every earlier window off), its word lands in night ink over the lit window,
    // and the day comes back through a focus pull that is sharp again two frames before the cut (STYLE §1, §5)
    const nightSlot = cfg.run.slots.find(
      (slot) => slot.accent?.kind === "night" && cfg.slots.some((own) => own.id === slot.id),
    );
    let night = null;
    if (nightSlot) {
      const layer = el("div", "pf-night");
      el("div", "pf-night-glow", layer);
      day.insertBefore(layer, world);
      const home = wins.find((win) => win.slot === nightSlot && !win.el.dataset.ghost);
      night = {
        a: nightSlot.accent,
        layer,
        lit: el("div", "pf-lit", home.el),
        kw: $(`${nightSlot.id}-kw`).firstElementChild,
        tag: cfg.sim ? $(`${cfg.id}-tag-sim`) : null,
      };
    }
    const mix = (from, to, u) => from.map((v, i) => Math.round(lerp(v, to[i], u)));
    function nightAt(T) {
      if (!night || T < night.a.at) return 0;
      return 1 - E.sio(prog(T, night.a.fade[0], night.a.fade[1]));
    }
    function pullAt(T) {
      if (!night) return 0;
      const [p0, p1] = night.a.pull;
      if (T < p0 || T >= p1) return 0;
      return T < night.a.peak
        ? 16 * E.p2o(prog(T, p0, night.a.peak))
        : 16 * (1 - E.p2o(prog(T, night.a.peak, p1)));
    }
    function drawNight(n) {
      night.layer.style.opacity = n.toFixed(3);
      night.lit.style.opacity = n.toFixed(3);
      grain.style.opacity = (0.2 + 0.14 * n).toFixed(3);
      // the word in night ink, back to day ink as the night lifts under the focus pull
      night.kw.style.color = `rgb(${mix([11, 18, 32], [244, 246, 250], n).join(" ")})`;
      // the honesty tag: navy at 72% by night, white at 90% by day (STYLE §7)
      if (night.tag) {
        const [r, g, b] = mix([255, 255, 255], [16, 23, 42], n);
        night.tag.style.background = `rgb(${r} ${g} ${b} / ${lerp(0.9, 0.72, n).toFixed(3)})`;
        night.tag.style.color = `rgb(${mix([58, 68, 86], [195, 201, 214], n).join(" ")})`;
        night.tag.style.borderColor = `rgb(${mix([126, 136, 152], [137, 150, 180], n).join(" ")})`;
      }
    }

    function draw(t) {
      const T = T0 + t;
      const c = cameraAt(keys, T);
      const cp = cameraAt(keys, T - 1 / 30);
      for (const L of lights) {
        const px = wrap(L.x - c.x * L.k + L.dx * Math.sin(TAU * L.f * T), -L.w - 200, 1920 + L.w + 400);
        const py = L.y - c.y * L.k + L.dy * Math.cos(TAU * L.f * 0.8 * T);
        L.el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
      }
      const dx = wrap(-640 - c.x * 0.3 + 26 * Math.sin(TAU * 0.09 * T), -6400, 6400);
      const dy = -360 - c.y * 0.2 + 14 * Math.sin(TAU * 0.07 * T + 1);
      dapple.style.backgroundPosition = `${dx.toFixed(1)}px ${dy.toFixed(1)}px`;

      const vx = Math.abs(c.x - cp.x) * c.s;
      const vy = Math.abs(c.y - cp.y) * c.s;
      const bx = Math.min(10, vx * 0.2);
      const by = Math.min(6, vy * 0.2);
      if (bx > 0.6 || by > 0.6) {
        mblur.setAttribute("stdDeviation", `${bx.toFixed(2)} ${by.toFixed(2)}`);
        world.style.filter = `url(#${cfg.id}-mblur)`;
      } else world.style.filter = "none";

      const veil = veilAt(T);
      if (bumperVeil) bumperVeil.style.opacity = veil.toFixed(3);
      if (outroVeil) outroVeil.style.opacity = veil.toFixed(3);
      const veilBlur = 18 * clamp01(veil / 0.92);
      const focusAmt = clamp01((c.s - 0.62) / 0.3);
      const nightAmt = nightAt(T);
      if (night) drawNight(nightAmt);
      const pull = pullAt(T);
      const dark = night && T >= night.a.at && T < night.a.fade[1];

      for (const { el: node, slot } of wins) {
        const from = slot.glideIn[0];
        const to = slot.glideOut[1];
        // the night insert's cut: only its own window stays lit
        if (
          T < from - 1e-6 ||
          T > to + 1e-6 ||
          (dark && slot !== nightSlot && slot.start < nightSlot.start)
        ) {
          node.style.opacity = "0";
          continue;
        }
        // windows come in and leave with the camera; one still at the frame's edge as its glide starts or ends
        // fades with the move, so none pops in or lingers there (STYLE §4); the reel's first window fades in with
        // its focus pull, since the architecture ends on the empty field
        const fadeIn = slot.first
          ? E.sio(prog(T, slot.start, slot.start + 0.5))
          : E.sio(prog(T, from, from + 0.35));
        // the run's last window goes with the veil, so the field is empty under it at the cut
        const fadeOut = slot.last
          ? 1 - E.sio(prog(T, outro.veil[0], outro.veil[1]))
          : 1 - E.sio(prog(T, to - 0.35, to));
        const geo = cfg.windows[slot.kind];
        const sx = 960 + (slot.x - c.x) * c.s;
        const sy = 540 + (slot.y - c.y) * c.s;
        const sc = c.s;
        const bob = 5 * Math.sin((TAU * T) / 5.6 + slot.ph);
        const ry = 4.5 * Math.sin((TAU * T) / 8 + slot.ph);
        const rot = slot.kind === "phone" ? 0.6 : -0.6;
        // depth of field: none within 220 px of the centre, up to 10 px, less when the camera is pulled back
        const edge = Math.max(Math.abs(sx - 960) - (geo.w * sc) / 2, Math.abs(sy - 540) - (geo.h * sc) / 2);
        let blur = clamp01((edge - 220) / 480) * 10 * focusAmt + veilBlur + pull;
        // the reel opens by a focus pull on its first window (blur 14 -> 0, 0.75 s)
        if (slot.first) blur += 14 * (1 - E.eo(prog(T, slot.start + 0.05, slot.start + 0.8)));
        node.style.opacity = (fadeIn * fadeOut).toFixed(3);
        node.style.filter = blur > 0.15 ? `blur(${blur.toFixed(2)}px)` : "none";
        node.style.transform = `translate(${sx.toFixed(2)}px, ${sy.toFixed(2)}px) scale(${sc.toFixed(4)}) perspective(2200px) rotateY(${ry.toFixed(2)}deg) rotateX(2deg) rotate(${rot}deg) translateY(${bob.toFixed(2)}px)`;
      }
      for (const drawer of drawers) drawer(T);

      const frame = Math.round(T * 30);
      const r = mulberry32(frame * 7919 + 13);
      const ox = Math.floor(r() * 256);
      const oy = Math.floor(r() * 256);
      gctx.setTransform(1, 0, 0, 1, -ox, -oy);
      gctx.fillStyle = patterns[frame % 4];
      gctx.fillRect(ox, oy, 960, 540);
    }
    const clock = { t: 0 };
    tl.to(clock, { t: cfg.duration, duration: cfg.duration, ease: "none", onUpdate: () => draw(clock.t) }, 0);

    // the deep dive's bumper: one end line over the veil, before the camera arrives at its first window
    if (cfg.bumper) {
      const words = `#${cfg.id}-bumper .w`;
      tl.fromTo(
        words,
        { opacity: 0, y: 46, filter: "blur(14px)" },
        { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.7, ease: "expo.out", stagger: 0.09 },
        0.25,
      );
      tl.to(
        words,
        { opacity: 0, y: -26, filter: "blur(10px)", duration: 0.3, ease: "power2.in", stagger: 0.035 },
        cfg.bumper - 0.4,
      );
    }
    // one keyword per slot at the anchor: a mask wipe up as its window arrives (0.75 s expo.out), out 0.32 s
    // power3.in as the camera leaves (STYLE §2)
    for (const own of cfg.slots) {
      const slot = runSlots.get(own.id);
      const kw = $(`${own.id}-kw`).firstElementChild;
      const kwAt = Math.max(0, slot.kwIn - T0);
      tl.fromTo(kw, { yPercent: 108 }, { yPercent: 0, duration: 0.75, ease: "expo.out" }, kwAt);
      // the wipe's first and last frames are faded, so no lone glyph tip or period shows at the mask's edge
      // (review v3 item 4)
      tl.fromTo(kw, { opacity: 0 }, { opacity: 1, duration: 0.16, ease: "power1.out" }, kwAt);
      // the wipe out finishes two frames before the composition's cut (the next beat does not draw this keyword),
      // so no sliver of it is cut off: 0.32 s, or a little less for a keyword held to the end of a short clip
      const outFor = Math.max(0.2, Math.min(0.32, cfg.duration - 0.08 - (slot.kwOut - T0)));
      tl.to(kw, { yPercent: -108, duration: outFor, ease: "power3.in" }, slot.kwOut - T0);
      tl.to(kw, { opacity: 0, duration: 0.12, ease: "power1.in" }, slot.kwOut - T0 + outFor - 0.12);
      // a slot's own honesty label holds while its window can be read
      if (own.tag) {
        const tag = $(`${own.id}-tag`);
        tl.fromTo(
          tag,
          { opacity: 0, x: 14 },
          { opacity: 1, x: 0, duration: 0.4, ease: "power2.out" },
          own.start,
        );
        tl.to(tag, { opacity: 0, duration: 0.1, ease: "power2.in" }, own.start + own.duration - 0.1);
      }
    }
    // the sandbox tag: on from the first frame a PayPal value can show until none is legible (STYLE §7)
    if (cfg.sim) {
      const tag = `#${cfg.id}-tag-sim`;
      if (cfg.sim.continuesIn) tl.fromTo(tag, { opacity: 1 }, { opacity: 1, duration: 0.01 }, cfg.sim.from);
      else
        tl.fromTo(
          tag,
          { opacity: 0, x: 14 },
          { opacity: 1, x: 0, duration: 0.4, ease: "power2.out" },
          cfg.sim.from,
        );
      // at the end of the run it goes with the last window, once the veil is at 92% (STYLE §7)
      const off = endsRun ? Math.min(cfg.sim.to - 0.1, outro.veil[1] - T0) : cfg.sim.to - 0.1;
      if (!cfg.sim.continuesOut) tl.to(tag, { opacity: 0, duration: 0.1, ease: "power2.in" }, off);
    }
    draw(0);
    return tl;
  }
  return { build, cameraAt };
})();
