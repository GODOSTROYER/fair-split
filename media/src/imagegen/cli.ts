import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { textLayerDocument } from "../content/br-2026-04.js";
import { EVAL_DEV_GROUPS, findAsset, SPIKE_ASSETS } from "../content/spike.js";
import type { AssetSpec } from "../content/types.js";
import {
  buildLogbookFixture,
  buildRateCardFixture,
  buildSlipFixture,
  carryOver,
  duplicateResolver,
} from "../fixtures/build.js";
import {
  type LabelledRect,
  renderCropSheet,
  renderOverlay,
  type SheetItem,
} from "../fixtures/review-sheet.js";
import {
  BEHAVIOURAL_TRAPS,
  type Fixture,
  Fixture as FixtureSchema,
  fixtureJsonSchema,
  type LogbookPageFixture,
  type RateCardPageFixture,
  SESSION_FILE,
  SLOTS,
  type SlipImageFixture,
  type Slot,
  type TrapCheck,
} from "../fixtures/schema.js";
import { syncLabels, writeLabelSchema } from "../labels/sync.js";
import { renderPrompt } from "../prompts/render.js";
import {
  ConfirmationError,
  confirmHumanReview,
  processTerminal,
  requireInteractive,
  type SessionRef,
  type TerminalIo,
} from "../review/confirm.js";
import { startReviewServer } from "../review/server.js";
import {
  findConfirmableSession,
  humanReviewBlockers,
  loadSession,
  replayReadiness,
} from "../review/session.js";
import { recordReadVerdict } from "../review/verdict.js";
import { templateDocument } from "../template/slip-template.js";
import { MEDIA_ROOT, REPO_ROOT } from "../util/env.js";
import { sha256 } from "../util/hash.js";
import { readJsonOr, writeJson } from "../util/json.js";
import { codexVersion, findGeneratedImages, runCodexExec } from "./codex.js";
import { execPrompt, parseExpectation } from "./exec.js";
import { CODEX_LEDGER_ENV, CODEX_LEDGER_FILE, CodexBudgetError, codexLedgerFor } from "./ledger.js";
import { ManifestStore, mediaRelative } from "./manifest.js";
import { applyMigration, planMigration } from "./migrate.js";
import {
  adoptAttempt,
  generateAsset,
  logPrompt,
  mapLimit,
  type PipelineDeps,
  promoteAttempt,
} from "./pipeline.js";
import { type FixtureStatus, planGeneration } from "./plan.js";
import { applyReview, fixtureFields, type ReviewFile } from "./review.js";

const USAGE = `tools/imagegen.ts — one Codex image per exec (AI-11). All output is synthetic.

  imagegen list                         status of every asset (manifest, fixture, review)
  imagegen budget                       Codex execs in the last 5 hours (at most 12) and the ledger's path
  imagegen template | textlayer | schema   write template/slip-v1.json | docs/BR-2026-04.text.json |
                                        fixtures/fixture.schema.json and eval/label.schema.json
  imagegen prompt <id...>               render prompts to media/prompts/ without generating
  imagegen gen <id...|all> [--force] [--replace-reviewed] [--max-attempts 2] [--concurrency 3] [--effort low]
                                        an asset that has a master is skipped unless --force names it;
                                        a person-reviewed master also needs --replace-reviewed
  imagegen exec <prompt-file> [--name <slug>] [--orientation portrait|landscape|any] [--size WxH]
                [--min-long-edge 1024] [--aspect 1.0-2.0|any] [--image <in.png> ...] [--out <file in media/raw/>]
                [--max-attempts 2] [--effort low]   prompt file in, verified image out (media/raw/exec/)
  imagegen trial <id...> [--n 2] [--concurrency 2]   extra generations to measure value fidelity
  imagegen adopt <id> <attempt> [--as accept|trial]  re-verify an earlier attempt without a new exec
  imagegen promote <id> <attempt> --why "<reason>"   make a successful trial the master
  imagegen migrate                      move displays to their IC-11 paths; point prompts at history copies
  imagegen fixture <id...|all> [--force] [--replace-reviewed]   draft crop fixtures + overlay and crop sheet
  imagegen apply-review <review.json>   record an agent's visual check (manifest counts, fixture values)
  imagegen review <id> --reviewer "<name>" [--port N]  a person checks every crop on 127.0.0.1, then confirms
  imagegen mark <id> --status human-reviewed --reviewer "<name>" [--session review/sessions/<file>.json]
                                        confirm at your own terminal; it stands on your saved review session
  imagegen trap-verdict <id> <slot> <WATER_STAIN|MARGIN_NOTE> --status HOLDS|FAILED --evidence <recorded read>
  imagegen replay-check <id...>         what still stops an image from joining a replay set
  imagegen labels                       write eval/labels/{case}.json (person-checked fixtures) and
                                        eval/provisional/{case}.json (agent-checked) from checked fixtures

Every exec reserves a slot in the Codex ledger first (12 per 5 hours). The ledger is one file per machine,
shared by every checkout: $${CODEX_LEDGER_ENV} if set, else $CODEX_HOME/${CODEX_LEDGER_FILE}. gen, trial
and exec retry once by default (--max-attempts 2, at most 3). Assets: ${SPIKE_ASSETS.map((a) => a.id).join(", ")}`;

