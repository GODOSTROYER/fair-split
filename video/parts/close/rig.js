// The close's one camera over one day field (video/proto/STYLE.md §1, §4, §5, §10), shared by the three
// compositions. `node build.mjs` copies this file into each composition between the rig markers; edit it here.
// Close time `tc` runs 0-32 s (film 143-175); every pixel is computed from it alone (seeded noise only), so any
// frame renders on its own and the three compositions meet without a seam at 11 s and 24 s.
// biome-ignore lint/correctness/noUnusedVariables: each composition's script uses its copy
const CloseRig = (() => {
  const gsap = window.gsap;
  const PE = (name) => gsap.parseEase(name);
  const E = {
    p2o: PE("power2.out"),
    p2i: PE("power2.in"),
    p2io: PE("power2.inOut"),
    p3o: PE("power3.out"),
    eo: PE("expo.out"),
    sio: PE("sine.inOut"),
  };
  const TAU = 2 * Math.PI;
  const FILM0 = 143;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const prog = (t, a, b) => (b <= a ? (t >= a ? 1 : 0) : clamp01((t - a) / (b - a)));
  const lerp = (a, b, u) => a + (b - a) * u;
  const bez = (p0, p1, p2, p3, u) => {
    const v = 1 - u;
    return {
      x: v * v * v * p0.x + 3 * v * v * u * p1.x + 3 * v * u * u * p2.x + u * u * u * p3.x,
      y: v * v * v * p0.y + 3 * v * v * u * p1.y + 3 * v * u * u * p2.y + u * u * u * p3.y,
    };
  };
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

  // The camera, in close time. Stations sit on one line in world space (2000 px apart); glides take 2.05 s with a
  // 0.3 zoom-out dip at mid-move; holds never stop dead (a slow push of at most 2.5%).
  const CAM = [
    { t: 0, x: 0, y: 0, s: 1 },
    { t: 2.35, x: 6, y: 0, s: 1.018 }, // 5,000+ automated tests
    { t: 4.4, x: 2000, y: 0, s: 1, dip: 0.3 }, // glide
    { t: 5.45, x: 2006, y: 0, s: 1.012 }, // 3 kill switches
    { t: 7.5, x: 4000, y: 0, s: 1, dip: 0.3 }, // glide
    { t: 10.65, x: 4012, y: 0, s: 1.02 }, // the handwritten weigh-slip
    { t: 12.7, x: 6000, y: 0, s: 1, dip: 0.3 }, // glide on into the open field (the limits)
    { t: 24.0, x: 6060, y: -8, s: 1.025 }, // the limits, one at a time: a slow drift
    { t: 26.05, x: 8000, y: 0, s: 1, dip: 0.3 }, // glide into the overview
    { t: 32.0, x: 8008, y: 0, s: 1.025 }, // the trace, the end line, the name
  ];
  function camAt(tc) {
    if (tc <= CAM[0].t) return CAM[0];
    for (let i = 1; i < CAM.length; i++) {
      const a = CAM[i - 1];
      const b = CAM[i];
      if (tc <= b.t) {
        const u = (tc - a.t) / (b.t - a.t);
        const e = E.sio(u);
        const dip = b.dip ? 1 - b.dip * Math.sin(Math.PI * e) : 1;
        return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), s: lerp(a.s, b.s, e) * dip };
      }
    }
    return CAM[CAM.length - 1];
  }

  // grain: four seeded grey tiles, one per frame at a seeded offset, as in film-slots.js (STYLE §10)
  function grainPatterns(context) {
    const rng = mulberry32(1104);
    return [0, 1, 2, 3].map(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const tile = canvas.getContext("2d");
      const image = tile.createImageData(256, 256);
      for (let i = 0; i < 256 * 256; i++) {
        const v = Math.round((255 * (rng() + rng())) / 2);
        image.data[4 * i] = v;
        image.data[4 * i + 1] = v;
        image.data[4 * i + 2] = v;
        image.data[4 * i + 3] = 255;
      }
      tile.putImageData(image, 0, 0);
      return context.createPattern(canvas, "repeat");
    });
  }

  /**
   * cfg.id: the id prefix; cfg.t0: the composition's start in close time; cfg.objects: world objects
   * { key, x, y, w, h, sc, A, ry, rx, rot, ph, on: [from, to] (close time), noDof }.
   */
  function create(cfg) {
    const $ = (key) => document.getElementById(`${cfg.id}-${key}`);
    // the field: the same light shapes, wash, leaf shadows and drift as the capture-slot beats (film-slots.js),
    // so the cut in from 142.9 s is invisible; the camera adds a gentle parallax on top
    const lights = [
      { el: $("lightA"), x: -700, y: -620, k: 0.5, dx: 60, dy: 40, f: 0.05, p: 0.03 },
      { el: $("lightC"), x: 900, y: -560, k: 0.8, dx: -50, dy: 50, f: 0.04, p: 0.045 },
      { el: $("lightB"), x: 160, y: 120, k: 1.1, dx: 70, dy: -40, f: 0.035, p: 0.06 },
    ];
    const dapple = $("dapple");
    const world = $("worldMb");
    const mblur = $("mblurG");
    const grain = $("grain");
    const gctx = grain.getContext("2d");
    const patterns = grainPatterns(gctx);
    const objs = {};
    for (const o of cfg.objects) objs[o.key] = { A: 0, ry: 0, rx: 0, rot: 0, ph: 0, ...o, el: $(o.key) };

    function place(o, tc, T, c) {
      const S = o.sc * c.s;
      const sx = 960 + (o.x - c.x) * c.s;
      const sy = 540 + (o.y - c.y) * c.s;
      o.st = {
        sx,
        sy,
        S,
        bob: o.A * Math.sin((TAU * T) / 5.6 + o.ph),
        ry: o.ry * Math.sin((TAU * T) / 8 + o.ph),
        rx: o.rx,
        rot: o.rot,
      };
      const halfW = (o.w * S) / 2;
      const halfH = (o.h * S) / 2;
      const inFrame = sx + halfW > -40 && sx - halfW < 1960 && sy + halfH > -40 && sy - halfH < 1120;
      const live = inFrame && (!o.on || (tc >= o.on[0] && tc <= o.on[1]));
      // windows that have left the frame are switched off, so none lingers at an edge (STYLE §4)
      o.el.style.opacity = live ? "1" : "0";
      if (!live) return;
      const st = o.st;
      o.el.style.transform = `translate(${sx.toFixed(2)}px, ${sy.toFixed(2)}px) scale(${S.toFixed(4)}) perspective(2200px) rotateY(${st.ry.toFixed(2)}deg) rotateX(${st.rx.toFixed(2)}deg) rotate(${st.rot.toFixed(2)}deg) translateY(${st.bob.toFixed(2)}px)`;
      if (o.noDof) return;
      // depth of field: sharp within 220 px of the centre, up to 10 px further out, less when pulled back
      const edge = Math.max(Math.abs(sx - 960) - halfW, Math.abs(sy - 540) - halfH);
      const blur = clamp01((edge - 220) / 480) * 10 * clamp01((c.s - 0.62) / 0.3);
      o.el.style.filter = blur > 0.15 ? `blur(${blur.toFixed(2)}px)` : "none";
    }

    /** A point given in an object's own px -> screen (2D: position, scale, rotation and float). */
    function toScreen(key, px, py) {
      const o = objs[key];
      const st = o.st;
      const qx = px - o.w / 2;
      const qy = py - o.h / 2 + st.bob;
      const r = (st.rot * Math.PI) / 180;
      const cs = Math.cos(r);
      const sn = Math.sin(r);
      return { x: st.sx + st.S * (qx * cs - qy * sn), y: st.sy + st.S * (qx * sn + qy * cs) };
    }

    function draw(t) {
      const tc = cfg.t0 + t;
      const T = FILM0 + tc;
      const c = camAt(tc);
      const cp = camAt(tc - 1 / 30);
      const cx = 260 * Math.sin((TAU * T) / 96);
      const cy = 70 * Math.sin((TAU * T) / 71 + 0.6);
      for (const L of lights) {
        const px = L.x - cx * L.k + L.dx * Math.sin(TAU * L.f * T) - c.x * L.p;
        const py = L.y - cy * L.k + L.dy * Math.cos(TAU * L.f * 0.8 * T) - c.y * L.p;
        L.el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
      }
      const dx = -640 - cx * 0.3 + 26 * Math.sin(TAU * 0.09 * T) - c.x * 0.08;
      const dy = -360 - cy * 0.3 + 14 * Math.sin(TAU * 0.07 * T + 1) - c.y * 0.08;
      dapple.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      // directional motion blur keyed to the camera's speed, on a container of its own (STYLE §5)
      const bx = Math.min(10, 0.2 * Math.abs(c.x - cp.x) * c.s);
      const by = Math.min(6, 0.2 * Math.abs(c.y - cp.y) * c.s);
      if (bx > 0.6 || by > 0.6) {
        mblur.setAttribute("stdDeviation", `${bx.toFixed(2)} ${by.toFixed(2)}`);
        world.style.filter = `url(#${cfg.id}-mblur)`;
      } else world.style.filter = "none";
      for (const o of Object.values(objs)) place(o, tc, T, c);
      const frame = Math.round(T * 30);
      const r = mulberry32(frame * 7919 + 13);
      const ox = Math.floor(r() * 256);
      const oy = Math.floor(r() * 256);
      gctx.setTransform(1, 0, 0, 1, -ox, -oy);
      gctx.fillStyle = patterns[frame % 4];
      gctx.fillRect(ox, oy, 960, 540);
      if (cfg.after) cfg.after(t, tc, c);
    }

    return { draw, toScreen, objs };
  }

  return { create, E, prog, lerp, clamp01, bez, TAU };
})();
