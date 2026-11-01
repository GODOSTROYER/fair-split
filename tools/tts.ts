// tools/tts.ts: Gemini TTS for member statements and narration (AI-10, S4.6), dev machine only. Thin entry
// point; the pipeline lives in media/src/tts. Run with: corepack pnpm --filter @fairsplit/media tts <command>
// (a dynamic import keeps this file valid whether the repo root is CommonJS or ESM).
// main never throws: it prints a failure as one line scrubbed of every key. Anything that still escapes (a
// failed import) is printed the same way, never as a raw error with its stack, which could name a key.
void import("../media/src/tts/cli.js")
  .then(async ({ main }) => {
    process.exitCode = await main(process.argv.slice(2));
  })
  .catch(async (e: unknown) => {
    process.exitCode = 1;
    const line = await import("../media/src/tts/keys.js")
      .then(({ describeError, keysForScrubbing }) => describeError(e, keysForScrubbing()))
      .catch(() => `${e instanceof Error ? e.name : typeof e} (message withheld: the scrubber did not load)`);
    console.error(`tts: ${line}`);
  });
