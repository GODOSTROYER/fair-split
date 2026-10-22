// Writes the native sound effects as committed 16-bit 48 kHz mono WAVs, rendered from the same recipes the
// web plays through Web Audio (S2 §2.10). `packages/motion/test/sound.test.ts` re-renders them and compares
// sha256, so a recipe change without a rebuild fails CI.
//
//   corepack pnpm exec tsx assets/sfx/build.ts

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RECIPE_NAMES, RECIPES, renderSound, toWav16 } from "../../packages/motion/src/sound/recipes.js";

const here = dirname(fileURLToPath(import.meta.url));

for (const name of RECIPE_NAMES) {
  if (!RECIPES[name].native) continue;
  const wav = toWav16(renderSound(name));
  writeFileSync(resolve(here, `${name}.wav`), wav);
  console.log(`${name}.wav  ${wav.length.toLocaleString("en")} B`);
}
