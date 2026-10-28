// Dynamic media: the archived-photo tile (OD-4) and which audio a statement plays, always labelled (I8).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ApiError } from "@fairsplit/contracts";
import { format } from "@fairsplit/domain";
import { getPhotos } from "@fairsplit/seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadShowcase, must, type ShowcaseWorld } from "../../proof/testing/world.js";
import { createTestApp, type TestApp } from "../../test/index.js";
import { archivedTileSvg } from "./index.js";

let t: TestApp;
let w: ShowcaseWorld;
let mediaDir: string;

beforeAll(async () => {
  mediaDir = mkdtempSync(path.join(tmpdir(), "fs-media-"));
  mkdirSync(path.join(mediaDir, "audio"), { recursive: true });
  writeFileSync(
    path.join(mediaDir, "audio", "manifest.json"),
    JSON.stringify([
      {
        member_no: "M-014",
        lang: "ceb",
        file: "M-014/ceb.m4a",
        duration_ms: 41_200,
        template_v: "statements-v1",
        text_sha256: "a".repeat(64),
        voice: "Sulafat",
        model: "gemini-3.8-flash-tts",
        created_at: "2026-11-04T00:00:00.000Z",
        synthetic: true,
        cue_source: "silence",
        cues: [{ slot: "GREETING", start_ms: 0, end_ms: 3_100, mentions: [] }],
      },
    ]),
  );
  t = await createTestApp({ db: "postgres", env: { STATIC_MEDIA_DIR: mediaDir } });
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

describe("GET /v1/media/audio/:lineId", () => {
  it("inv.i8.labels: names the synthetic Gemini clip when the manifest has one, else the device's voice", async () => {
    const link = t.credentials.memberLink({
      workspaceId: w.workspaceId,
      lineId: must(w.lineIds.get("M-014")),
    });
    const ceb = await t.json<Record<string, unknown>>(`/v1/media/audio/${w.lineIds.get("M-014")}`, {
      as: t.credentials.bearer(link),
    });
    expect(ceb.status, JSON.stringify(ceb.body)).toBe(200);
    expect(ceb.body).toMatchObject({
      source: "gemini",
      label: "Sintetikong tingog (Gemini TTS)",
      url: "/media/audio/M-014/ceb.m4a",
      durationMs: 41_200,
    });
    const en = await t.json<Record<string, unknown>>(`/v1/media/audio/${w.lineIds.get("M-014")}?lang=en`, {
      as: t.credentials.bearer(link),
    });
    expect(en.body).toMatchObject({ source: "device", label: "Device voice", url: null, cues: [] });
  });

  it("the statement's readers only: 401 without a credential, 404 for another member's line", async () => {
    expect((await t.json<ApiError>(`/v1/media/audio/${w.lineIds.get("M-014")}`)).status).toBe(401);
    const link = t.credentials.memberLink({
      workspaceId: w.workspaceId,
      lineId: must(w.lineIds.get("M-007")),
    });
    const r = await t.json<ApiError>(`/v1/media/audio/${w.lineIds.get("M-014")}`, {
      as: t.credentials.bearer(link),
    });
    expect(r.status).toBe(404);
  });
});
