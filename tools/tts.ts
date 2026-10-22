// tools/tts.ts: Gemini TTS for member statements and narration (AI-10, S4.6), dev machine only. Thin entry
// point; the pipeline lives in media/src/tts. Run with: corepack pnpm --filter @fairsplit/media tts <command>
// (a dynamic import keeps this file valid whether the repo root is CommonJS or ESM).
void import("../media/src/tts/cli.js").then(async ({ main }) => {
  process.exitCode = await main(process.argv.slice(2));
});
