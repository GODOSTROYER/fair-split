// Dynamic media: the archived-photo tile (OD-4) and which audio a statement plays, always labelled (I8).
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type ApiError, type Lang, StatementAudio } from "@fairsplit/contracts";
import { format } from "@fairsplit/domain";
import { getPhotos } from "@fairsplit/seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attestCash, loadShowcase, must, type ShowcaseWorld } from "../../proof/testing/world.js";
import { spokenTextSha256 } from "../../statements/render.js";
import { STATEMENT_SLOTS } from "../../statements/types.js";
import type { StatementView } from "../../statements/view.js";
import { findRepoRoot, staticDirs } from "../../static.js";
import { createTestApp, type TestApp } from "../../test/index.js";
import type { ManifestEntry } from "./audio.js";
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
 * The clips main's media assembly (tools/assemble-media.ts, H1; ADR-0011 §5) copies into the served folder
 * (STATIC_MEDIA_DIR, apps/api/dist/media on Render): its allowlist's `audio/M-???/{ceb,fil,en}/s*.m4a` and
 * `audio/drafts/M-???/{ceb,fil,en}/s*.m4a`. The drafts are copied too; the route never names one.
 */
const ASSEMBLED = [
  /^audio\/M-\d{3}\/(?:ceb|fil|en)\/s[^/]*\.m4a$/,
  /^audio\/drafts\/M-\d{3}\/(?:ceb|fil|en)\/s[^/]*\.m4a$/,
];

