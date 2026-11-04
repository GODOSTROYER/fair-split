// Copies the close's shared rig (rig.js: camera, day field, windows, motion blur, grain) and its shared look
// (rig.css) into the three compositions, between their markers, so each template stays self-contained.
// Run after editing rig.js or rig.css: node build.mjs (from this folder or anywhere).
import { readFileSync, writeFileSync } from "node:fs";

const here = (name) => new URL(name, import.meta.url);
// rig.js's own lint suppression (CloseRig is unused in the file itself) is not copied: each copy uses it
const rig = readFileSync(here("rig.js"), "utf8")
  .split("\n")
  .filter((line) => !line.startsWith("// biome-ignore"))
  .join("\n")
  .trim();
const css = readFileSync(here("rig.css"), "utf8").trim();
const indent = (text, pad) =>
  text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");

for (const name of ["impressive", "limits", "end"]) {
  const file = here(`compositions/${name}.html`);
  const html = readFileSync(file, "utf8");
  const out = html
    .replace(
      /( *)\/\* style:begin[^*]*\*\/[\s\S]*?\/\* style:end \*\//,
      (_, pad) =>
        `${pad}/* style:begin (rig.css, copied by build.mjs) */\n${indent(css, pad)}\n${pad}/* style:end */`,
    )
    .replace(
      /( *)\/\/ rig:begin[^\n]*\n[\s\S]*?\/\/ rig:end/,
      (_, pad) => `${pad}// rig:begin (rig.js, copied by build.mjs)\n${indent(rig, pad)}\n${pad}// rig:end`,
    );
  if (!out.includes("rig:begin (rig.js") || !out.includes("style:begin (rig.css"))
    throw new Error(`${name}.html: rig markers missing`);
  if (out !== html) writeFileSync(file, out);
  console.log(`${name}.html ${out === html ? "up to date" : "updated"}`);
}