function pipelineDeps(mediaRoot: string, store: ManifestStore, stamp = false): PipelineDeps {
  return {
    mediaRoot,
    store,
    codexCli: codexVersion(),
    run: runCodexExec,
    find: findGeneratedImages,
    budget: codexLedgerFor(mediaRoot),
    log: (l) => console.log(stamp ? `${new Date().toISOString().slice(11, 19)} ${l}` : l),
  };
}

const isEdit = (a: AssetSpec) => a.kind === "slip_page" && !!a.editOf;

const fixturePath = (mediaRoot: string, id: string) => join(mediaRoot, "fixtures", `${id}.json`);

async function readFixture(mediaRoot: string, id: string): Promise<Fixture | null> {
  const raw = await readJsonOr<unknown>(fixturePath(mediaRoot, id), null);
  return raw === null ? null : FixtureSchema.parse(raw);
}

async function writeFixture(mediaRoot: string, f: Fixture): Promise<void> {
  await writeJson(fixturePath(mediaRoot, f.id), FixtureSchema.parse(f));
}

/** A fixture's review status without parsing the whole file (null when there is none or it is unreadable). */
function fixtureStatusOf(mediaRoot: string, id: string): FixtureStatus {
  const path = fixturePath(mediaRoot, id);
  if (!existsSync(path)) return null;
  try {
    const status = (JSON.parse(readFileSync(path, "utf8")) as { review?: { status?: unknown } }).review
      ?.status;
    return status === "draft" || status === "agent-checked" || status === "human-reviewed" ? status : null;
  } catch {
    return null;
  }
}

async function refreshLabels(mediaRoot: string): Promise<void> {
  const r = await syncLabels(mediaRoot, SPIKE_ASSETS, EVAL_DEV_GROUPS, (id) => readFixture(mediaRoot, id));
  if (r.written.length) {
    console.log(`labels: wrote ${r.written.length} person-checked to eval/labels/ (${r.written.join(", ")})`);
  }
  if (r.provisional.length) {
    console.log(
      `labels: wrote ${r.provisional.length} agent-checked to eval/provisional/ (${r.provisional.join(", ")}); ` +
        "provisional until a person reviews them, and never in eval/labels/",
    );
  }
  if (r.removed.length) console.log(`labels: removed ${r.removed.join(", ")} (fixture back to draft)`);
  for (const [id, why] of Object.entries(r.unproven)) {
    console.error(
      `labels: ${id} says human-reviewed, but its review session does not stand behind it (${why.join("; ")}); its label stays in eval/provisional/`,
    );
  }
}

/** The overlay and crop sheet for checking a fixture: every crop beside what the prompt asked for. */
function sheetItems(f: Fixture): { overlay: LabelledRect[]; sheet: SheetItem[] } {
  if (f.kind === "rate_card_page") {
    const sheet = (f as RateCardPageFixture).blocks.map((b) => ({
      rect: b.rect,
      title: b.id,
      expected: b.text.split("\n")[0] ?? "",
    }));
    return { overlay: sheet.map((x) => ({ rect: x.rect, label: x.title })), sheet };
  }
  const sheet = [...fixtureFields(f)].map(([where, ff]) => ({
    rect: { x1: ff.x1, y1: ff.y1, x2: ff.x2, y2: ff.y2 },
    title: where,
    expected: ff.requested,
  }));
  if (f.kind === "logbook_page") {
    const lines = (f as LogbookPageFixture).lines;
    return { overlay: lines.map((l) => ({ rect: l.rect, label: `line ${l.line}` })), sheet };
  }
  return { overlay: sheet.map((x) => ({ rect: x.rect, label: x.title.split(".").pop() ?? "" })), sheet };
}