/** What that assembly does with media/audio: the manifest and the clips it lists, at the same relative paths. */
function publishSpike(): void {
  for (const e of spike().entries) {
    if (!ASSEMBLED.some((re) => re.test(e.file))) continue;
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

/** A clip's file as ADR-0011 §4 names it: `s{NN}-{SLOT}-{hash12}.m4a`, NN the slot's place (GREETING 01 … AI_NOTE 10). */
function clipFile(memberNo: string, lang: Lang, s: Spoken): string {
  const nn = String(STATEMENT_SLOTS.indexOf(s.slot) + 1).padStart(2, "0");
  return `audio/${memberNo}/${lang}/s${nn}-${s.slot}-${spokenTextSha256(s.text).slice(0, 12)}.m4a`;
}

/** The fixture offsets of the IC-11 goldens (ic11-golden.test.ts): the slips in SOURCES, the name in GREETING. */
const goldenOffsets = (s: Spoken) =>
  s.slot === "SOURCES"
    ? { offsets: s.mentions.map((ref, k) => ({ ref, at_ms: 1_500 + 600 * k })) }
    : s.slot === "GREETING"
      ? { offsets: [{ ref: "fact:HONORIFIC_NAME", at_ms: 700 }] }
      : {};

/** What fs-api and the app must agree on (ic11-golden.test.ts): everything but the line and the words' hashes. */
const paired = (x: StatementAudio) => ({
  ...x,
  lineId: "(line)",
  sentences: x.sentences.map(({ textSha256: _, clip, ...s }) => ({
    ...s,
    clip: clip && { ...clip, textSha256: "(words)" },
  })),
});

describe("GET /v1/media/audio/:lineId (IC-11, ADR-0011)", () => {
  const lineId = (memberNo = "M-014") => must(w.lineIds.get(memberNo));
  const member = (memberNo = "M-014") =>
    t.credentials.bearer(t.credentials.memberLink({ workspaceId: w.workspaceId, lineId: lineId(memberNo) }));
  const statement = async (lang: Lang, memberNo = "M-014") => {
    const r = await t.json<StatementView>(`/v1/statements/${lineId(memberNo)}?lang=${lang}`, {
      as: member(memberNo),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  };
  const audio = async (lang?: Lang, memberNo = "M-014") => {
    const r = await t.json<StatementAudio>(
      `/v1/media/audio/${lineId(memberNo)}${lang ? `?lang=${lang}` : ""}`,
      { as: member(memberNo) },
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return StatementAudio.parse(r.body);
  };
  /** Publishes a fixture manifest for one line: one entry per spoken sentence (or none), its file in the media dir. */
  const fixture = (
    lang: Lang,
    view: StatementView,
    each: (s: Spoken) => Record<string, unknown> | null,
    memberNo = "M-014",
  ) => {
    const entries = view.spoken.flatMap((s) => {
      const over = each(s);
      if (!over) return [];
      const e = {
        member_no: memberNo,
        lang,
        slot: s.slot,
        file: clipFile(memberNo, lang, s),
        duration_ms: 6_000,
        text: s.text,
        text_sha256: spokenTextSha256(s.text),
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
    // the template variant the statement rendered (PAY.paypal, the AI note's form), so the app pairs by it too
    expect(a.sentences.map((s) => s.variant)).toEqual(view.spoken.map((s) => s.variant));
    expect(a.sentences.find((s) => s.slot === "PAY")?.variant).toBe("paypal");
    expect(a.sentences.map((s) => s.mentions)).toEqual(view.spoken.map((s) => s.mentions));
    expect(a.sentences.map((s) => s.textSha256)).toEqual(view.spoken.map((s) => spokenTextSha256(s.text)));

    const greeting = must(view.spoken[0]);
    const real = must(
      spike().entries.find((e) => e.lang === "ceb" && e.slot === "GREETING" && !e.draft),
      "the spike's final Cebuano greeting",
    );
    expect(real.text).toBe(greeting.text);
    expect(a.sentences[0]?.clip).toEqual({
      url: `/media/${real.file}`,
      textSha256: spokenTextSha256(greeting.text),
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
      expect(s.clip?.url).toBe(`/media/${clipFile("M-014", "en", must(view.spoken[i]))}`);
      expect(s.clip?.textSha256).toBe(spokenTextSha256(must(view.spoken[i]).text));
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
    for (const lang of ["ceb", "fil", "en"] as const) {
      fixture(lang, await statement(lang), goldenOffsets);
      expect(paired(await audio(lang)), lang).toEqual(paired(StatementAudio.parse(golden[lang])));
    }
  });

  it("the route's answers for the cash lines M-031 and M-053 are the IC-11 cash golden's: PAY.cash_nodate, then PAY.cash once the receipt is recorded", async () => {
    const golden = JSON.parse(readFileSync(new URL("./ic11-cash.golden.json", import.meta.url), "utf8")) as {
      cases: { memberNo: string; lang: Lang; cashDay: string | null; answer: unknown }[];
    };
    const check = async (received: boolean) => {
      const cases = golden.cases.filter((c) => (c.cashDay !== null) === received);
      expect(cases.map((c) => c.memberNo)).toEqual(["M-031", "M-053"]);
      for (const c of cases) {
        fixture(c.lang, await statement(c.lang, c.memberNo), goldenOffsets, c.memberNo);
        const a = await audio(c.lang, c.memberNo);
        expect(a.sentences.find((s) => s.slot === "PAY")?.variant, c.memberNo).toBe(
          received ? "cash" : "cash_nodate",
        );
        // the very clips the golden names (their file names carry the words' hash), on fs-api's real answer
        expect(paired(a), `${c.memberNo} ${c.lang}`).toEqual(paired(StatementAudio.parse(c.answer)));
      }
    };
    // the showcase world leaves both lines' cash due at the bodega: no receipt yet
    await check(false);
    // the clerk records the cash handed over on cash day (the clerk's "Nadawat")
    await attestCash(t.deps.db, w, ["M-031", "M-053"]);
    await check(true);
  });

  it("the drafts main's assembly copies into the served folder are never named by an answer", async () => {
    publishSpike();
    const drafts = spike().entries.filter((e) => e.draft);
    expect(drafts.length).toBeGreaterThan(0);
    for (const d of drafts) {
      // copied by the assembly, like any clip its allowlist serves
      expect(existsSync(path.join(mediaDir, ...d.file.split("/"))), d.file).toBe(true);
      expect(d.file.startsWith("audio/drafts/"), d.file).toBe(true);
    }
    for (const lang of ["ceb", "fil", "en"] as const) {
      const a = await audio(lang);
      const urls = a.sentences.flatMap((s) => (s.clip ? [s.clip.url] : []));
      expect(
        urls.filter((u) => u.includes("/drafts/")),
        lang,
      ).toEqual([]);
    }
    // the draft Cebuano greeting has the statement's exact words, yet the answer names the published take
    const ceb = await audio("ceb");
    expect(drafts.some((d) => d.lang === "ceb" && d.text_sha256 === ceb.sentences[0]?.textSha256)).toBe(true);
    expect(ceb.sentences[0]?.clip?.url).toBe("/media/audio/M-014/ceb/s1.m4a");
  });

  it("mismatch: no sentence ever gets a clip of other words, under a lying hash, a draft or an unlisted file", async () => {
    const view = await statement("en");
    const mismatches: ((s: Spoken) => Record<string, unknown>)[] = [
      (s) => ({ text: `${s.text} `, text_sha256: spokenTextSha256(`${s.text} `) }),
      (s) => ({ text: `${s.text}!`, text_sha256: spokenTextSha256(s.text) }),
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
