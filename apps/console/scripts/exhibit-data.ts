import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Public, committed evidence only. This build step never reads environment files or model caches. */
export function exhibitDefines(): Record<"__FS_EXHIBIT_REPORT__" | "__FS_EXHIBIT_MEDIA__", string> {
  const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
  const source = read("packages/eval/report/R1.json");
  const manifest = read("media/manifest.json");
  const report = {
    recordings: source.recordings.map((entry: Record<string, unknown>) => ({
      cache_key: entry.cache_key,
      purpose: entry.purpose,
      recorded_at: entry.recorded_at,
      provenance: entry.provenance,
    })),
    cases: source.cases.map((entry: Record<string, unknown>) => ({
      id: entry.id,
      error: entry.error,
      call_keys: entry.call_keys,
      rows: entry.rows,
    })),
  };
  const media = {
    assets: Object.fromEntries(
      Object.entries(
        manifest.assets as Record<string, { kind: string; title: string; display: { file: string } }>,
      ).map(([id, asset]) => [
        id,
        {
          kind: asset.kind,
          title: asset.title,
          display: asset.display,
        },
      ]),
    ),
    compositions: Object.fromEntries(
      Object.entries(
        manifest.compositions as Record<
          string,
          { fixture: string; label: string; image: { file: string; width: number; height: number } }
        >,
      ).map(([id, composition]) => {
        const fixture = read(`media/${composition.fixture}`);
        return [
          id,
          {
            label: composition.label,
            image: composition.image,
            slips: fixture.slips.map((slip: Record<string, unknown>) => ({
              serial: slip.serial,
              rect: slip.rect,
              fields: slip.fields,
            })),
          },
        ];
      }),
    ),
  };
  return { __FS_EXHIBIT_REPORT__: JSON.stringify(report), __FS_EXHIBIT_MEDIA__: JSON.stringify(media) };
}

interface PreviewResponse {
  setHeader(key: string, value: string): unknown;
  end(body: Buffer): unknown;
}

/** Mock dev/preview only: the same committed displays as the exhibit, never the rest of media/. */
export function previewMediaHandler() {
  const media = JSON.parse(exhibitDefines().__FS_EXHIBIT_MEDIA__);
  const displays = [
    ...Object.values(media.assets as Record<string, { display: { file: string } }>).map(
      (asset) => asset.display.file,
    ),
    ...Object.values(media.compositions as Record<string, { image: { file: string } }>).map(
      (photo) => photo.image.file,
    ),
  ];
  const allowed = new Set(
    displays.filter((file) => /^(?:photos\/[A-L]|slips\/spike-0\d{3}(?:-(?:pink|white))?)\.webp$/.test(file)),
  );
  return (req: { url?: string }, res: PreviewResponse, next: () => void) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!pathname.startsWith("/media/")) return next();
    const file = pathname.slice("/media/".length);
    if (!allowed.has(file)) return next();
    res.setHeader("content-type", "image/webp");
    res.setHeader("cache-control", "no-store");
    res.end(readFileSync(resolve(root, "media", file)));
  };
}

export function previewMedia(): Plugin {
  return {
    name: "fs-preview-exhibit-media",
    configureServer(server) {
      server.middlewares.use(previewMediaHandler());
    },
    configurePreviewServer(server) {
      server.middlewares.use(previewMediaHandler());
    },
  };
}