function printPlanMessages(plan: ReturnType<typeof planGeneration>): void {
  for (const s of plan.skipped) console.log(`${s.id}: skipped, ${s.reason}`);
  for (const w of plan.warnings) console.log(`warning: ${w}`);
  for (const r of plan.refused) console.error(`${r.id}: refused, ${r.reason}`);
}

export async function main(
  argv: readonly string[],
  mediaRoot = MEDIA_ROOT,
  io: TerminalIo = processTerminal(),
): Promise<number> {
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
      note: { type: "string" },
      evidence: { type: "string" },
      session: { type: "string" },
      port: { type: "string" },
      force: { type: "boolean" },
      "replace-reviewed": { type: "boolean" },
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
          `${a.id.padEnd(18)} ${a.group.padEnd(10)} ${status.padEnd(22)} image=${e?.review.status ?? "-"} fixture=${fixtureStatusOf(mediaRoot, a.id) ?? "-"}`,
        );
      }
      return 0;
    }
    case "budget": {
      const ledger = codexLedgerFor(mediaRoot);
      const s = await ledger.status();
      console.log(
        `Codex: ${s.used} of ${s.cap} execs in the last ${s.windowMs / 3_600_000} h${s.nextFreeAt ? `; next slot at ${s.nextFreeAt.toISOString()}` : ""}`,
      );
      console.log(`ledger (one per machine, every checkout): ${ledger.path}`);
      return 0;
    }
    case "template":
      await writeJson(join(mediaRoot, "template", "slip-v1.json"), templateDocument());
      console.log("wrote media/template/slip-v1.json");
      return 0;
    case "schema":
      await writeJson(join(mediaRoot, "fixtures", "fixture.schema.json"), fixtureJsonSchema());
      await writeLabelSchema(mediaRoot);
      console.log("wrote media/fixtures/fixture.schema.json and media/eval/label.schema.json");
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
      if (fixtureStatusOf(mediaRoot, id) === "human-reviewed" && !values["replace-reviewed"]) {
        console.error(
          `${id}: its fixture is human-reviewed; a new master throws that review away (add --replace-reviewed)`,
        );
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
            budget: codexLedgerFor(mediaRoot),
            log: (l) => console.log(`${new Date().toISOString().slice(11, 19)} ${l}`),
          },
        );
      } catch (e) {
        // Argument, file and budget problems are refused before an exec is spent.
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
      const all = ids[0] === "all";
      const named = all ? [...SPIKE_ASSETS] : ids.map((id) => findAsset(id));
      if (!named.length) {
        console.error("name at least one asset id");
        return 1;
      }
      let assets = named;
      if (cmd === "gen") {
        const plan = planGeneration(named, await store.read(), (id) => fixtureStatusOf(mediaRoot, id), {
          all,
          force: values.force === true,
          replaceReviewed: values["replace-reviewed"] === true,
        });
        printPlanMessages(plan);
        if (plan.refused.length) return 1;
        if (!plan.run.length) {
          console.log("nothing to generate");
          return 0;
        }
        assets = plan.run;
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
          console.error(`[${a.id}] ${e instanceof CodexBudgetError ? "stopped" : "failed"}: ${e.message}`);
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
    case "migrate": {
      const steps = planMigration(await store.read(), SPIKE_ASSETS);
      await applyMigration(mediaRoot, store, steps);
      for (const s of steps) {
        if (s.display) console.log(`${s.id}: display ${s.display.from} -> ${s.display.to}`);
        if (s.prompt) console.log(`${s.id}: prompt ${s.prompt.from} -> ${s.prompt.to}`);
      }
      console.log(steps.length ? `migrated ${steps.length} asset(s)` : "nothing to migrate");
      return 0;
    }
    case "fixture": {
      const m = await store.read();
      const assets =
        ids[0] === "all"
          ? SPIKE_ASSETS.filter((a) => m.assets[a.id]?.master)
          : ids.map((id) => findAsset(id));
      const opts = { mediaRoot, duplicateOf: duplicateResolver(SPIKE_ASSETS) };
      let failed = 0;
      for (const a of assets) {
        const entry = m.assets[a.id];
        if (!entry?.master) {
          console.error(`${a.id}: no accepted master`);
          failed++;
          continue;
        }
        const path = fixturePath(mediaRoot, a.id);
        const prev = await readJsonOr<unknown>(path, null);
        const prevStatus = fixtureStatusOf(mediaRoot, a.id);
        if (prevStatus && prevStatus !== "draft" && !values.force) {
          console.log(`${a.id}: fixture is ${prevStatus}; use --force to redraft`);
          continue;
        }
        if (prevStatus === "human-reviewed" && !values["replace-reviewed"]) {
          // A redraft sends a person's review back to draft; their readings carry over, the crops need a new look.
          console.error(`${a.id}: fixture is human-reviewed; redrafting it also needs --replace-reviewed`);
          failed++;
          continue;
        }
        try {
          const drafted: Fixture =
            a.kind === "rate_card_page"
              ? await buildRateCardFixture(a, entry, opts)
              : a.kind === "logbook_page"
                ? await buildLogbookFixture(a, entry, opts)
                : await buildSlipFixture(a, entry, opts);
          const f = carryOver(prev, drafted);
          await writeFixture(mediaRoot, f);
          const master = join(mediaRoot, entry.master.file);
          const { overlay, sheet } = sheetItems(f);
          await renderOverlay(master, overlay, join(mediaRoot, "raw", "review", `${a.id}.overlay.png`));
          await renderCropSheet(master, sheet, join(mediaRoot, "raw", "review", `${a.id}.sheet.png`));
          await store.update((mm) => {
            const e = mm.assets[a.id];
            if (e) e.fixture = `fixtures/${a.id}.json`;
          });
          console.log(`${a.id}: wrote fixtures/${a.id}.json (draft; overlay and crop sheet in raw/review/)`);
        } catch (e) {
          failed++;
          console.error(`${a.id}: ${(e as Error).message}`);
        }
      }
      await refreshLabels(mediaRoot);
      return failed ? 2 : 0;
    }
    case "apply-review": {
      const [file] = ids;
      if (!file) {
        console.error("usage: imagegen apply-review <review.json>");
        return 1;
      }
      const review = JSON.parse(await readFile(file, "utf8")) as ReviewFile;
      const r = await applyReview(store, review, {
        readFixture: (id) => readFixture(mediaRoot, id),
        writeFixture: (f) => writeFixture(mediaRoot, f),
      });
      console.log(
        `recorded ${r.images} image check(s) from ${file}; fixtures updated: ${r.fixtures.join(", ") || "none"}`,
      );
      if (r.agentChecked.length) console.log(`agent-checked now: ${r.agentChecked.join(", ")}`);
      for (const [id, paths] of Object.entries(r.unplaced))
        console.error(`${id}: no such field: ${paths.join(", ")}`);
      for (const [id, paths] of Object.entries(r.keptHuman))
        console.log(`${id}: kept a person's reading of ${paths.join(", ")}`);
      for (const id of r.skippedFixtures)
        console.log(`${id}: no fixture of this master yet (run imagegen fixture ${id})`);
      await refreshLabels(mediaRoot);
      return Object.keys(r.unplaced).length ? 2 : 0;
    }
    case "review": {
      const [id] = ids;
      if (!id || !values.reviewer) {
        console.error('usage: imagegen review <id> --reviewer "<your name>" [--port N]');
        return 1;
      }
      try {
        requireInteractive(io);
      } catch (e) {
        console.error(`review: ${(e as Error).message}`);
        return 1;
      }
      const reviewer = values.reviewer.trim();
      const server = await startReviewServer({
        mediaRoot,
        fixtureId: id,
        reviewer,
        title: findAsset(id).title,
        ...(values.port ? { port: Number(values.port) } : {}),
      });
      io.say(`Open ${server.url} in your browser (this machine only). Waiting for you to save the review...`);
      try {
        const { fixture, session, sessionFile } = await server.submitted;
        const path = mediaRelative(sessionFile, mediaRoot);
        io.say(`Saved your readings to fixtures/${id}.json and ${path}.`);
        const blockers = humanReviewBlockers(fixture);
        if (blockers.length) {
          io.say(`Not marked human-reviewed yet: ${blockers.join("; ")}`);
        } else {
          const done = await confirmHumanReview(fixture, reviewer, io, { path, record: session });
          // The confirmation goes on the session record first, then the fixture names it.
          await writeJson(sessionFile, done.session);
          await writeFixture(mediaRoot, done.fixture);
          io.say(`${id}: human-reviewed by ${reviewer} (${path}).`);
        }
      } catch (e) {
        if (!(e instanceof ConfirmationError)) throw e;
        io.say(`${id}: ${e.message}`);
      } finally {
        await server.close();
        await refreshLabels(mediaRoot);
      }
      return 0;
    }
    case "mark": {
      const [id] = ids;
      const reviewer = values.reviewer?.trim();
      if (!id || values.status !== "human-reviewed" || !reviewer) {
        console.error(
          'usage: imagegen mark <id> --status human-reviewed --reviewer "<name>" [--session review/sessions/<file>.json]  (agent-checked comes only from imagegen apply-review)',
        );
        return 1;
      }
      const f = await readFixture(mediaRoot, id);
      if (!f) {
        console.error(`${id}: no fixture`);
        return 1;
      }
      try {
        requireInteractive(io);
        // The confirmation stands on a saved session of this image by this reviewer, holding these readings.
        let ref: SessionRef | null;
        if (values.session) {
          const path = values.session.split("\\").join("/");
          if (!SESSION_FILE.test(path)) {
            throw new ConfirmationError(
              `--session names a file under review/sessions/, relative to media/: ${path}`,
            );
          }
          const record = await loadSession(mediaRoot, path);
          if (typeof record === "string") throw new ConfirmationError(record);
          ref = { path, record };
        } else {
          ref = await findConfirmableSession(mediaRoot, f, reviewer);
        }
        if (!ref) {
          throw new ConfirmationError(
            `no saved review session by ${reviewer} holds the readings of fixtures/${id}.json; run imagegen review ${id} --reviewer "${reviewer}"`,
          );
        }
        const done = await confirmHumanReview(f, reviewer, io, ref);
        await writeJson(join(mediaRoot, ref.path), done.session);
        await writeFixture(mediaRoot, done.fixture);
        console.log(`${id}: fixture marked human-reviewed by ${reviewer} (${ref.path})`);
      } catch (e) {
        if (!(e instanceof ConfirmationError)) throw e;
        console.error(`mark: ${e.message}`);
        return 1;
      }
      await refreshLabels(mediaRoot);
      return 0;
    }
    case "trap-verdict": {
      const [id, slot, trap] = ids;
      const status = values.status;
      if (
        !id ||
        !SLOTS.includes(slot as Slot) ||
        !BEHAVIOURAL_TRAPS.includes(trap as TrapCheck["trap"]) ||
        (status !== "HOLDS" && status !== "FAILED") ||
        !values.evidence
      ) {
        console.error(
          "usage: imagegen trap-verdict <id> <TL|TR|BL|BR|ONLY> <WATER_STAIN|MARGIN_NOTE> --status HOLDS|FAILED --evidence <recorded read> [--note <text>]",
        );
        return 1;
      }
      const evidence = resolve(values.evidence);
      const fromRoot = relative(REPO_ROOT, evidence);
      const rel = fromRoot.split("\\").join("/");
      // On Windows a path on another drive comes back absolute, not as "../…".
      if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot) || !existsSync(evidence)) {
        console.error(
          `trap-verdict: the evidence must be a recorded read inside the repo: ${values.evidence}`,
        );
        return 1;
      }
      const bytes = await readFile(evidence);
      if (!bytes.length) {
        console.error("trap-verdict: the evidence file is empty");
        return 1;
      }
      const f = await readFixture(mediaRoot, id);
      if (!f || (f.kind !== "slip_page" && f.kind !== "slip_photo")) {
        console.error(`${id}: no slip fixture`);
        return 1;
      }
      recordReadVerdict(f as SlipImageFixture, {
        slot: slot as Slot,
        trap: trap as TrapCheck["trap"],
        status,
        evidenceFile: rel,
        evidenceSha256: sha256(bytes),
        ...(values.note ? { note: values.note } : {}),
        at: new Date().toISOString(),
      });
      await writeFixture(mediaRoot, f);
      console.log(`${id} ${slot} ${trap}: ${status} by a recorded read (${rel})`);
      return 0;
    }
    case "replay-check": {
      let blocked = 0;
      for (const id of ids) {
        const f = await readFixture(mediaRoot, id);
        const why = f ? await replayReadiness(mediaRoot, f) : ["no fixture"];
        if (why.length) blocked++;
        console.log(
          why.length ? `${id}: not ready\n  - ${why.join("\n  - ")}` : `${id}: ready for a replay set`,
        );
      }
      return blocked ? 2 : 0;
    }
    case "labels": {
      await writeLabelSchema(mediaRoot);
      await refreshLabels(mediaRoot);
      return 0;
    }
    default:
      console.error(`unknown command "${cmd}"\n\n${USAGE}`);
      return 1;
  }
}
