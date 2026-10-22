import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { MemorySpendMeter } from "./budget.js";
import { GatewayError } from "./errors.js";
import { staticFlags } from "./flags.js";
import { ClaudeGateway, measureInput } from "./gateway.js";
import { inputShaOf } from "./key.js";
import { FALLBACK_BETA } from "./request.js";
import { Semaphore } from "./semaphore.js";
import { FsReplayStore, MemoryCallLedger, MemoryReplayStore } from "./store.js";
import { jsonOutputFormat, parseStructured } from "./structured.js";
import { fakeMessage, JSON_HEADERS, SSE_HEADERS, sseBody } from "./test-helpers.js";
import type { GatewayCall } from "./types.js";
import { warmStructuredOutputs } from "./warm.js";

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const FILES_URL = "https://api.anthropic.com/v1/files";

interface Captured {
  body: Record<string, unknown>;
  headers: Headers;
}
const captured: Captured[] = [];
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  captured.length = 0;
});
afterAll(() => server.close());

const Answer = z.strictObject({ verdict: z.enum(["YES", "NO"]), note: z.string() });
const format = jsonOutputFormat(Answer);

function baseCall(over: Partial<GatewayCall> = {}): GatewayCall {
  return {
    purpose: "classify",
    model: "claude-sonnet-5-5",
    effort: "low",
    variant: "-",
    promptV: "test.v1",
    schemaV: "answer.v1",
    inputSha: inputShaOf({ q: "is it?" }),
    mode: "auto",
    stream: false,
    maxTokens: 1500,
    budget: "daily",
    body: {
      system: [{ type: "text", text: "You answer.", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "is it?" }],
    },
    format,
    ...over,
  };
}

function respondJson(
  message = fakeMessage({ text: '{"verdict":"YES","note":"ok"}', model: "claude-sonnet-5-5" }),
) {
  server.use(
    http.post(MESSAGES_URL, async ({ request }) => {
      captured.push({ body: (await request.json()) as Record<string, unknown>, headers: request.headers });
      return HttpResponse.json(message, { headers: JSON_HEADERS });
    }),
  );
}

function respondSse(text: string, opts: Parameters<typeof sseBody>[1] = {}) {
  server.use(
    http.post(MESSAGES_URL, async ({ request }) => {
      captured.push({ body: (await request.json()) as Record<string, unknown>, headers: request.headers });
      return new HttpResponse(sseBody(text, opts), { headers: SSE_HEADERS });
    }),
  );
}

let store: MemoryReplayStore;
let ledger: MemoryCallLedger;
function gateway(over: Partial<ConstructorParameters<typeof ClaudeGateway>[0]> = {}) {
  return new ClaudeGateway({
    store,
    ledger,
    apiKey: "test-key",
    maxRetries: 0,
    flags: staticFlags({}),
    spend: new MemorySpendMeter(),
    semaphore: new Semaphore(6),
    ...over,
  });
}

beforeEach(() => {
  store = new MemoryReplayStore();
  ledger = new MemoryCallLedger();
});

describe("ClaudeGateway: live then replay", () => {
  it("records a live call and replays it without HTTP", async () => {
    respondJson();
    const gw = gateway();
    const live = await gw.call(baseCall());
    expect(live.provenance).toBe("live");
    expect(live.modelServed).toBe("claude-sonnet-5-5");
    expect(live.costMicros).toBe(1000 * 2 + 200 * 10);
    expect(captured).toHaveLength(1);
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({ accepted: true, cost_micros: 4000, purpose: "classify" });
    expect(parseStructured(live.message, Answer, format)).toEqual({ verdict: "YES", note: "ok" });

    const again = await gw.call(baseCall());
    expect(again.provenance).toBe("replay");
    expect(again.costMicros).toBe(0);
    expect(again.recordedCostMicros).toBe(4000);
    expect(again.cacheKey).toBe(live.cacheKey);
    expect(captured).toHaveLength(1);
  });

  it("flags prompt drift when a frozen prompt was edited in place", async () => {
    respondJson();
    const gw = gateway();
    await gw.call(baseCall({ promptSha: "a".repeat(64) }));
    expect((await gw.call(baseCall({ promptSha: "a".repeat(64) }))).promptDrift).toBe(false);
    expect((await gw.call(baseCall({ promptSha: "b".repeat(64) }))).promptDrift).toBe(true);
    expect(captured).toHaveLength(1);
  });

  it("keys on {imageSha, variant, promptV, schemaV, model, effort} only", () => {
    const k = ClaudeGateway.keyOf(baseCall());
    expect(ClaudeGateway.keyOf(baseCall({ maxTokens: 99, purpose: "screen" }))).toBe(k);
    expect(ClaudeGateway.keyOf(baseCall({ promptV: "test.v2" }))).not.toBe(k);
    expect(ClaudeGateway.keyOf(baseCall({ effort: "medium" }))).not.toBe(k);
    expect(ClaudeGateway.keyOf(baseCall({ variant: "A" }))).not.toBe(k);
    expect(ClaudeGateway.keyOf(baseCall({ model: "claude-opus-5-5" }))).not.toBe(k);
  });

  it("live_only skips the recording and never replaces it", async () => {
    respondJson();
    const gw = gateway();
    const first = await gw.call(baseCall());
    respondJson(fakeMessage({ text: '{"verdict":"NO","note":"later"}', model: "claude-sonnet-5-5" }));
    const live = await gw.call(baseCall({ mode: "live_only" }));
    expect(live.provenance).toBe("live");
    expect(parseStructured(live.message, Answer).verdict).toBe("NO");
    const stored = await store.get(first.cacheKey);
    expect(parseStructured(stored?.message ?? fakeMessage({ text: "{}" }), Answer).verdict).toBe("YES");
  });
});

