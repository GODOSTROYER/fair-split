// AU3 release acceptance: real committed clips, the curated assembly and the real seeded API route.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { StatementAudio } from "@fairsplit/contracts";
import { expect, it } from "vitest";
import { z } from "zod";
import { loadShowcase, must } from "../../proof/testing/world.js";
import type { exportStatementPlans } from "../../statements/export.js";
import { spokenTextSha256 } from "../../statements/render.js";
import { findRepoRoot, staticDirs } from "../../static.js";
import { createTestApp, type TestApp } from "../../test/index.js";
import { AUDIO_CLIP_FILE_RE, readAudioManifest } from "./audio.js";

const root = findRepoRoot();
const media = path.join(root, "media");
const bytesSha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const Verification = z.object({
  v: z.literal(1),
  clips: z.array(
    z.object({
      file: z.string().min(1),
      textSha256: z.string().regex(/^[0-9a-f]{64}$/),
      audioSha256: z.string().regex(/^[0-9a-f]{64}$/),
      asrModel: z.literal("gemini-3.8-flash"),
      cer: z.number().min(0).max(0.12),
      threshold: z.literal(0.12),
      transcript: z.string().trim().min(1),
      method: z.enum(["silence", "relative-silence-duration", "asr-timestamps", "per-sentence-asr"]),
      verifiedAt: z.iso.datetime(),
      synthetic: z.literal(true),
    }),
  ),
});

it("inv.i8.au3-published: every exported M-014 Cebuano sentence has a real labelled clip served with its exact hash", async () => {
  const plans = JSON.parse(readFileSync(path.join(media, "statement-plans.json"), "utf8")) as Awaited<
    ReturnType<typeof exportStatementPlans>
  >;
  const planned = must(plans.requests.find((r) => r.member_no === "M-014" && r.lang === "ceb"));
  expect(planned.sentences).toHaveLength(9);
  const entries = readAudioManifest(media).filter(
    (e) => e.member_no === "M-014" && e.lang === "ceb" && !e.draft,
  );
  // Fail before opening a database when audio is incomplete. Historical spike clips cannot fill a new text.
  const published = planned.sentences.map((s) => {
    const e = entries.find((e) => e.slot === s.slot && e.text_sha256 === s.textSha256);
    expect(e, `published ${s.slot}.${s.variant} ${s.textSha256}`).toBeDefined();
    return must(e);
  });
  const verification = Verification.parse(
    JSON.parse(readFileSync(path.join(media, "audio", "statement-verification.json"), "utf8")),
  );
  for (const [i, e] of published.entries()) {
    const s = must(planned.sentences[i]);
    expect(e.text).toBe(s.text);
    expect(spokenTextSha256(e.text)).toBe(s.textSha256);
    expect(e.file).toMatch(AUDIO_CLIP_FILE_RE);
    expect(e.file).toMatch(/^audio\/M-014\/ceb\/s\d{2}-[A-Z_]+-[0-9a-f]{12}(?:-t\d+)?\.m4a$/);
    expect(e.synthetic).toBe(true);
    expect(e.draft).toBe(false);
    const known = new Set([...s.mentions, ...s.placeholders.map((p) => `fact:${p.name}`)]);
    for (const o of e.offsets ?? []) {
      expect(known.has(o.ref), o.ref).toBe(true);
      expect(o.at_ms).toBeGreaterThanOrEqual(0);
      expect(o.at_ms).toBeLessThanOrEqual(e.duration_ms);
    }
    const mentions = (e.offsets ?? []).filter((o) => s.mentions.includes(o.ref));
    expect(mentions.map((o) => o.ref)).toEqual(
      s.mentions.filter((ref) => mentions.some((o) => o.ref === ref)),
    );
    expect(mentions.map((o) => o.at_ms)).toEqual(mentions.map((o) => o.at_ms).sort((a, b) => a - b));
    const bytes = readFileSync(path.join(media, e.file));
    expect(bytes.length).toBeGreaterThan(32);
    expect(bytes.subarray(4, 8).toString("ascii")).toBe("ftyp");
    const records = verification.clips.filter((record) => record.file === e.file);
    expect(records, `ASR evidence for ${e.file}`).toHaveLength(1);
    const record = must(records[0]);
    expect(record.textSha256).toBe(s.textSha256);
    expect(record.audioSha256).toBe(bytesSha256(bytes));
  }

  const scratch = path.join(root, ".codex-scratch");
  mkdirSync(scratch, { recursive: true });
  const assembled = mkdtempSync(path.join(scratch, "au3-published-"));
  let app: TestApp | undefined;
  try {
    const { assembleMedia } = await import(pathToFileURL(path.join(root, "tools/assemble-media.ts")).href);
    const result = assembleMedia(root, assembled) as { files: string[]; problems: string[] };
    expect(result.problems).toEqual([]);
    for (const e of published) expect(result.files).toContain(e.file);
    app = await createTestApp({
      db: "postgres",
      env: { STATIC_MEDIA_DIR: assembled },
      static: { ...staticDirs({}), media: assembled },
    });
    const world = await loadShowcase(app.deps.db);
    const lineId = must(world.lineIds.get("M-014"));
    const token = app.credentials.memberLink({ workspaceId: world.workspaceId, lineId });
    const response = await app.json(`/v1/media/audio/${lineId}?lang=ceb`, {
      as: app.credentials.bearer(token),
    });
    expect(response.status).toBe(200);
    const audio = StatementAudio.parse(response.body);
    expect(audio).toMatchObject({ memberNo: "M-014", lang: "ceb", source: "gemini" });
    expect(audio.label).toBe("Sintetikong tingog (Gemini TTS)");
    expect(audio.sentences.map((s) => [s.slot, s.variant, s.textSha256])).toEqual(
      planned.sentences.map((s) => [s.slot, s.variant, s.textSha256]),
    );
    for (const [i, sentence] of audio.sentences.entries()) {
      const expected = must(published[i]);
      const clip = must(sentence.clip, `served ${sentence.slot}`);
      expect(clip.textSha256).toBe(sentence.textSha256);
      expect(clip.label).toBe("Sintetikong tingog (Gemini TTS)");
      expect(clip.url).not.toContain("/drafts/");
      const served = await app.request(clip.url);
      expect(served.status).toBe(200);
      const local = readFileSync(path.join(media, expected.file));
      expect(bytesSha256(Buffer.from(await served.arrayBuffer()))).toBe(bytesSha256(local));
      expect(bytesSha256(readFileSync(path.join(assembled, expected.file)))).toBe(bytesSha256(local));
    }
  } finally {
    await app?.close();
    rmSync(assembled, { recursive: true, force: true });
  }
});

