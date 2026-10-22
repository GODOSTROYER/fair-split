import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { textLayerDocument } from "../content/br-2026-04.js";
import { findAsset, SPIKE_ASSETS } from "../content/spike.js";
import type { AssetSpec } from "../content/types.js";
import { buildLogbookFixture, buildRateCardFixture, buildSlipFixture } from "../fixtures/build.js";
import {
  type LabelledRect,
  renderCropSheet,
  renderOverlay,
  type SheetItem,
} from "../fixtures/review-sheet.js";
import {
  type Fixture,
  Fixture as FixtureSchema,
  fixtureJsonSchema,
  type LogbookPageFixture,
  type RateCardPageFixture,
  type SlipImageFixture,
} from "../fixtures/schema.js";
import { renderPrompt } from "../prompts/render.js";
import { templateDocument } from "../template/slip-template.js";
import { MEDIA_ROOT } from "../util/env.js";
import { readJson, readJsonOr, writeJson } from "../util/json.js";
import { codexVersion, findGeneratedImages, runCodexExec } from "./codex.js";
import { execPrompt, parseExpectation } from "./exec.js";
import { ManifestStore } from "./manifest.js";
import {
  adoptAttempt,
  generateAsset,
  logPrompt,
  mapLimit,
  type PipelineDeps,
  promoteAttempt,
} from "./pipeline.js";
import { applyReview, type ReviewFile } from "./review.js";

const USAGE = `tools/imagegen.ts — one Codex image per exec (AI-11). All output is synthetic.

  imagegen list                         status of every asset in media/manifest.json
  imagegen template                     write media/template/slip-v1.json
  imagegen textlayer                    write media/docs/BR-2026-04.text.json
  imagegen schema                       write media/fixtures/fixture.schema.json
  imagegen prompt <id...>               render prompts to media/prompts/ without generating
  imagegen gen <id...|all> [--max-attempts 2] [--concurrency 3] [--effort low]
  imagegen exec <prompt-file> [--name <slug>] [--orientation portrait|landscape|any] [--size WxH]
                [--min-long-edge 1024] [--aspect 1.0-2.0|any] [--image <in.png> ...] [--out <file in media/raw/>]
                [--max-attempts 2] [--effort low]   prompt file in, verified image out (media/raw/exec/)
  imagegen trial <id...> [--n 2] [--concurrency 2]   extra generations to measure value fidelity
  imagegen adopt <id> <attempt> [--as accept|trial]  re-verify an earlier attempt without a new exec
  imagegen promote <id> <attempt> --why "<reason>"   make a successful trial the master
  imagegen fixture <id...|all> [--force]             draft crop fixtures + review overlay and crop sheet
  imagegen mark <id> --status agent-checked|human-reviewed --reviewer "<name>" [--note "<text>"]
  imagegen apply-review <review.json>                record a visual value check in the manifest

Assets: ${SPIKE_ASSETS.map((a) => a.id).join(", ")}`;

function pipelineDeps(mediaRoot: string, store: ManifestStore, stamp = false): PipelineDeps {
  return {
    mediaRoot,
    store,
    codexCli: codexVersion(),
    run: runCodexExec,
    find: findGeneratedImages,
    log: (l) => console.log(stamp ? `${new Date().toISOString().slice(11, 19)} ${l}` : l),
  };
}

const isEdit = (a: AssetSpec) => a.kind === "slip_page" && !!a.editOf;

/** The other copy of a carbon-copied slip, for `duplicateOf` in fixtures. */
function duplicateOf(serial: string, assetId: string): string | null {
  const copies = SPIKE_ASSETS.filter(
    (a) => a.kind === "slip_page" && a.slip.serial === serial && a.id !== assetId,
  );
  return copies[0]?.id ?? null;
}

function reviewItems(f: Fixture): { overlay: LabelledRect[]; sheet: SheetItem[] } {
  switch (f.kind) {
    case "slip_photo":
    case "slip_page": {
      const sheet = (f as SlipImageFixture).slips.flatMap((s) =>
        Object.entries(s.fields).map(([name, ff]) => ({
          rect: ff.rect,
          title: `${s.position} ${s.serial} ${name}`,
          expected: ff.visible,
        })),
      );
      return { overlay: sheet.map((x) => ({ rect: x.rect, label: x.title.split(" ").pop() ?? "" })), sheet };
    }
    case "rate_card_page": {
      const sheet = (f as RateCardPageFixture).blocks.map((b) => ({
        rect: b.rect,
        title: b.id,
        expected: b.text.split("\n")[0] ?? "",
      }));
      return { overlay: sheet.map((x) => ({ rect: x.rect, label: x.title })), sheet };
    }
    case "logbook_page": {
      const lb = f as LogbookPageFixture;
      const sheet = lb.lines.flatMap((l) =>
        Object.entries(l.cells).map(([c, cell]) => ({
          rect: cell.rect,
          title: `line ${l.line} ${c}`,
          expected: cell.visible,
        })),
      );
      return { overlay: lb.lines.map((l) => ({ rect: l.rect, label: `line ${l.line}` })), sheet };
    }
  }
}

