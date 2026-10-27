// tools/imagegen.ts: one Codex image per `codex exec` (AI-11, S4.10). Thin entry point; the pipeline lives in
// media/src/imagegen. Run with: corepack pnpm --filter @fairsplit/media imagegen <command>
// (a dynamic import keeps this file valid whether the repo root is CommonJS or ESM).
void import("../media/src/imagegen/cli.js").then(async ({ main }) => {
  process.exitCode = await main(process.argv.slice(2));
});
