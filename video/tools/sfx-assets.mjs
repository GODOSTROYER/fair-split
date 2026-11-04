// The film's sound-effect files (video/sfx-cues.json `sounds`) into video/assets/sfx:
//  - CC0 sounds copied byte for byte from the Barty-Bart motion-graphics sound-effects kit (its sfx/ folder; every
//    one's page was checked CC0 on 5 Nov 2026). Mixkit files are never used or copied: their licence bars
//    redistribution.
//  - Fair Split's own product sounds rendered from packages/motion/src/sound/recipes.ts, the one DSP source the
//    console and the app play (MIT); the native four must match assets/sfx byte for byte.
//
//   node video/tools/sfx-assets.mjs <kit-sfx-dir>     e.g. Z:/Projects/Paypal/tools-ext/motion-graphics/skills/sound-effects/sfx
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderSound, toWav16 } from "../../packages/motion/src/sound/recipes.ts";

const video = new URL("../", import.meta.url);
const cues = JSON.parse(readFileSync(new URL("sfx-cues.json", video), "utf8"));
const kit = process.argv[2] ? resolve(process.argv[2]) : null;
mkdirSync(new URL("assets/sfx/", video), { recursive: true });
for (const [name, sound] of Object.entries(cues.sounds)) {
  const to = new URL(sound.file, video);
  if (sound.recipe) {
    const wav = Buffer.from(toWav16(renderSound(sound.recipe)));
    const native = new URL(`../assets/sfx/${sound.recipe}.wav`, video);
    if (existsSync(native) && !readFileSync(native).equals(wav))
      throw new Error(`${sound.recipe}: the recipe no longer renders assets/sfx/${sound.recipe}.wav`);
    writeFileSync(to, wav);
    console.log(
      `${name.padEnd(13)} rendered from recipe ${sound.recipe}${existsSync(native) ? " (= assets/sfx)" : ""}`,
    );
  } else {
    if (sound.licence !== "CC0 1.0") throw new Error(`${name}: only CC0 kit sounds may be copied`);
    if (!kit) throw new Error("usage: sfx-assets.mjs <kit-sfx-dir>");
    copyFileSync(join(kit, sound.kit), to);
    console.log(`${name.padEnd(13)} copied from kit ${sound.kit}`);
  }
}