export async function main(argv: readonly string[], mediaRoot = MEDIA_ROOT): Promise<number> {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      "max-attempts": { type: "string" },
      concurrency: { type: "string" },
      effort: { type: "string" },
      n: { type: "string" },
      as: { type: "string" },
      why: { type: "string" },
      status: { type: "string" },
      reviewer: { type: "string" },
      note: { type: "string", multiple: true },
      force: { type: "boolean" },
      name: { type: "string" },
      orientation: { type: "string" },
      "min-long-edge": { type: "string" },
      aspect: { type: "string" },
      size: { type: "string" },
      image: { type: "string", multiple: true },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [cmd, ...ids] = positionals;
  if (!cmd || values.help) {
    console.log(USAGE);
    return cmd ? 0 : 1;
  }
  const store = new ManifestStore(join(mediaRoot, "manifest.json"));
  switch (cmd) {
    case "list": {
      const m = await store.read();
      for (const a of SPIKE_ASSETS) {
        const e = m.assets[a.id];
        const status = e?.master
          ? `accepted (${e.attempts.length} exec)`
          : e
            ? `no master (${e.attempts.length} exec)`
            : "not generated";
        console.log(
          `${a.id.padEnd(18)} ${status.padEnd(26)} review=${e?.review.status ?? "-"} fixture=${e?.fixture ?? "-"}`,
        );
      }
      return 0;
    }
    case "template":
      await writeJson(join(mediaRoot, "template", "slip-v1.json"), templateDocument());
      console.log("wrote media/template/slip-v1.json");
      return 0;
    case "schema":
      await writeJson(join(mediaRoot, "fixtures", "fixture.schema.json"), fixtureJsonSchema());
      console.log("wrote media/fixtures/fixture.schema.json");
      return 0;
    case "textlayer": {
      const path = join(mediaRoot, "docs", "BR-2026-04.text.json");
      const prev = await readJsonOr<{ verification?: Parameters<typeof textLayerDocument>[0] }>(path, {});
      await writeJson(
        path,
        textLayerDocument(prev.verification ?? { status: "unverified", by: null, at: null, notes: [] }),
      );
      console.log("wrote media/docs/BR-2026-04.text.json");
      return 0;
    }
    case "prompt": {
      for (const id of ids) {
        const { current } = await logPrompt(mediaRoot, id, renderPrompt(findAsset(id)));
        console.log(`wrote ${current}`);
      }
      return 0;
    }
    case "promote": {
      const [id, n] = ids;
      if (!id || !n || !values.why) {
        console.error('usage: imagegen promote <id> <attempt> --why "<reason>"');
        return 1;
      }
      await promoteAttempt(findAsset(id), pipelineDeps(mediaRoot, store), Number(n), values.why);
      return 0;
    }
    case "adopt": {
      const [id, n] = ids;
      if (!id || !n) {
        console.error("usage: imagegen adopt <id> <attempt> [--as accept|trial]");
        return 1;
      }
      await adoptAttempt(
        findAsset(id),
        pipelineDeps(mediaRoot, store),
        Number(n),
        values.as === "trial" ? "trial" : "accept",
      );
      return 0;
    }
    case "exec": {
      const [promptFile] = ids;
      if (!promptFile || ids.length > 1) {
        console.error("usage: imagegen exec <prompt-file> [options]; see imagegen --help");
        return 1;
      }
      const effort = values.effort ?? "low";
      if (effort !== "minimal" && effort !== "low" && effort !== "medium" && effort !== "high") {
        console.error(`--effort must be minimal, low, medium or high: ${effort}`);
        return 1;
      }
      let r: Awaited<ReturnType<typeof execPrompt>>;
      try {
        r = await execPrompt(
          {
            promptFile,
            ...(values.name ? { name: values.name } : {}),
            expect: parseExpectation({
              orientation: values.orientation,
              minLongEdge: values["min-long-edge"],
              aspect: values.aspect,
              size: values.size,
            }),
            inputImages: values.image ?? [],
            ...(values.out ? { out: values.out } : {}),
            ...(values["max-attempts"] ? { maxAttempts: Number(values["max-attempts"]) } : {}),
            reasoningEffort: effort,
          },
          {
            mediaRoot,
            run: runCodexExec,
            find: findGeneratedImages,
            log: (l) => console.log(`${new Date().toISOString().slice(11, 19)} ${l}`),
          },
        );
      } catch (e) {
        // Argument and file problems are refused before any exec is spent.
        console.error(`exec: ${(e as Error).message}`);
        return 1;
      }
      console.log(
        r.ok
          ? `exec:${r.name}: ok after ${r.attempts.length} exec -> media/${r.out ?? r.raw} (prompt logged at media/${r.promptLog})`
          : `exec:${r.name}: FAILED after ${r.attempts.length} exec: ${r.attempts.map((a) => a.reason).join(" | ")}`,
      );
      return r.ok ? 0 : 2;
    }
    case "gen":
    case "trial": {
      const assets = ids[0] === "all" ? [...SPIKE_ASSETS] : ids.map((id) => findAsset(id));
      if (!assets.length) {
        console.error("name at least one asset id");
        return 1;
      }
      const deps = pipelineDeps(mediaRoot, store, true);
      const effort = (values.effort ?? "low") as "minimal" | "low" | "medium" | "high";
      const concurrency = Number(values.concurrency ?? (cmd === "gen" ? 3 : 2));
      const jobs =
        cmd === "trial"
          ? assets.flatMap((a) => Array.from({ length: Number(values.n ?? 2) }, () => a))
          : assets;
      // An edit waits only when its base is generated in the same batch.
      const inBatch = new Set(jobs.map((a) => a.id));
      const waits = (a: AssetSpec) =>
        isEdit(a) && a.kind === "slip_page" && !!a.editOf && inBatch.has(a.editOf);
      const run = (a: AssetSpec) =>
        generateAsset(a, deps, {
          purpose: cmd === "trial" ? "trial" : "accept",
          reasoningEffort: effort,
          ...(values["max-attempts"] ? { maxAttempts: Number(values["max-attempts"]) } : {}),
        }).catch((e: Error) => {
          console.error(`[${a.id}] failed: ${e.message}`);
          return { id: a.id, ok: false, attempts: [] };
        });
      const results = [
        ...(await mapLimit(
          jobs.filter((a) => !waits(a)),
          concurrency,
          run,
        )),
        ...(await mapLimit(jobs.filter(waits), concurrency, run)),
      ];
      for (const r of results)
        console.log(`${r.id}: ${r.ok ? "ok" : "FAILED"} after ${r.attempts.length} exec`);
      return results.every((r) => r.ok) ? 0 : 2;
    }
    case "fixture": {
      const m = await store.read();
      const assets =
        ids[0] === "all"
          ? SPIKE_ASSETS.filter((a) => m.assets[a.id]?.master)
          : ids.map((id) => findAsset(id));
      let failed = 0;
      for (const a of assets) {
        const entry = m.assets[a.id];
        if (!entry?.master) {
          console.error(`${a.id}: no accepted master`);
          failed++;
          continue;
        }
        const path = join(mediaRoot, "fixtures", `${a.id}.json`);
        if (existsSync(path) && !values.force) {
          const prev = await readJson<Fixture>(path);
          if (prev.review.status !== "draft") {
            console.log(`${a.id}: fixture is ${prev.review.status}; use --force to redraft`);
            continue;
          }
        }
        try {
          const opts = { mediaRoot, duplicateOf };
          const f: Fixture =
            a.kind === "rate_card_page"
              ? await buildRateCardFixture(a, entry, opts)
              : a.kind === "logbook_page"
                ? await buildLogbookFixture(a, entry, opts)
                : await buildSlipFixture(a, entry, opts);
          await writeJson(path, FixtureSchema.parse(f));
          const master = join(mediaRoot, entry.master.file);
          const { overlay, sheet } = reviewItems(f);
          await renderOverlay(master, overlay, join(mediaRoot, "raw", "review", `${a.id}.overlay.png`));
          await renderCropSheet(master, sheet, join(mediaRoot, "raw", "review", `${a.id}.sheet.png`));
          await store.update((mm) => {
            const e = mm.assets[a.id];
            if (e) e.fixture = `fixtures/${a.id}.json`;
          });
          console.log(`${a.id}: wrote fixtures/${a.id}.json (+ raw/review overlay and crop sheet)`);
        } catch (e) {
          failed++;
          console.error(`${a.id}: ${(e as Error).message}`);
        }
      }
      return failed ? 2 : 0;
    }
    case "mark": {
      const [id] = ids;
      const status = values.status;
      if (!id || (status !== "agent-checked" && status !== "human-reviewed") || !values.reviewer) {
        console.error(
          'usage: imagegen mark <id> --status agent-checked|human-reviewed --reviewer "<name>" [--note "<text>"]',
        );
        return 1;
      }
      const path = join(mediaRoot, "fixtures", `${id}.json`);
      const f = await readJson<Fixture>(path);
      f.review = {
        ...f.review,
        status,
        reviewer: values.reviewer,
        reviewedAt: new Date().toISOString(),
        notes: [...f.review.notes, ...(values.note ?? [])],
      };
      await writeJson(path, FixtureSchema.parse(f));
      console.log(`${id}: fixture marked ${status} by ${values.reviewer}`);
      return 0;
    }
    case "apply-review": {
      const [file] = ids;
      if (!file) {
        console.error("usage: imagegen apply-review <review.json>");
        return 1;
      }
      const review = await readJson<ReviewFile>(file);
      const n = await applyReview(store, review);
      console.log(`recorded ${n} image check(s) from ${file}`);
      return 0;
    }
    default:
      console.error(`unknown command "${cmd}"\n\n${USAGE}`);
      return 1;
  }
}
