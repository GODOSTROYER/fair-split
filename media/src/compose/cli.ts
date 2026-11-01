// Local deterministic composition only: no image model, credentials, API or network.
// corepack pnpm --filter @fairsplit/media exec tsx src/compose/cli.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MANIFEST_NOTICE, Manifest } from "../imagegen/manifest.js";
import { MEDIA_ROOT } from "../util/env.js";
import { jsonBytes } from "./drawn.js";
import { composePhoto } from "./photos.js";

const write = (file: string, bytes: Buffer) => {
  const path = join(MEDIA_ROOT, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
};
const manifest = Manifest.parse(JSON.parse(readFileSync(join(MEDIA_ROOT, "manifest.json"), "utf8")));
for (const id of "ABCDEFGHIJKL") {
  const result = await composePhoto(id, MEDIA_ROOT, { bootstrap: true });
  for (const source of result.sources) write(source.file, source.bytes);
  write(result.entry.image.file, result.bytes);
  write(result.entry.fixture, result.fixtureBytes);
  manifest.compositions[id] = result.entry;
  console.log(`${id}: four labelled synthetic slips, ${result.bytes.length} bytes`);
}
manifest.notice = MANIFEST_NOTICE;
write("manifest.json", jsonBytes(Manifest.parse(manifest)));
