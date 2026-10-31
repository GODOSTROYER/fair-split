import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assembleMedia,
  checkAllowlist,
  MEDIA_ALLOWLIST,
  MEDIA_PUBLIC_DIR,
  main,
  parseArgs,
} from "../../../tools/assemble-media.js";
import { REPO_ROOT } from "../../../tools/lib/blueprint.js";

let dirs: string[] = [];
const temp = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** Every file under `dir`, repo-style (forward slashes), sorted. */
const listed = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => relative(dir, join(e.parentPath, e.name)).replaceAll("\\", "/"))
        .sort()
    : [];

const manifest = (files: string[]) =>
  JSON.stringify({ v: 1, synthetic: true, entries: files.map((file) => ({ member_no: "M-014", file })) });

/** A media/ tree like the real one: what may be served next to what never may. */
function mediaTree(extra: Record<string, string> = {}): string {
  const root = temp("fs-media-root-");
  const files: Record<string, string> = {
    "media/audio/manifest.json": manifest(["audio/M-014/ceb/s1.m4a", "audio/drafts/M-014/ceb/s1.m4a"]),
    "media/audio/M-014/ceb/s1.m4a": "clip",
    "media/audio/drafts/M-014/ceb/s1.m4a": "draft clip",
    "media/audio/spike-s10.json": "{}",
    "media/photos/A.webp": "photo",
    "media/photos/spike/spike-4up.webp": "spike photo",
    "media/slips/spike-0462.webp": "slip",
    "media/docs/br-2026-04-p1.webp": "page",
    "media/docs/BR-2026-04.text.json": "{}",
    "media/prompts/spike-0462.md": "the prompt",
    "media/eval/provisional/case.json": "{}",
    "media/review/sessions/x.json": "{}",
    "media/masters/spike-0462.jpg": "master",
    "media/src/tts/run.ts": "code",
    "media/node_modules/x/index.js": "dep",
    "media/README.md": "readme",
    ...extra,
  };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

describe("tools/assemble-media: /media serves an explicit allowlist, never media/ wholesale", () => {
  it("copies exactly the allowlisted clips, manifest, photos A-L, hero flats and pages, keeping their paths", () => {
    const root = mediaTree();
    const out = temp("fs-media-out-");
    const r = assembleMedia(root, out);
    expect(r.problems).toEqual([]);
    expect(listed(out)).toEqual([
      "audio/M-014/ceb/s1.m4a",
      "audio/drafts/M-014/ceb/s1.m4a",
      "audio/manifest.json",
      "docs/br-2026-04-p1.webp",
      "photos/A.webp",
      "slips/spike-0462.webp",
    ]);
    expect(r.files).toEqual(listed(out));
  });

  it("an allowlist entry that could reach anything else fails, and nothing is written", () => {
    for (const bad of [
      "**/*",
      "audio/**",
      "prompts/*.md",
      "masters/*.jpg",
      "audio/*.json",
      "docs/*.json",
      "../media/slips/*.webp",
      "slips/../prompts/*.webp",
      "/etc/x.webp",
      "slips\\*.webp",
    ]) {
      expect(checkAllowlist([bad]).length, bad).toBeGreaterThan(0);
      const out = temp("fs-media-out-");
      const r = assembleMedia(mediaTree(), out, [...MEDIA_ALLOWLIST, bad]);
      expect(r.problems.length, bad).toBeGreaterThan(0);
      expect(r.files, bad).toEqual([]);
      expect(listed(out), bad).toEqual([]);
    }
    expect(checkAllowlist(MEDIA_ALLOWLIST)).toEqual([]);
  });

  it("fails when the audio manifest names a clip the allowlist does not serve (it would 404)", () => {
    const root = mediaTree({
      "media/audio/manifest.json": manifest(["audio/M-014/ceb/s1.m4a", "audio/retakes/M-014/ceb/s1.m4a"]),
      "media/audio/retakes/M-014/ceb/s1.m4a": "retake",
    });
    const r = assembleMedia(root, temp("fs-media-out-"));
    expect(r.problems).toEqual([
      "audio/manifest.json names audio/retakes/M-014/ceb/s1.m4a, which the allowlist does not serve",
    ]);
  });

  it("fails on an unreadable manifest, and on a matched file that is a symlink", () => {
    const broken = assembleMedia(
      mediaTree({ "media/audio/manifest.json": "{not json" }),
      temp("fs-media-out-"),
    );
    expect(broken.problems).toEqual(["audio/manifest.json is not valid JSON"]);
    const root = mediaTree();
    try {
      symlinkSync(join(root, "media/prompts"), join(root, "media/slips/link.webp"), "junction");
    } catch {
      return; // no symlink privilege here; the lstat guard is still typed in
    }
    const r = assembleMedia(root, temp("fs-media-out-"));
    expect(r.problems).toEqual(["slips/link.webp is a symlink; only regular files are served"]);
  });

  it("refuses a public folder that is a symlink, and a media/ that is one, and reads nothing through either", () => {
    // a public folder linked elsewhere: every file under it would match the allowlist's globs
    const root = mediaTree({ "elsewhere/secret.webp": "not public" });
    rmSync(join(root, "media/docs"), { recursive: true, force: true });
    try {
      symlinkSync(join(root, "elsewhere"), join(root, "media/docs"), "junction");
    } catch {
      return; // no symlink privilege here; the lstat guard is still typed in
    }
    const out = temp("fs-media-out-");
    const r = assembleMedia(root, out);
    expect(r.problems).toEqual(["docs/ is a symlink; a public folder must be a real folder"]);
    expect(r.files).toEqual([]);
    expect(listed(out)).toEqual([]);

    // media/ itself linked to a tree elsewhere
    const linked = temp("fs-media-linked-");
    symlinkSync(join(mediaTree(), "media"), join(linked, "media"), "junction");
    const viaLink = assembleMedia(linked, temp("fs-media-out-"));
    expect(viaLink.problems).toEqual(["media/ is a symlink; it must be a real folder"]);
    expect(viaLink.files).toEqual([]);
  });

  it("refuses a matched file whose path has a segment that starts with a dot, and ignores dot folders", () => {
    const hidden = assembleMedia(
      mediaTree({ "media/slips/.x.webp": "hidden", "media/photos/..webp": "hidden" }),
      temp("fs-media-out-"),
    );
    expect(hidden.problems).toEqual([
      "photos/..webp starts with a dot; hidden files are never served",
      "slips/.x.webp starts with a dot; hidden files are never served",
    ]);
    expect(hidden.files).toEqual([]);
    // a dot folder (an editor's or a tool's) is not walked at all, and nothing under it is served
    const out = temp("fs-media-out-");
    const r = assembleMedia(mediaTree({ "media/slips/.cache/y.webp": "cache" }), out);
    expect(r.problems).toEqual([]);
    expect(listed(out)).not.toContain("slips/.cache/y.webp");
  });

  it("replaces the output folder, so a file from an earlier build never lingers", () => {
    const out = temp("fs-media-out-");
    writeFileSync(join(out, "stale.md"), "old");
    expect(assembleMedia(mediaTree(), out).problems).toEqual([]);
    expect(listed(out)).not.toContain("stale.md");
  });

  it("assembles the committed media/ tree: clips, manifest, flats and pages only", () => {
    const out = temp("fs-media-out-");
    const r = assembleMedia(REPO_ROOT, out);
    expect(r.problems).toEqual([]);
    expect(r.files).toContain("audio/manifest.json");
    expect(r.files).toContain("audio/M-014/ceb/s1.m4a");
    expect(r.files.some((f) => f.startsWith("slips/"))).toBe(true);
    for (const f of r.files) expect(f, f).toMatch(/^(audio\/manifest\.json|[a-z]+\/[\w/.-]+\.(m4a|webp))$/);
    expect(r.files.some((f) => /prompts|eval|review|masters|src\/|fixtures|node_modules/.test(f))).toBe(
      false,
    );
  });

  it("the CLI writes only under an app's dist folder, by default render.yaml's STATIC_MEDIA_DIR", () => {
    expect(MEDIA_PUBLIC_DIR).toBe("apps/api/dist/media");
    expect(parseArgs([], "/repo")).toEqual({ root: "/repo", out: join("/repo", "apps/api/dist/media") });
    expect(() => parseArgs(["--out=media/public"], "/repo")).toThrow(/under apps\/<app>\/dist/);
    expect(() => parseArgs(["--out=apps/api/src"], "/repo")).toThrow(/under apps\/<app>\/dist/);
    expect(() => parseArgs(["--verbose"], "/repo")).toThrow(/unknown argument/);
    const root = mediaTree();
    const lines: string[] = [];
    expect(main([`--root=${root}`], (l) => lines.push(l))).toBe(0);
    expect(lines.at(-1)).toMatch(/^assemble-media: 6 files, \d+ bytes, into apps\/api\/dist\/media$/);
    expect(listed(join(root, "apps/api/dist/media"))).toHaveLength(6);
    const failing = mediaTree({ "media/audio/manifest.json": manifest(["audio/nope.m4a"]) });
    expect(main([`--root=${failing}`], (l) => lines.push(l))).toBe(1);
    expect(lines.at(-1)).toMatch(/^assemble-media: FAIL/);
  });
});
