// Dynamic media: the archived-photo tile (OD-4) and which audio a statement plays, always labelled (I8).
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type ApiError, type Lang, StatementAudio } from "@fairsplit/contracts";
import { format } from "@fairsplit/domain";
import { getPhotos } from "@fairsplit/seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadShowcase, must, type ShowcaseWorld } from "../../proof/testing/world.js";
import type { StatementView } from "../../statements/view.js";
import { findRepoRoot, staticDirs } from "../../static.js";
import { createTestApp, type TestApp } from "../../test/index.js";
import { AUDIO_CLIP_FILE_RE, type ManifestEntry, sha256Text } from "./audio.js";
import { archivedTileSvg } from "./index.js";

let t: TestApp;
let w: ShowcaseWorld;
let mediaDir: string;

/** The repository's media/ (the source tree; it is never served itself). */
const REPO_MEDIA = path.join(findRepoRoot(), "media");

/** The committed IC-11 manifest, media/audio/manifest.json. */
function spike(): { entries: ManifestEntry[] } {
  return JSON.parse(readFileSync(path.join(REPO_MEDIA, "audio", "manifest.json"), "utf8")) as {
    entries: ManifestEntry[];
  };
}

function publishManifest(body: unknown): void {
  mkdirSync(path.join(mediaDir, "audio"), { recursive: true });
  writeFileSync(path.join(mediaDir, "audio", "manifest.json"), JSON.stringify(body));
}

/**
 * What the media/public assembly (H1, ADR-0011 §5) does with media/audio: the manifest and the non-draft clips it
 * lists under audio/{member}/{lang}/, copied to the same relative paths, and nothing else.
 */
function publishSpike(): void {
  for (const e of spike().entries) {
    if (e.draft || !AUDIO_CLIP_FILE_RE.test(e.file)) continue;
    const to = path.join(mediaDir, ...e.file.split("/"));
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(path.join(REPO_MEDIA, ...e.file.split("/")), to);
  }
  publishManifest(JSON.parse(readFileSync(path.join(REPO_MEDIA, "audio", "manifest.json"), "utf8")));
}

beforeAll(async () => {
  mediaDir = mkdtempSync(path.join(tmpdir(), "fs-media-"));
  publishSpike();
  // the route reads the manifest from STATIC_MEDIA_DIR; /media serves the same directory
  t = await createTestApp({
    db: "postgres",
    env: { STATIC_MEDIA_DIR: mediaDir },
    static: { ...staticDirs({}), media: mediaDir },
  });
  w = await loadShowcase(t.deps.db);
});
afterAll(async () => {
  await t.close();
  rmSync(mediaDir, { recursive: true, force: true });
});