describe("ClaudeGateway: request rules (S4.1 step 5)", () => {
  it("always sets effort and never sends sampling, thinking budgets or forced tool_choice", async () => {
    respondJson();
    await gateway().call(baseCall());
    const body = captured[0]?.body ?? {};
    expect(body.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    for (const k of ["temperature", "top_p", "top_k", "tool_choice", "thinking", "budget_tokens"]) {
      expect(body).not.toHaveProperty(k);
    }
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBe(1500);
  });

  it("adds fallbacks: default with the 2026-07-01 beta for Opus and Sonnet", async () => {
    respondJson();
    await gateway().call(baseCall());
    expect(captured[0]?.body.fallbacks).toBe("default");
    expect(captured[0]?.headers.get("anthropic-beta") ?? "").toContain(FALLBACK_BETA);
  });

  it("never adds fallbacks for Haiku (no server-side fallback)", async () => {
    respondJson(fakeMessage({ text: '{"verdict":"NO","note":""}', model: "claude-haiku-5-5" }));
    await gateway().call(baseCall({ model: "claude-haiku-5-5", purpose: "screen" }));
    expect(captured[0]?.body).not.toHaveProperty("fallbacks");
    expect(captured[0]?.headers.get("anthropic-beta") ?? "").not.toContain("server-side-fallback");
  });

  it.each([
    ["temperature", { temperature: 0 }],
    ["thinking", { thinking: { type: "disabled" } }],
    ["tool_choice", { tool_choice: { type: "tool", name: "x" } }],
    ["model", { model: "claude-fable-5-1" }],
  ])("rejects a body carrying %s before any HTTP", async (_name, extra) => {
    const call = baseCall();
    const body = { ...call.body, ...extra } as GatewayCall["body"];
    await expect(gateway().call({ ...call, body })).rejects.toMatchObject({ code: "AI_REQUEST_RULE" });
    expect(captured).toHaveLength(0);
  });

  it("rejects a model with no role", async () => {
    const call = { ...baseCall(), model: "claude-fable-5-1" } as unknown as GatewayCall;
    await expect(gateway().call(call)).rejects.toMatchObject({ code: "AI_BAD_CALL" });
  });
});

describe("ClaudeGateway: kill switch, replay_only, budget", () => {
  it("kill_ai_live blocks live calls but not replays", async () => {
    respondJson();
    await gateway().call(baseCall());
    const killed = gateway({ flags: staticFlags({ kill_ai_live: true }) });
    await expect(killed.call(baseCall({ promptV: "test.v9" }))).rejects.toMatchObject({
      code: "AI_LIVE_DISABLED",
      details: { reason: "kill_switch" },
    });
    expect((await killed.call(baseCall())).provenance).toBe("replay");
    expect(captured).toHaveLength(1);
  });

  it("replay_only with no recording throws AI_LIVE_DISABLED", async () => {
    await expect(gateway().call(baseCall({ mode: "replay_only" }))).rejects.toMatchObject({
      code: "AI_LIVE_DISABLED",
      details: { reason: "replay_only" },
    });
    expect(captured).toHaveLength(0);
  });

  it("throws AI_BUDGET when the estimate would pass the cap", async () => {
    respondJson();
    const gw = gateway({ caps: { daily: 0.01 } });
    await expect(gw.call(baseCall({ maxTokens: 1500 }))).rejects.toMatchObject({ code: "AI_BUDGET" });
    expect(captured).toHaveLength(0);
  });

  it("meters settled spend so later calls see it", async () => {
    respondJson();
    const spend = new MemorySpendMeter();
    const gw = gateway({ spend, caps: { eval: 0.05 } });
    await gw.call(baseCall({ budget: "eval", budgetScope: "run-1", maxTokens: 100 }));
    expect(await spend.spent("eval:run-1")).toBe(4000);
    await expect(gw.call(baseCall({ budget: "eval", maxTokens: 100, promptV: "x" }))).rejects.toMatchObject({
      code: "AI_BAD_CALL",
    });
  });
});

describe("ClaudeGateway: stop reasons and failures", () => {
  it("a max_tokens stop is a typed failure, recorded, and replays as the same failure", async () => {
    respondJson(fakeMessage({ text: '{"verdict":', model: "claude-sonnet-5-5", stopReason: "max_tokens" }));
    const gw = gateway();
    const first = await gw.call(baseCall()).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(GatewayError);
    expect(first).toMatchObject({ code: "AI_STOP_REASON", details: { stopReason: "max_tokens" } });
    expect(ledger.rows[0]?.accepted).toBe(false);
    const replayed = await gw.call(baseCall()).catch((e: unknown) => e);
    expect(replayed).toMatchObject({ code: "AI_STOP_REASON" });
    expect(captured).toHaveLength(1);
  });

  it("a refusal can be accepted by a caller that treats it as an answer", async () => {
    respondJson(fakeMessage({ text: "", model: "claude-haiku-5-5", stopReason: "refusal" }));
    const r = await gateway().call(
      baseCall({ model: "claude-haiku-5-5", acceptStopReasons: ["end_turn", "refusal"] }),
    );
    expect(r.stopReason).toBe("refusal");
  });

  it("maps an upstream 500 to AI_UPSTREAM and logs a failed ledger row", async () => {
    server.use(
      http.post(MESSAGES_URL, () =>
        HttpResponse.json({ type: "error", error: { type: "api_error", message: "boom" } }, { status: 500 }),
      ),
    );
    await expect(gateway().call(baseCall())).rejects.toMatchObject({
      code: "AI_UPSTREAM",
      details: { status: 500 },
    });
    expect(ledger.rows[0]).toMatchObject({ accepted: false });
    expect(ledger.rows[0]?.error).toContain("AI_UPSTREAM");
  });
});

describe("ClaudeGateway: streaming", () => {
  const json = '{"verdict":"NO","note":"streamed answer"}';

  it("emits growing snapshots, records the timeline, and replays the same snapshots", async () => {
    respondSse(json);
    const gw = gateway();
    const live: string[] = [];
    const r = await gw.call(baseCall({ stream: true, onSnapshot: (s) => live.push(s) }));
    expect(live.at(-1)).toBe(json);
    expect(live.length).toBeGreaterThan(3);
    expect(parseStructured(r.message, Answer).note).toBe("streamed answer");
    const rec = await store.get(r.cacheKey);
    expect(rec?.replay_timeline.map((e) => e.d).join("")).toBe(json);
    expect(rec?.first_delta_ms).not.toBeNull();

    const replayed: string[] = [];
    const again = await gw.call(baseCall({ stream: true, onSnapshot: (s) => replayed.push(s) }));
    expect(again.provenance).toBe("replay");
    expect(replayed).toEqual(live);
  });

  it("paces a replay at the recorded offsets divided by the speed factor", async () => {
    respondSse(json);
    const waits: number[] = [];
    const gw = gateway({ sleep: async (ms) => void waits.push(ms) });
    await gw.call(baseCall({ stream: true }));
    const rec = [...store.records.values()][0];
    if (!rec) throw new Error("no recording");
    rec.replay_timeline = rec.replay_timeline.map((e, i) => ({ ...e, ms: (i + 1) * 100 }));
    await gw.call(baseCall({ stream: true, replaySpeed: 4 }));
    expect(waits.reduce((a, b) => a + b, 0)).toBeCloseTo(rec.replay_timeline.length * 25, 5);
  });

  it("a mid-stream fallback resets the snapshot and the answer is the text after the fallback block", async () => {
    respondSse(json, {
      fallback: { from: "claude-opus-5-5", to: "claude-opus-5", partialText: '{"verdict":"Y' },
      usageExtra: {
        iterations: [
          {
            type: "message",
            model: "claude-opus-5-5",
            input_tokens: 1000,
            output_tokens: 5,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          {
            type: "fallback_message",
            model: "claude-opus-5",
            input_tokens: 1000,
            output_tokens: 200,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        ],
      },
      model: "claude-opus-5",
    });
    let resets = 0;
    const snaps: string[] = [];
    const r = await gateway().call(
      baseCall({
        model: "claude-opus-5-5",
        stream: true,
        onReset: () => resets++,
        onSnapshot: (s) => snaps.push(s),
      }),
    );
    expect(resets).toBe(1);
    expect(snaps).toContain("");
    expect(r.fallbackServed).toBe(true);
    expect(r.modelServed).toBe("claude-opus-5");
    expect(r.costMicros).toBe(1000 * 4 + 5 * 20 + 1000 * 5 + 200 * 25);
    expect(parseStructured(r.message, Answer).verdict).toBe("NO");
  });
});

describe("ClaudeGateway: recordings on disk and scrubbing", () => {
  it("stores scrubbed recordings once per key and ignores its own .cache dir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fs-gw-"));
    try {
      const cache = join(dir, ".cache", "recordings");
      // Built at runtime so the secret guard never sees a key-shaped literal in source.
      const leak = ["sk", "ant", "api03", "abcdefghijklmnopqrstuvwxyz0123456789"].join("-");
      respondJson(
        fakeMessage({
          text: `{"verdict":"YES","note":"${leak} mail me@example.com"}`,
          model: "claude-sonnet-5-5",
        }),
      );
      const fsStore = new FsReplayStore(cache);
      const r = await gateway({ store: fsStore }).call(baseCall());
      const text = await readFile(join(cache, `${r.cacheKey}.json`), "utf8");
      expect(text).not.toContain(leak);
      expect(text).not.toContain("me@example.com");
      expect(text).toContain("REDACTED");
      const stored = await fsStore.get(r.cacheKey);
      if (!stored) throw new Error("recording missing");
      expect(await fsStore.put(stored)).toBe("exists");
      expect(await readFile(join(dir, ".cache", ".gitignore"), "utf8")).toContain("*");
      expect(await readdir(join(dir, ".cache"))).toContain("recordings");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("ClaudeGateway: Files API", () => {
  it("uploads each distinct image once and sends file_id references", async () => {
    const png = await sharp({ create: { width: 56, height: 28, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    let uploads = 0;
    server.use(
      http.post(FILES_URL, () => {
        uploads++;
        return HttpResponse.json({
          id: "file_abc",
          type: "file",
          filename: "x.png",
          mime_type: "image/png",
          size_bytes: png.length,
          created_at: "2026-10-23T00:00:00Z",
        });
      }),
    );
    respondJson();
    const image = {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: png.toString("base64") },
      transformations: { oversized_image: "error" },
    };
    const gw = gateway({ filesApi: true });
    const body = {
      system: "s",
      messages: [{ role: "user", content: [image, { type: "text", text: "read" }] }],
    };
    await gw.call(baseCall({ body, inputSha: inputShaOf("img-1") }));
    respondJson();
    await gw.call(baseCall({ body, inputSha: inputShaOf("img-2") }));
    expect(uploads).toBe(1);
    const messages = (captured[0]?.body.messages ?? []) as Array<{ content: Array<Record<string, unknown>> }>;
    const sent = messages[0]?.content[0];
    expect(sent).toMatchObject({
      type: "image",
      source: { type: "file", file_id: "file_abc" },
      transformations: { oversized_image: "error" },
    });
  });
});

describe("measureInput", () => {
  it("counts visual tokens from base64 images and characters from text", async () => {
    const png = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    const m = await measureInput({
      system: [{ type: "text", text: "abcd" }],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: png.toString("base64") },
            },
            { type: "text", text: "12345678" },
          ],
        },
      ],
    });
    expect(m).toEqual({ visualTokens: 2035, characters: 12 });
  });
});

describe("warmStructuredOutputs (S4.9 warmCaches)", () => {
  it("makes one live call per schema, never records, and tolerates max_tokens", async () => {
    respondJson(fakeMessage({ text: '{"verdict":', model: "claude-sonnet-5-5", stopReason: "max_tokens" }));
    const gw = gateway();
    const out = await warmStructuredOutputs(gw, [
      { name: "answer", model: "claude-sonnet-5-5", effort: "low", schemaV: "answer.v1", format },
      { name: "answer2", model: "claude-sonnet-5-5", effort: "low", schemaV: "answer.v2", format },
    ]);
    expect(out.map((o) => [o.name, o.ok])).toEqual([
      ["answer", true],
      ["answer2", true],
    ]);
    expect(captured).toHaveLength(2);
    expect(store.records.size).toBe(0);
    expect(captured[0]?.body).toMatchObject({
      max_tokens: 400,
      output_config: { effort: "low", format: { type: "json_schema" } },
    });
  });
});
