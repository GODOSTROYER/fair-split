// src/routes/media: owned by the PROOF slice (apps/api/SPLIT.md).
// Dynamic media (static /media files are served by the shell):
//
//   GET /media/archived/:photoId.svg          OD-4's hatched "archived photo" tile for P01–P54, with its read date
//                                             (those photos are never generated; the tile says so, with a word)
//   GET /v1/media/audio/:lineId?lang=         which voice reads each spoken sentence of a statement (IC-11,
//                                             ADR-0011): the synthetic Gemini clip whose exact words match, from
//                                             the published manifest (STATIC_MEDIA_DIR), else the device's own
//                                             voice; always labelled (I8). Same readers as the statement.
import { PhotoId, StatementAudio, StatementAudioQuery } from "@fairsplit/contracts";
import { format } from "@fairsplit/domain";
import { getPhotos } from "@fairsplit/seed";
import { problem } from "../../lib/problem.js";
import { defineRouteFolder } from "../../lib/slice.js";
import { documentRawRoute } from "../../proof/openapi.js";
import { readableStatement } from "../../statements/access.js";
import { statementView } from "../../statements/view.js";
import { staticDirs } from "../../static.js";
import { readAudioManifest, resolveStatementAudio } from "./audio.js";

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
        summary:
          "Which voice reads each sentence of a statement: its Gemini clip, or the device's voice; labelled",
        description:
          "IC-11 (ADR-0011): one entry per spoken sentence, in reading order, named by its slot, template variant and mentions so a client pairs it with its own sentence without reading words. A sentence has a clip only when a published manifest entry (STATIC_MEDIA_DIR/audio/manifest.json, apps/api/dist/media on Render) has exactly its words (`textSha256`, the SHA-256 of the spoken text), its slot, member and language, and is not a draft; otherwise `clip` is null and the device's voice reads it under `deviceLabel`.",
        request: StatementAudioQuery,
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
        // The very sentences the statement speaks (its committed variants and, on seeded runs, the seeded ones).
        const view = await statementView(ctx.deps.db, sc);
        const mediaDir = staticDirs(ctx.deps.env.static).media;
        return resolveStatementAudio({
          lineId: view.lineId,
          memberNo: view.memberNo,
          lang: view.lang,
          sentences: view.spoken.map((s, i) => ({
            slot: s.slot,
            variant: s.variant,
            text: s.text,
            mentions: s.mentions,
            placeholders: Object.keys(view.plan.sentences[i]?.facts ?? {}),
          })),
          entries: readAudioManifest(mediaDir),
          mediaDir,
        });
      },
    );
  },
});
