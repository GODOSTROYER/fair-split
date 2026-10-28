// src/routes/media: owned by the PROOF slice (apps/api/SPLIT.md).
// Dynamic media (static /media files are served by the shell):
//
//   GET /media/archived/:photoId.svg          OD-4's hatched "archived photo" tile for P01–P54, with its read date
//                                             (those photos are never generated; the tile says so, with a word)
//   GET /v1/media/audio/:lineId?lang=         which audio a statement plays: the synthetic Gemini clip from the
//                                             IC-11 manifest when there is one, else the device's own voice,
//                                             always labelled (I8). Same readers as the statement.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Lang, PhotoId } from "@fairsplit/contracts";
import { format } from "@fairsplit/domain";
import { getPhotos } from "@fairsplit/seed";
import { z } from "zod";
import { problem } from "../../lib/problem.js";
import { defineRouteFolder } from "../../lib/slice.js";
import { documentRawRoute } from "../../proof/openapi.js";
import { readableStatement } from "../../statements/access.js";
import { staticDirs } from "../../static.js";

const ARCHIVED_RE = /^(P\d{2})\.svg$/;

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** The archived-photo tile: a hatched 4:3 plate with the photo's ID and read date, in words. */
export function archivedTileSvg(photoId: string, readOn: string | null): string {
  const title = `Archived photo ${photoId}`;
  const sub = readOn
    ? `Read ${format.date(readOn, "en")}. The photo itself is not kept online.`
    : "The photo itself is not kept online.";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1200" width="1600" height="1200" role="img" aria-label="${escapeXml(`${title}. ${sub}`)}">`,
    `<title>${escapeXml(title)}</title>`,
    '<defs><pattern id="hatch" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">',
    '<line x1="0" y1="0" x2="0" y2="28" stroke="#8a8378" stroke-width="6" stroke-opacity="0.35"/></pattern></defs>',
    '<rect width="1600" height="1200" fill="#f4efe6"/>',
    '<rect width="1600" height="1200" fill="url(#hatch)"/>',
    '<rect x="360" y="470" width="880" height="260" fill="#f4efe6" stroke="#3b352d" stroke-width="3"/>',
    `<text x="800" y="585" text-anchor="middle" font-family="Mona Sans, system-ui, sans-serif" font-size="64" font-weight="600" fill="#2b2620">${escapeXml(title)}</text>`,
    `<text x="800" y="660" text-anchor="middle" font-family="Mona Sans, system-ui, sans-serif" font-size="34" fill="#4a4339">${escapeXml(sub)}</text>`,
    "</svg>",
  ].join("");
}

const AudioCue = z.strictObject({
  slot: z.string(),
  start_ms: z.int().nonnegative(),
  end_ms: z.int().nonnegative(),
  mentions: z.array(z.strictObject({ ref: z.string(), at_ms: z.int().nonnegative() })),
});

const ManifestEntry = z.object({
  member_no: z.string(),
  lang: Lang,
  file: z.string().regex(/^[A-Za-z0-9/_.-]+$/),
  duration_ms: z.int().nonnegative(),
  synthetic: z.literal(true),
  voice: z.string(),
  model: z.string(),
  cue_source: z.string().optional(),
  cues: z.array(AudioCue),
});

const DEVICE_VOICE: Readonly<Record<z.infer<typeof Lang>, string>> = {
  ceb: "Tingog sa telepono",
  fil: "Boses ng telepono",
  en: "Device voice",
};
const SYNTHETIC_VOICE: Readonly<Record<z.infer<typeof Lang>, string>> = {
  ceb: "Sintetikong tingog (Gemini TTS)",
  fil: "Sintetikong boses (Gemini TTS)",
  en: "Synthetic voice (Gemini TTS)",
};

export const StatementAudio = z.strictObject({
  lineId: z.uuid(),
  memberNo: z.string(),
  lang: Lang,
  source: z.enum(["gemini", "device"]),
  /** Always shown with the player (I8: a synthetic voice is never unlabelled). */
  label: z.string(),
  url: z.string().nullable(),
  durationMs: z.int().nonnegative().nullable(),
  cues: z.array(AudioCue),
});

/** IC-11 `media/audio/manifest.json` under the static media directory, if it is there (read per request: tiny). */
function manifestEntries(mediaDir: string): z.infer<typeof ManifestEntry>[] {
  const file = path.join(mediaDir, "audio", "manifest.json");
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const list = Array.isArray(raw) ? raw : ((raw as { entries?: unknown[] }).entries ?? []);
    return list.flatMap((e) => {
      const p = ManifestEntry.safeParse(e);
      return p.success ? [p.data] : [];
    });
  } catch {
    return [];
  }
}

export default defineRouteFolder({
  folder: "media",
  commands: {},
  routes: (r) => {
    documentRawRoute(r.app, {
      path: "/media/archived/{file}",
      operationId: "media.archivedTile",
      tag: "media",
      summary: "OD-4's hatched archived-photo tile for P01–P54, with its read date in words",
      description:
        "Those photos are never generated (the plan's OD-4); the tile says so. Immutable; drawn from the seed's photo register.",
      auth: "none",
      contentType: "image/svg+xml",
      body: { type: "string" },
      params: [
        { name: "file", schema: { type: "string", pattern: "^P\\d{2}\\.svg$", examples: ["P07.svg"] } },
      ],
      errors: [{ status: 404, codes: ["NOT_FOUND"] }],
    });
    r.app.get("/media/archived/:file", (c) => {
      const m = ARCHIVED_RE.exec(c.req.param("file") ?? "");
      const photoId = m?.[1];
      if (!photoId || !PhotoId.safeParse(photoId).success) throw problem.notFound("No such archived photo.");
      const photo = getPhotos("EARLIER").find((p) => p.photoId === photoId);
      if (!photo) throw problem.notFound("No such archived photo.");
      return c.body(archivedTileSvg(photo.photoId, photo.readOn), 200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
      });
    });

    r.route(
      {
        method: "GET",
        path: "/v1/media/audio/:lineId",
        auth: "public",
        name: "statementAudio",
        summary: "Which audio a statement plays, always labelled (Gemini clip or the device's voice)",
        request: z.strictObject({ lang: Lang.optional() }),
        response: StatementAudio,
        errors: ["UNAUTHENTICATED", "FRAME_TOKEN_EXPIRED", "FORBIDDEN"],
      },
      async (ctx) => {
        const sc = await readableStatement(
          ctx.deps,
          ctx.credential,
          ctx.credentialProblem,
          ctx.params.lineId,
          ctx.input.lang,
        );
        const lang = sc.facts.lang;
        const dirs = staticDirs(ctx.deps.env.static);
        const entry = manifestEntries(dirs.media).find(
          (e) => e.member_no === sc.facts.memberNo && e.lang === lang,
        );
        if (!entry) {
          return {
            lineId: sc.facts.lineId,
            memberNo: sc.facts.memberNo,
            lang,
            source: "device" as const,
            label: DEVICE_VOICE[lang],
            url: null,
            durationMs: null,
            cues: [],
          };
        }
        return {
          lineId: sc.facts.lineId,
          memberNo: sc.facts.memberNo,
          lang,
          source: "gemini" as const,
          label: SYNTHETIC_VOICE[lang],
          url: `/media/audio/${entry.file}`,
          durationMs: entry.duration_ms,
          cues: entry.cues,
        };
      },
    );
  },
});
