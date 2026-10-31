// The typed call for IC-11 statement audio (ADR-0011): GET /v1/media/audio/:lineId?lang=, parsed with the
// contract's StatementAudio, so a clip outside /media/audio or an unlabelled answer never reaches a player.
import { describe, expect, it } from "vitest";
import { createApiClient, type FetchLike } from "./client.js";
import { isContractError } from "./errors.js";
import { MEDIA_ROUTES, mediaRoutes, StatementAudio } from "./media.js";

const LINE = "0190f3c2-6c1e-7c3a-8d2b-1a2b3c4d5e6f";
const HASH = "596b9e42811ddd3d6788f221ff7c7ad905a4936bb007cbea1875fdc09fc7618b";
const answer = {
  lineId: LINE,
  memberNo: "M-014",
  lang: "ceb",
  source: "mixed",
  label: "Sintetikong tingog (Gemini TTS)",
  deviceLabel: "Tingog sa telepono",
  sentences: [
    {
      slot: "GREETING",
      variant: "default",
      mentions: [],
      textSha256: HASH,
      clip: {
        url: "/media/audio/M-014/ceb/s1.m4a",
        textSha256: HASH,
        label: "Sintetikong tingog (Gemini TTS)",
        slot: "GREETING",
        offsets: [],
        durationMs: 4_634,
      },
    },
    { slot: "PAY", variant: "paypal", mentions: [], textSha256: "b".repeat(64), clip: null },
  ],
};

function serving(body: unknown) {
  const seen: string[] = [];
  const fetch: FetchLike = async (input) => {
    seen.push(String(input));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { seen, media: mediaRoutes(createApiClient({ baseUrl: "http://fs.test", fetch, token: "fsm_x" })) };
}

describe("mediaRoutes.statementAudio", () => {
  it("is the route the server mounts, typed with the contract's schemas", () => {
    expect(MEDIA_ROUTES.statementAudio).toMatchObject({
      method: "GET",
      path: "/v1/media/audio/:lineId",
      auth: "public",
      success: [200],
    });
    expect(MEDIA_ROUTES.statementAudio.response).toBe(StatementAudio);
  });

  it("asks for one line in one language and returns every sentence's clip or null", async () => {
    const { seen, media } = serving(answer);
    const a = await media.statementAudio({ params: { lineId: LINE }, query: { lang: "ceb" } });
    expect(seen).toEqual([`http://fs.test/v1/media/audio/${LINE}?lang=ceb`]);
    expect(a.sentences.map((s) => s.clip?.url ?? null)).toEqual(["/media/audio/M-014/ceb/s1.m4a", null]);
    expect(a.deviceLabel).toBe("Tingog sa telepono");
    const { seen: plain } = serving(answer);
    await mediaRoutes(
      createApiClient({
        baseUrl: "http://fs.test",
        fetch: async (input) => {
          plain.push(String(input));
          return new Response(JSON.stringify(answer), { headers: { "content-type": "application/json" } });
        },
      }),
    ).statementAudio({ params: { lineId: LINE } });
    expect(plain).toEqual([`http://fs.test/v1/media/audio/${LINE}`]);
  });

  it("refuses an answer that breaks the contract: a clip outside /media/audio, or no label", async () => {
    for (const bad of [
      {
        ...answer,
        sentences: [
          {
            ...answer.sentences[0],
            clip: { ...answer.sentences[0]?.clip, url: "/media/audio/drafts/x.m4a" },
          },
        ],
      },
      { ...answer, label: "" },
      { ...answer, url: "/media/audio/M-014/ceb.m4a", cues: [] },
      // a sentence that does not say which form of its slot it is cannot be paired (ADR-0011 §6)
      { ...answer, sentences: answer.sentences.map(({ variant: _, ...s }) => s) },
    ]) {
      const e = await serving(bad)
        .media.statementAudio({ params: { lineId: LINE } })
        .then(
          () => null,
          (err: unknown) => err,
        );
      expect(isContractError(e), JSON.stringify(bad).slice(0, 80)).toBe(true);
    }
  });
});