it("inv.i8.au3-published-subset: verified M-014 Cebuano clips are served exactly and every missing sentence keeps labelled device voice", async () => {
  const plans = JSON.parse(readFileSync(path.join(media, "statement-plans.json"), "utf8")) as Awaited<
    ReturnType<typeof exportStatementPlans>
  >;
  const planned = must(plans.requests.find((r) => r.member_no === "M-014" && r.lang === "ceb"));
  const verification = Verification.parse(
    JSON.parse(readFileSync(path.join(media, "audio", "statement-verification.json"), "utf8")),
  );
  const entries = readAudioManifest(media).filter(
    (e) => e.member_no === "M-014" && e.lang === "ceb" && !e.draft,
  );
  const verified = planned.sentences.map((sentence) =>
    entries.find(
      (entry) =>
        entry.slot === sentence.slot &&
        entry.text === sentence.text &&
        entry.text_sha256 === sentence.textSha256 &&
        verification.clips.some(
          (record) =>
            record.file === entry.file &&
            record.textSha256 === sentence.textSha256 &&
            record.audioSha256 === bytesSha256(readFileSync(path.join(media, entry.file))),
        ),
    ),
  );
  expect(verified.filter(Boolean).length).toBeGreaterThan(0);
  expect(verified.some((entry) => entry?.slot === "BONUS")).toBe(true);
  const scratch = path.join(root, ".codex-scratch");
  mkdirSync(scratch, { recursive: true });
  const assembled = mkdtempSync(path.join(scratch, "au3-subset-"));
  let app: TestApp | undefined;
  try {
    const { assembleMedia } = await import(pathToFileURL(path.join(root, "tools/assemble-media.ts")).href);
    const result = assembleMedia(root, assembled) as { files: string[]; problems: string[] };
    expect(result.problems).toEqual([]);
    app = await createTestApp({
      db: "postgres",
      env: { STATIC_MEDIA_DIR: assembled },
      static: { ...staticDirs({}), media: assembled },
    });
    const world = await loadShowcase(app.deps.db);
    const lineId = must(world.lineIds.get("M-014"));
    const token = app.credentials.memberLink({ workspaceId: world.workspaceId, lineId });
    const response = await app.json(`/v1/media/audio/${lineId}?lang=ceb`, {
      as: app.credentials.bearer(token),
    });
    expect(response.status).toBe(200);
    const audio = StatementAudio.parse(response.body);
    const count = verified.filter(Boolean).length;
    expect(audio.source).toBe(count === planned.sentences.length ? "gemini" : "mixed");
    expect(audio.label).toBe("Sintetikong tingog (Gemini TTS)");
    expect(audio.deviceLabel).toBe("Tingog sa telepono");
    expect(audio.sentences.map((s) => [s.slot, s.variant, s.textSha256])).toEqual(
      planned.sentences.map((s) => [s.slot, s.variant, s.textSha256]),
    );
    for (const [i, sentence] of audio.sentences.entries()) {
      const entry = verified[i];
      if (!entry) {
        expect(sentence.clip, `unverified ${sentence.slot} keeps ${audio.deviceLabel}`).toBeNull();
        continue;
      }
      const clip = must(sentence.clip, `verified ${sentence.slot}`);
      expect(clip.url).toBe(`/media/${entry.file}`);
      expect(clip.textSha256).toBe(sentence.textSha256);
      expect(clip.label).toBe("Sintetikong tingog (Gemini TTS)");
      expect(clip.url).not.toContain("/drafts/");
      const served = await app.request(clip.url);
      expect(served.status).toBe(200);
      const expectedHash = bytesSha256(readFileSync(path.join(media, entry.file)));
      expect(bytesSha256(Buffer.from(await served.arrayBuffer()))).toBe(expectedHash);
      expect(bytesSha256(readFileSync(path.join(assembled, entry.file)))).toBe(expectedHash);
    }
  } finally {
    await app?.close();
    rmSync(assembled, { recursive: true, force: true });
  }
});
