// Fair Split film: the driver for every capture-slot beat (the highlight reel and the deep dive), in the motion
// language of video/proto/STYLE.md. A calm day field that drifts on the film's own clock (so it runs on across beat
// cuts), one floating window per captures.json slot, one keyword each and one honesty tag. Every pixel is computed
// from the time alone; the only noise is seeded. Each beat composition calls FairSplitSlots.build(tl, config) with
// its own paused timeline. Config comes from video/build.mjs (window geometry from plan.mjs WINDOWS).
window.FairSplitSlots = (() => {
  const gsap = window.gsap;
  const PE = (name) => gsap.parseEase(name);
  const E = { p2i: PE("power2.in"), eo: PE("expo.out"), sio: PE("sine.inOut") };
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const prog = (t, a, b) => (b <= a ? (t >= a ? 1 : 0) : clamp01((t - a) / (b - a)));
  const lerp = (a, b, u) => a + (b - a) * u;
  const TAU = 2 * Math.PI;
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

  function build(tl, cfg) {
    const $ = (id) => document.getElementById(id);
    const T0 = cfg.filmStart;
    const lights = [
      { el: $(`${cfg.id}-lightA`), x: -700, y: -620, k: 0.5, dx: 60, dy: 40, f: 0.05 },
      { el: $(`${cfg.id}-lightC`), x: 900, y: -560, k: 0.8, dx: -50, dy: 50, f: 0.04 },
      { el: $(`${cfg.id}-lightB`), x: 160, y: 120, k: 1.1, dx: 70, dy: -40, f: 0.035 },
    ];
    const dapple = $(`${cfg.id}-dapple`);
    const wins = cfg.slots.map((slot, i) => {
      const enter = slot.start + (i === 0 ? cfg.hold : 0);
      const exit = slot.start + slot.duration;
      const long = exit - enter >= 4.5;
      const kwIn = enter + 0.15;
      const kwOut = long ? enter + 2.6 : Math.max(kwIn + 0.55, exit - 0.42);
      return {
        ...slot,
        el: $(`${slot.id}-window`),
        kw: $(`${slot.id}-kw`).firstElementChild,
        tagEl: slot.tag ? $(`${slot.id}-tag`) : null,
        geo: cfg.windows[slot.kind],
        enter,
        exit,
        kwIn,
        kwOut,
        glide: long ? [kwOut + 0.15, kwOut + 1.8] : null,
        // phases differ per window so nothing floats in lockstep (STYLE §4)
        ph: 1.3 * i + 0.37 * T0,
      };
    });
    const grain = $(`${cfg.id}-grain`);
    const gctx = grain.getContext("2d");
    const patterns = grainTiles().map((canvas) => gctx.createPattern(canvas, "repeat"));

    function draw(t) {
      const T = T0 + t;
      // the field drifts on the film's clock, so it does not jump at a beat cut
      const cx = 260 * Math.sin((TAU * T) / 96);
      const cy = 70 * Math.sin((TAU * T) / 71 + 0.6);
      for (const L of lights) {
        const px = L.x - cx * L.k + L.dx * Math.sin(TAU * L.f * T);
        const py = L.y - cy * L.k + L.dy * Math.cos(TAU * L.f * 0.8 * T);
        L.el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
      }
      const dx = -640 - cx * 0.3 + 26 * Math.sin(TAU * 0.09 * T);
      const dy = -360 - cy * 0.3 + 14 * Math.sin(TAU * 0.07 * T + 1);
      dapple.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;

      for (const w of wins) {
        if (t < w.enter || t > w.exit) {
          w.el.style.opacity = "0";
          continue;
        }
        // lift in (blur 14 -> 0, 0.75 s expo.out); recede and blur out over the last 0.4 s
        const e = E.eo(prog(t, w.enter, w.enter + 0.75));
        const x = E.p2i(prog(t, w.exit - 0.4, w.exit));
        const g = w.glide ? E.sio(prog(t, w.glide[0], w.glide[1])) : 0;
        const { a, b } = w.geo;
        const push = 1 + 0.02 * prog(t, w.enter, w.exit);
        const sc = lerp(a.s, b.s, g) * push * (0.955 + 0.045 * e) * (1 - 0.03 * x);
        const sx = lerp(a.x, b.x, g);
        const sy = lerp(a.y, b.y, g) + 42 * (1 - e) - 18 * x;
        const bob = 5 * Math.sin((TAU * T) / 5.6 + w.ph);
        const ry = 4.5 * Math.sin((TAU * T) / 8 + w.ph);
        const rot = w.kind === "phone" ? 0.6 : -0.6;
        const blur = 14 * (1 - e) + 16 * x;
        w.el.style.opacity = (e * (1 - x)).toFixed(3);
        w.el.style.filter = blur > 0.15 ? `blur(${blur.toFixed(2)}px)` : "none";
        w.el.style.transform = `translate(${sx.toFixed(2)}px, ${sy.toFixed(2)}px) scale(${sc.toFixed(4)}) perspective(2200px) rotateY(${ry.toFixed(2)}deg) rotateX(2deg) rotate(${rot}deg) translateY(${bob.toFixed(2)}px)`;
      }

      const frame = Math.round(T * 30);
      const r = mulberry32(frame * 7919 + 13);
      const ox = Math.floor(r() * 256);
      const oy = Math.floor(r() * 256);
      gctx.setTransform(1, 0, 0, 1, -ox, -oy);
      gctx.fillStyle = patterns[frame % 4];
      gctx.fillRect(ox, oy, 960, 540);
      grain.style.opacity = cfg.intro === "iris" && t < 0.5 ? "0.3" : "0.2";
    }
    const clock = { t: 0 };
    tl.to(clock, { t: cfg.duration, duration: cfg.duration, ease: "none", onUpdate: () => draw(clock.t) }, 0);

    // the turn into the reel: the day field opens out of the night by an iris (STYLE §5)
    if (cfg.intro === "iris") {
      const day = `#${cfg.id}-day`;
      tl.fromTo(
        day,
        { clipPath: "circle(0px at 960px 540px)" },
        { clipPath: "circle(1250px at 960px 540px)", duration: 0.85, ease: "expo.inOut" },
        0.02,
      );
      tl.set(day, { clipPath: "none" }, 0.9);
    }
    // a part's bumper: a daylight veil and one end line, before the first window lifts in
    if (cfg.bumper) {
      const veil = `#${cfg.id}-veil`;
      const words = `#${cfg.id}-bumper .w`;
      tl.fromTo(veil, { opacity: 1 }, { opacity: 1, duration: 0.01 }, 0);
      tl.fromTo(
        words,
        { opacity: 0, y: 46, filter: "blur(14px)" },
        { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.7, ease: "expo.out", stagger: 0.09 },
        0.06,
      );
      tl.to(
        words,
        { opacity: 0, y: -26, filter: "blur(10px)", duration: 0.3, ease: "power2.in", stagger: 0.035 },
        cfg.bumper - 0.4,
      );
      tl.to(veil, { opacity: 0, duration: 0.45, ease: "sine.inOut" }, cfg.bumper - 0.3);
    }
    // one keyword per slot: a mask wipe up (0.75 s expo.out), out 0.32 s power3.in (STYLE §2)
    for (const w of wins) {
      tl.fromTo(w.kw, { yPercent: 108 }, { yPercent: 0, duration: 0.75, ease: "expo.out" }, w.kwIn);
      tl.to(w.kw, { yPercent: -108, duration: 0.32, ease: "power3.in" }, w.kwOut);
      // a slot's own honesty label holds while its window can be read
      if (w.tagEl) {
        tl.fromTo(
          w.tagEl,
          { opacity: 0, x: 14 },
          { opacity: 1, x: 0, duration: 0.4, ease: "power2.out" },
          w.enter,
        );
        tl.to(w.tagEl, { opacity: 0, duration: 0.1, ease: "power2.in" }, w.exit - 0.1);
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
          cfg.sim.from + (cfg.sim.from === 0 ? cfg.hold : 0),
        );
      if (!cfg.sim.continuesOut)
        tl.to(tag, { opacity: 0, duration: 0.1, ease: "power2.in" }, cfg.sim.to - 0.1);
    }
    draw(0);
    return tl;
  }
  return { build };
})();
