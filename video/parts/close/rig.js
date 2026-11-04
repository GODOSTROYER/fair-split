// The close's one camera over one day field (video/proto/STYLE.md §1, §4, §5, §10), shared by the three
// compositions. `node build.mjs` copies this file into each composition between the rig markers; edit it here.
// Close time `tc` runs 0-32 s (film 143-175); every pixel is computed from it alone (seeded noise only), so any
// frame renders on its own and the three compositions meet without a seam at 11 s and 21 s.
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

  // The camera, in close time. Stations sit on one line in world space; glides (sine.inOut) carry a zoom-out dip
  // at mid-move and keep the centre's travel at or under 36 px a frame; holds never stop dead (a slow push).
  // `log` interpolates the scale in log space (an even push-in); `sf` lets the scale finish within that fraction of
  // the move (a pull-out that clears the zoom before the glide gathers speed).
  const CAM = [
    { t: 0, x: 0, y: 0, s: 1 },
    { t: 2.35, x: 6, y: 0, s: 1.018 }, // 5,000+ automated tests
    { t: 4.4, x: 2000, y: 0, s: 1, dip: 0.3 }, // glide
    { t: 5.45, x: 2006, y: 0, s: 1.012 }, // 3 kill switches
    { t: 7.5, x: 4000, y: 0, s: 1, dip: 0.3 }, // glide to the handwritten weigh-slip
    { t: 7.95, x: 4003, y: 0, s: 1.006 }, // "handwritten." lands beside the whole slip
    { t: 9.6, x: 4343, y: 42.8, s: 2.5, log: true }, // push in about 2.5x on the Net row: 38.45 and its box
    { t: 10.45, x: 4344.5, y: 43.2, s: 2.54, log: true }, // hold on the hand's box
    // the limits follow the recorded voice (ADR-0018): four objects in ten seconds, "generated." merged into
    // "synthetic." (review v4 item 3), the people and the slip images side by side on one station
    { t: 12.45, x: 5444, y: -10, s: 1, log: true, sf: 0.6, dip: 0.15 }, // pull out (scale first), glide: simulated.
    { t: 15.0, x: 5450, y: -10, s: 1.012 }, // "...simulated sandbox; no real farmer was paid."
    { t: 16.3, x: 6693, y: -10, s: 1, dip: 0.3 }, // synthetic.: the 64 dots and the slip images
    { t: 17.7, x: 6697, y: -10, s: 1.008 },
    { t: 18.5, x: 6993, y: 40, s: 1.03 }, // replayed.: a short push to the slips as the reading lifts out of them
    { t: 19.0, x: 6996, y: 40, s: 1.032 },
    { t: 20.3, x: 8237, y: -10, s: 1, dip: 0.3 }, // synthesized.: the statement's voice
    { t: 21.0, x: 8241, y: -10, s: 1.006 },
    { t: 23.05, x: 10137, y: 0, s: 1, dip: 0.3 }, // glide into the overview: the trace, the end line, the name
    { t: 32.0, x: 10145, y: 0, s: 1.025 },
  ];
  function camAt(tc) {
    if (tc <= CAM[0].t) return CAM[0];
    for (let i = 1; i < CAM.length; i++) {
      const a = CAM[i - 1];
      const b = CAM[i];
      if (tc <= b.t) {
        const u = (tc - a.t) / (b.t - a.t);
        const e = E.sio(u);
        const es = b.sf ? E.sio(Math.min(1, u / b.sf)) : e;
        const dip = b.dip ? 1 - b.dip * Math.sin(Math.PI * e) : 1;
        const s = b.log ? Math.exp(lerp(Math.log(a.s), Math.log(b.s), es)) : lerp(a.s, b.s, es);
        return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), s: s * dip };
      }
    }
    return CAM[CAM.length - 1];
  }

  // The handwritten weigh-slip's focus: the camera pushes in on its Net row and the rest of the slip blurs, greys
  // and fades into the field, so the boxed 38.45 is the one readable thing on it (STYLE §2). Its edges dissolve
  // first (by 8.55 s, before the push lifts them into the keyword's box), then the blur follows the push.
  const slipFocus = (tc) => E.p2io(prog(tc, 7.75, 9.35));
  const slipEdges = (tc) => E.p2io(prog(tc, 7.75, 8.55));

  // The world: one line of objects in the order they are visited. `vis` [in0, in1(, out0, out1)] (close time) fades
  // an object in and out with the move, so none lingers at an edge (STYLE §4). `focus` blurs, greys and fades the
  // object's `.fx-base` image and keeps a sharp `.fx-sharp` copy inside a soft ellipse [cx, cy, rx, ry, inner %]
  // (object px): small text is blurred out of reading, the one figure that matters stays sharp.
  const WORLD = {
    tests: { x: 0, y: -20, w: 1600, h: 400, sc: 1 },
    kill: { x: 2000, y: -20, w: 1600, h: 400, sc: 1 },
    slip: {
      x: 4440,
      y: 92,
      w: 600,
      h: 732,
      sc: 0.82,
      A: 5,
      ry: 4,
      rx: 1.5,
      rot: -1.2,
      ph: 0.4,
      vis: [0, 0, 11.2, 11.55],
      focus: {
        f: slipFocus,
        vf: slipEdges,
        blur: 3.6,
        fade: 0.6,
        keep: 0.3,
        sat: 0.5,
        sharp: [289, 364.5, 98, 58, 42],
        vig: [300, 388, 430, 340],
      },
    },
    // simulated.: the payout, the peso card's "Paid US$64.45" at 36 px and more (the rest of the sum blurred)
    peso: {
      x: 5484,
      y: 110,
      w: 692,
      h: 192,
      sc: 1.75,
      A: 5,
      ry: 4,
      rx: 2,
      rot: 0.6,
      ph: 1.7,
      vis: [11.0, 11.35, 15.1, 15.45],
      focus: { blur: 7, fade: 0.35, sat: 1, sharp: [502, 62, 112, 56, 62] },
    },
    // synthetic.: the co-op's 64 members, the opening's dots gathered once more into a ring, beside the slip images
    dots: { x: 6373, y: 90, w: 560, h: 560, sc: 1, ph: 2.9, vis: [15.0, 15.0, 17.8, 18.3] },
    // synthetic.: three slip images, made in code; replayed.: the reading lifts out of the front one
    fan: {
      x: 7033,
      y: 100,
      w: 820,
      h: 640,
      sc: 0.8,
      A: 5,
      ry: 4,
      rx: 1.5,
      rot: 0,
      ph: 2.3,
      vis: [15.0, 15.0, 19.9, 20.3],
    },
    read: {
      x: 6993,
      y: 250,
      w: 960,
      h: 200,
      sc: 1.1,
      A: 4,
      ry: 3,
      rx: 1.5,
      rot: -0.5,
      ph: 0.9,
      vis: [17.6, 17.6, 19.9, 20.3],
    },
    // synthesized.: the member's statement, said aloud; the glide into the overview carries it off the frame
    wave: { x: 8407, y: 110, w: 1000, h: 280, sc: 1, vis: [19.0, 19.4] },
    // the overview: slip -> phone on one gentle line, in the order the data flows (STYLE §4); the slip is blurred
    // out of reading and only her US$64.45 stays sharp on the phone
    oslip: {
      x: 9837,
      y: 20,
      w: 600,
      h: 732,
      sc: 0.66,
      A: 5,
      ry: 4,
      rx: 1.5,
      rot: -1.2,
      ph: 0.2,
      focus: { blur: 4, fade: 0.08, sat: 0.5 },
    },
    phone: {
      x: 10457,
      y: -5,
      w: 355,
      h: 822.5,
      sc: 0.78,
      A: 6,
      ry: -6,
      rx: 2,
      rot: 0,
      ph: 3.1,
      focus: { blur: 4.6, fade: 0.06, sat: 1, sharp: [138, 451.5, 132, 54, 62] },
    },
  };

  // The statement's voice: an ink wave out of a play disc, grown from a flat line as the keyword lands, travelling
  // outwards (≤ 1.2 Hz at any point). Shared so the limits and the end draw the same pixels at 21 s.
  function wavePaths(tc) {
    const T = FILM0 + tc;
    const grow = E.p2o(prog(tc, 19.4, 20.25));
    const main = [];
    const echo = [];
    for (let i = 0; i <= 180; i++) {
      const u = i / 180;
      const x = 150 + 820 * u;
      const taper = Math.sin(Math.PI * Math.min(1, u * 1.08)) ** 0.9;
      const syll = 0.32 + 0.68 * Math.abs(Math.sin(Math.PI * (4.6 * u - 1.05 * T))) ** 1.6;
      const a = 92 * grow * taper * syll;
      main.push(`${x.toFixed(1)},${(140 + a * Math.sin(TAU * 8.5 * u - 6.9 * T)).toFixed(1)}`);
      echo.push(`${x.toFixed(1)},${(140 + 0.62 * a * Math.sin(TAU * 8.5 * u - 6.9 * T - 1.3)).toFixed(1)}`);
    }
    return { main: `M${main.join("L")}`, echo: `M${echo.join("L")}` };
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

  const ellipse = (cx, cy, rx, ry, inner) =>
    `radial-gradient(${rx}px ${ry}px at ${cx}px ${cy}px, #000 ${inner}%, transparent 100%)`;
  function setMask(el, value) {
    el.style.maskImage = value;
    el.style.webkitMaskImage = value;
    el.style.maskRepeat = "no-repeat";
    el.style.webkitMaskRepeat = "no-repeat";
  }

  /**
   * cfg.id: the id prefix; cfg.t0: the composition's start in close time; cfg.keys: the WORLD objects this
   * composition draws (its own and its neighbours' at the joints), each an element `${id}-${key}`.
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
    for (const key of cfg.keys) {
      const o = { A: 0, ry: 0, rx: 0, rot: 0, ph: 0, ...WORLD[key], key, el: $(key) };
      if (o.focus) {
        o.fx = {
          base: o.el.querySelector(".fx-base"),
          sharp: o.el.querySelector(".fx-sharp"),
          shadow: o.el.querySelector(".fx-shadow"),
          key: "",
        };
        if (o.fx.sharp) {
          setMask(o.fx.sharp, ellipse(...o.focus.sharp));
          o.fx.sharp.style.filter = `saturate(${o.focus.sat})`;
        }
      }
      objs[key] = o;
    }

    function focus(o, tc) {
      const F = o.focus;
      const f = F.f ? F.f(tc) : 1;
      const v = F.vf ? F.vf(tc) : f;
      const key = `${f.toFixed(3)} ${v.toFixed(3)}`;
      if (o.fx.key === key) return;
      o.fx.key = key;
      o.fx.base.style.filter = `blur(${(F.blur * f).toFixed(2)}px) saturate(${F.sat})`;
      o.fx.base.style.opacity = (1 - F.fade * f).toFixed(3);
      // the vignette closes from beyond the corners to its ellipse, dissolving the paper's edges into the field
      if (F.vig) {
        const [cx, cy, rx, ry] = F.vig;
        const w = (1 - v) ** 2;
        if (v > 0.001)
          setMask(o.fx.base, ellipse(cx, cy, (rx + 1800 * w).toFixed(1), (ry + 1800 * w).toFixed(1), 34));
        else setMask(o.fx.base, "none");
      }
      // `keep` fades the sharp copy a little with the base, so the pool of focus keeps the paper's tone
      if (o.fx.sharp)
        o.fx.sharp.style.opacity = f > 0.001 || v > 0.001 ? (1 - (F.keep || 0) * f).toFixed(3) : "0";
      if (o.fx.shadow) o.fx.shadow.style.opacity = (1 - (F.vig ? v : f)).toFixed(3);
    }

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
      const vis = o.vis
        ? Math.min(prog(tc, o.vis[0], o.vis[1]), o.vis.length > 2 ? 1 - prog(tc, o.vis[2], o.vis[3]) : 1)
        : 1;
      const live = inFrame && vis > 0.002;
      // windows that have left the frame are switched off, so none lingers at an edge (STYLE §4)
      o.el.style.opacity = live ? vis.toFixed(3) : "0";
      if (!live) return;
      const st = o.st;
      o.el.style.transform = `translate(${sx.toFixed(2)}px, ${sy.toFixed(2)}px) scale(${S.toFixed(4)}) perspective(2200px) rotateY(${st.ry.toFixed(2)}deg) rotateX(${st.rx.toFixed(2)}deg) rotate(${st.rot.toFixed(2)}deg) translateY(${st.bob.toFixed(2)}px)`;
      if (o.fx) focus(o, tc);
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
      // the leaf shadows' parallax is slow enough that their 3200 px sheet still covers the frame at the end of
      // the 11,100 px world line (zero at 143 s, so the joint with the run is unchanged)
      const dx = -640 - cx * 0.3 + 26 * Math.sin(TAU * 0.09 * T) - c.x * 0.045;
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

  return { create, camAt, WORLD, wavePaths, mulberry32, E, prog, lerp, clamp01, bez, TAU, FILM0 };
})();
