import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FEEDBACK, FEEDBACK_EVENTS } from "../src/feedback-map.js";
import {
  mulberry32,
  RECIPE_NAMES,
  RECIPES,
  recipeFor,
  renderSound,
  SAMPLE_RATE,
  toWav16,
} from "../src/sound/recipes.js";

const sfxDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../assets/sfx");

describe("sound recipes", () => {
  it("mulberry32 is seeded and repeatable", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(0);
  });

  it.each(RECIPE_NAMES)("%s renders deterministically at its length and peak level", (name) => {
    const first = renderSound(name);
    const second = renderSound(name);
    expect(Buffer.from(first.buffer).equals(Buffer.from(second.buffer))).toBe(true);
    expect(first.length).toBe(Math.round((RECIPES[name].lengthMs * SAMPLE_RATE) / 1000));
    let peak = 0;
    for (const v of first) peak = Math.max(peak, Math.abs(v));
    expect(20 * Math.log10(peak)).toBeCloseTo(RECIPES[name].peakDbfs, 2);
  });

  it("encodes 16-bit mono WAVs within the 30 KB native budget", () => {
    for (const name of RECIPE_NAMES.filter((n) => RECIPES[n].native)) {
      const wav = toWav16(renderSound(name));
      expect(Buffer.from(wav.slice(0, 4)).toString("ascii")).toBe("RIFF");
      expect(wav.length).toBeLessThanOrEqual(30 * 1024);
    }
  });

  it("every feedback sound has a recipe; scale notes wrap after eight", () => {
    for (const event of FEEDBACK_EVENTS) {
      const sound = FEEDBACK[event].sound;
      if (sound) expect(RECIPE_NAMES).toContain(recipeFor(sound.name, 0));
    }
    expect(recipeFor("scale", 3)).toBe("scale-3");
    expect(recipeFor("scale", 9)).toBe("scale-1");
  });

  it("a duplicate webhook delivery is silent and carries no haptic", () => {
    expect(FEEDBACK["webhook.duplicate"]).toMatchObject({ sound: null, ios: [], android: [] });
  });

  it.runIf(existsSync(sfxDir))("the committed native WAVs match a fresh render", () => {
    for (const name of RECIPE_NAMES.filter((n) => RECIPES[n].native)) {
      const committed = readFileSync(resolve(sfxDir, `${name}.wav`));
      const fresh = Buffer.from(toWav16(renderSound(name)));
      expect(createHash("sha256").update(committed).digest("hex"), name).toBe(
        createHash("sha256").update(fresh).digest("hex"),
      );
    }
  });
});