describe("GET /media/archived/:photoId.svg", () => {
  it("draws the hatched tile for an earlier photo, with its read date in words, cached as immutable", async () => {
    const photo = must(getPhotos("EARLIER")[0]);
    const r = await t.request(`/media/archived/${photo.photoId}.svg`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    const svg = await r.text();
    expect(svg).toContain(`Archived photo ${photo.photoId}`);
    expect(svg).toContain(`Read ${format.date(must(photo.readOn), "en")}`);
    expect(svg).toContain('role="img"');
    expect(svg).not.toMatch(/<script/i);
  });

  it("404 for a replay photo (it is shown, not archived), an unknown photo, or another file name", async () => {
    for (const file of [
      `${must(getPhotos("REPLAY")[0]).photoId}.svg`,
      "P99.svg",
      "P01.png",
      "..%2Fsecret.svg",
    ]) {
      expect((await t.request(`/media/archived/${file}`)).status, file).toBe(404);
    }
  });

  it("escapes what it draws", () => {
    expect(archivedTileSvg("P01<script>", null)).toContain("P01&#60;script&#62;");
  });
});

type Spoken = StatementView["spoken"][number];

describe("GET /v1/media/audio/:lineId (IC-11, ADR-0011)", () => {
  const lineId = () => must(w.lineIds.get("M-014"));
  const member = () =>
    t.credentials.bearer(t.credentials.memberLink({ workspaceId: w.workspaceId, lineId: lineId() }));
  const statement = async (lang: Lang) => {
    const r = await t.json<StatementView>(`/v1/statements/${lineId()}?lang=${lang}`, { as: member() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  };
  const audio = async (lang?: Lang) => {
    const r = await t.json<StatementAudio>(`/v1/media/audio/${lineId()}${lang ? `?lang=${lang}` : ""}`, {
      as: member(),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return StatementAudio.parse(r.body);
  };
  /** Publishes a fixture manifest for M-014: one entry per spoken sentence (or none), its file in the media dir. */
  const fixture = (lang: Lang, view: StatementView, each: (s: Spoken) => Record<string, unknown> | null) => {
    const entries = view.spoken.flatMap((s, i) => {
      const over = each(s);
      if (!over) return [];
      const e = {
        member_no: "M-014",
        lang,
        slot: s.slot,
        file: `audio/M-014/${lang}/${String(i).padStart(2, "0")}-${s.slot}.m4a`,
        duration_ms: 6_000,
        text: s.text,
        text_sha256: sha256Text(s.text),
        synthetic: true,
        draft: false,
        model: "gemini-3.8-flash-tts",
        voice: "Sulafat",
        created_at: "2026-11-03T03:30:00.000Z",
        ...over,
      };
      const file = path.join(mediaDir, ...String(e.file).split("/"));
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, Buffer.alloc(32));
      return [e];
    });
    publishManifest({ v: 1, synthetic: true, notice: "Fixture: synthetic clips.", entries });
  };

  it("serves M-014's real Cebuano greeting: the published spike clip whose words are exactly the statement's", async () => {
    publishSpike();
    const view = await statement("ceb");
    const a = await audio();
    expect(a).toMatchObject({ lineId: lineId(), memberNo: "M-014", lang: "ceb", source: "mixed" });
    expect(a.label).toBe("Sintetikong tingog (Gemini TTS)");
    expect(a.deviceLabel).toBe("Tingog sa telepono");
    expect(a.sentences.map((s) => s.slot)).toEqual(view.spoken.map((s) => s.slot));
    expect(a.sentences.map((s) => s.mentions)).toEqual(view.spoken.map((s) => s.mentions));
    expect(a.sentences.map((s) => s.textSha256)).toEqual(view.spoken.map((s) => sha256Text(s.text)));

    const greeting = must(view.spoken[0]);
    const real = must(
      spike().entries.find((e) => e.lang === "ceb" && e.slot === "GREETING" && !e.draft),
      "the spike's final Cebuano greeting",
    );
    expect(real.text).toBe(greeting.text);
    expect(a.sentences[0]?.clip).toEqual({
      url: `/media/${real.file}`,
      textSha256: sha256Text(greeting.text),
      label: "Sintetikong tingog (Gemini TTS)",
      slot: "GREETING",
      offsets: [],
      durationMs: real.duration_ms,
    });
    // the URL it names is the published clip itself
    const clip = await t.request(must(a.sentences[0]?.clip).url);
    expect(clip.status).toBe(200);
    expect(Buffer.from(await clip.arrayBuffer())).toEqual(
      readFileSync(path.join(REPO_MEDIA, ...real.file.split("/"))),
    );
  });

  it("the spike's other sentences predate the final text: honestly no clip, the phone's voice, labelled", async () => {
    publishSpike();
    const ceb = await audio();
    const pay = must(ceb.sentences.find((s) => s.slot === "PAY"));
    const spikePay = must(spike().entries.find((e) => e.lang === "ceb" && e.slot === "PAY" && !e.draft));
    expect(spikePay.text_sha256).not.toBe(pay.textSha256);
    expect(pay.clip).toBeNull();
    expect(ceb.sentences.filter((s) => s.clip !== null).map((s) => s.slot)).toEqual(["GREETING"]);
    // the Filipino and English greetings name "Nang Celing" where the registry says "Gng. Bacus" and "Mrs. Bacus"
    expect(await audio("fil")).toMatchObject({ source: "device", label: "Boses ng telepono" });
    const en = await audio("en");
    expect(en).toMatchObject({ source: "device", label: "Device voice", deviceLabel: "Device voice" });
    expect(en.sentences.every((s) => s.clip === null)).toBe(true);
  });

  it("a fixture manifest with every sentence's exact words plays them all, with their mention offsets", async () => {
    const view = await statement("en");
    const sources = must(view.spoken.find((s) => s.slot === "SOURCES"));
    expect(sources.mentions.length).toBeGreaterThan(0);
    fixture("en", view, (s) =>
      s.slot === "SOURCES"
        ? { offsets: s.mentions.map((ref, i) => ({ ref, at_ms: 1_000 + 400 * i })) }
        : s.slot === "GREETING"
          ? { offsets: [{ ref: "fact:HONORIFIC_NAME", at_ms: 700 }] }
          : {},
    );
    const a = await audio("en");
    expect(a).toMatchObject({
      source: "gemini",
      label: "Synthetic voice (Gemini TTS)",
      deviceLabel: "Device voice",
    });
    a.sentences.forEach((s, i) => {
      expect(s.clip?.url).toBe(`/media/audio/M-014/en/${String(i).padStart(2, "0")}-${s.slot}.m4a`);
      expect(s.clip?.textSha256).toBe(sha256Text(must(view.spoken[i]).text));
      expect(s.clip?.label).toBe("Synthetic voice (Gemini TTS)");
    });
    expect(a.sentences.find((s) => s.slot === "SOURCES")?.clip?.offsets).toEqual(
      sources.mentions.map((ref, i) => ({ ref, atMs: 1_000 + 400 * i })),
    );
    expect(a.sentences[0]?.clip?.offsets).toEqual([{ ref: "fact:HONORIFIC_NAME", atMs: 700 }]);
  });

  it("the route's answer for M-014 is the IC-11 golden the app's test plays (apart from line id and hashes)", async () => {
    const golden = JSON.parse(
      readFileSync(new URL("./ic11-m014.golden.json", import.meta.url), "utf8"),
    ) as Record<Lang, StatementAudio>;
    /** What fs-api and the app must agree on (ic11-golden.test.ts): everything but the line and the words. */
    const paired = (x: StatementAudio) => ({
      ...x,
      lineId: "(line)",
      sentences: x.sentences.map(({ textSha256: _, clip, ...s }) => ({
        ...s,
        clip: clip && { ...clip, textSha256: "(words)" },
      })),
    });
    for (const lang of ["ceb", "fil", "en"] as const) {
      fixture(lang, await statement(lang), (s) =>
        s.slot === "SOURCES"
          ? { offsets: s.mentions.map((ref, k) => ({ ref, at_ms: 1_500 + 600 * k })) }
          : s.slot === "GREETING"
            ? { offsets: [{ ref: "fact:HONORIFIC_NAME", at_ms: 700 }] }
            : {},
      );
      expect(paired(await audio(lang)), lang).toEqual(paired(StatementAudio.parse(golden[lang])));
    }
  });

  it("mismatch: no sentence ever gets a clip of other words, under a lying hash, a draft or an unlisted file", async () => {
    const view = await statement("en");
    const mismatches: ((s: Spoken) => Record<string, unknown>)[] = [
      (s) => ({ text: `${s.text} `, text_sha256: sha256Text(`${s.text} `) }),
      (s) => ({ text: `${s.text}!`, text_sha256: sha256Text(s.text) }),
      () => ({ draft: true }),
      (s) => ({ slot: s.slot === "HELP" ? "GREETING" : "HELP" }),
      (s) => ({ file: `audio/drafts/M-014/en/${s.slot}.m4a` }),
      (s) => ({ file: `audio/M-007/en/${s.slot}.m4a` }),
      () => ({ lang: "fil" }),
    ];
    for (const [i, mismatch] of mismatches.entries()) {
      fixture("en", view, mismatch);
      const a = await audio("en");
      expect(a, `mismatch ${i}`).toMatchObject({ source: "device", label: "Device voice" });
      expect(
        a.sentences.every((s) => s.clip === null),
        `mismatch ${i}`,
      ).toBe(true);
    }
  });

  it("the statement's readers only: 401 without a credential, 404 for another member's line", async () => {
    expect((await t.json<ApiError>(`/v1/media/audio/${lineId()}`)).status).toBe(401);
    const link = t.credentials.memberLink({
      workspaceId: w.workspaceId,
      lineId: must(w.lineIds.get("M-007")),
    });
    const r = await t.json<ApiError>(`/v1/media/audio/${lineId()}`, {
      as: t.credentials.bearer(link),
    });
    expect(r.status).toBe(404);
  });
});
