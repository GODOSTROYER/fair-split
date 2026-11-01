// The typed call for IC-11 statement audio (ADR-0011): which voice reads each spoken sentence of a member's
// statement, its synthetic Gemini clip or the device's own voice, always labelled (I8).
//
//   import { createApiClient, mediaRoutes } from "@fairsplit/api-client";
//   const audio = await mediaRoutes(createApiClient({ token: memberLink })).statementAudio({
//     params: { lineId },
//     query: { lang: "ceb" },
//   });
//   // { lineId, memberNo, lang, source, label, deviceLabel,
//   //   sentences: [{ slot, variant, mentions, textSha256, clip }] }  // one per spoken sentence, in reading order
//
// The schemas are `@fairsplit/contracts`' own, which fs-api's route uses too; apps/api's media-client test compares
// this table with the route the server mounts (method, path, auth class, statuses and both schemas as JSON Schema).
import { type Lang, StatementAudio, StatementAudioQuery } from "@fairsplit/contracts";
import type { ApiClient, CallOptions } from "./client.js";
import type { RouteSpec } from "./routes.js";

export {
  AUDIO_CLIP_URL_RE,
  AUDIO_SLOTS,
  type AudioOffset,
  type AudioSlot,
  DEVICE_VOICE_LABELS,
  StatementAudio,
  type StatementAudioClip,
  StatementAudioQuery,
  type StatementAudioSentence,
  SYNTHETIC_VOICE_LABELS,
} from "@fairsplit/contracts";

/** The media folder's JSON route outside IC-01, keyed by the server's route name. */
export const MEDIA_ROUTES = {
  statementAudio: {
    method: "GET",
    path: "/v1/media/audio/:lineId",
    auth: "public",
    request: StatementAudioQuery,
    response: StatementAudio,
    success: [200],
  },
} as const satisfies Record<string, RouteSpec>;

export interface MediaRouteMethods {
  /** The statement's readers only: its member link, or an acting credential in its workspace. */
  statementAudio(
    args: { params: { lineId: string }; query?: { lang?: Lang } } & CallOptions,
  ): Promise<StatementAudio>;
}

/** The media routes over a client (its token, cookies, errors and rail handling); answers parse with the contract. */
export function mediaRoutes(api: ApiClient): MediaRouteMethods {
  return {
    statementAudio: ({ params, query, ...options }) => {
      const route = MEDIA_ROUTES.statementAudio;
      return api.request({
        ...options,
        name: "statementAudio",
        method: route.method,
        path: route.path,
        params,
        ...(query?.lang ? { query: { lang: query.lang } } : {}),
        schema: route.response,
      });
    },
  };
}
