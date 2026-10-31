import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../_shims/domain";
import { type AudioPlan, audioPlan, statementSentences } from "../../lib/statement";
import { buildDemoStatement } from "../../services/demo-fixtures";
import {
  canPlay,
  PAMINAWA_START,
  type PaminawaEvent,
  type PaminawaState,
  paminawaReducer,
  paminawaScreenState,
  SLOW_RATE,
} from "./paminawa-machine";

const dto = buildDemoStatement({ stage: "paid", now: "2026-10-30T09:12:00+08:00" });
const device = audioPlan(dto, "en", { deviceVoice: true });
const textOnly = audioPlan(dto, "ceb", { deviceVoice: false });

function run(plan: AudioPlan, events: PaminawaEvent[], from: PaminawaState = PAMINAWA_START): PaminawaState {
  return events.reduce((s, e) => paminawaReducer(s, e, plan), from);
}

const sourcesIndex = device.steps.findIndex((s) => s.slot === "SOURCES");

describe("Paminawa's player (M-MB-03)", () => {
  it("plays sentence by sentence, each start with a new token, and ends after the last", () => {
    const s1 = run(device, [{ type: "play" }]);
    expect(s1).toMatchObject({ status: "playing", index: 0, token: 1 });
    const s2 = run(device, [{ type: "ended", token: 1 }], s1);
    expect(s2).toMatchObject({ status: "playing", index: 1, token: 2 });
    let s = s2;
    for (let i = 1; i < device.steps.length; i++) s = run(device, [{ type: "ended", token: s.token }], s);
    expect(s.status).toBe("ended");
    expect(run(device, [{ type: "play" }], s)).toMatchObject({ status: "playing", index: 0 });
  });

  it("ignores a late callback from a sentence that was paused or restarted", () => {
    const playing = run(device, [{ type: "play" }, { type: "ended", token: 1 }]);
    const paused = run(device, [{ type: "pause" }], playing);
    expect(paused).toMatchObject({ status: "paused", index: 1 });
    expect(run(device, [{ type: "ended", token: playing.token }], paused)).toEqual(paused);
    const resumed = run(device, [{ type: "play" }], paused);
    expect(resumed).toMatchObject({ status: "playing", index: 1 });
    const restarted = run(device, [{ type: "restart" }], resumed);
    expect(restarted.token).toBe(resumed.token + 1);
    expect(run(device, [{ type: "ended", token: resumed.token }], restarted)).toEqual(restarted);
  });

  it("plays from a tapped sentence", () => {
    expect(run(device, [{ type: "play", from: sourcesIndex }])).toMatchObject({ index: sourcesIndex });
  });

  it("does nothing when no sentence can be voiced: the transcript is the statement", () => {
    expect(canPlay(textOnly)).toBe(false);
    expect(run(textOnly, [{ type: "play" }])).toEqual(PAMINAWA_START);
    expect(canPlay(device)).toBe(true);
  });

  it("skips a sentence with no voice when others have clips", () => {
    const spoken = statementSentences(dto, "ceb").sentences.map((s) => s.spoken);
    const withOne = {
      ...dto,
      audio: {
        ceb: [
          {
            url: "https://media.invalid/g.m4a",
            textSha256: sha256Hex(spoken[0] ?? ""),
            label: "x",
            slot: "GREETING" as const,
            offsets: [],
            durationMs: 4000,
          },
        ],
      },
    };
    const plan = audioPlan(withOne, "ceb", { deviceVoice: false });
    expect(plan.mode).toBe("mixed");
    const s = run(plan, [{ type: "play" }, { type: "ended", token: 1 }]);
    expect(s.status).toBe("ended");
  });

  it("lights each slip chip once, in order, as the phone's voice names it", () => {
    const at = run(device, [{ type: "play", from: sourcesIndex }]);
    const cues = device.steps[sourcesIndex]?.cues ?? [];
    const second = cues[1]?.charIndex ?? 0;
    const s = run(device, [{ type: "progress", token: at.token, charIndex: second }], at);
    expect(Object.keys(s.lit)).toEqual(["0403", "0419"]);
    expect(s.fired).toBe(2);
    const again = run(device, [{ type: "progress", token: at.token, charIndex: second }], s);
    expect(again).toEqual(s);
    const ended = run(device, [{ type: "ended", token: at.token }], s);
    expect(Object.keys(ended.lit)).toEqual(["0403", "0419", "0436", "0467"]);
    expect(ended.lit["0467"]).toBeGreaterThan(ended.lit["0403"] ?? 0);
  });

  it("names a slip again on a second reading, so its chip lifts again", () => {
    const first = run(device, [{ type: "play", from: sourcesIndex }]);
    const done = run(device, [{ type: "ended", token: first.token }], first);
    const again = run(device, [{ type: "play", from: sourcesIndex }], done);
    const named = run(device, [{ type: "progress", token: again.token, charIndex: 10_000 }], again);
    expect(named.lit["0403"]).toBeGreaterThan(done.lit["0403"] ?? 0);
  });

  it("Hinay is 0.85x and survives a language change", () => {
    const slow = run(device, [{ type: "slow", on: true }]);
    expect(slow.rate).toBe(SLOW_RATE);
    expect(SLOW_RATE).toBe(0.85);
    const reset = run(device, [{ type: "play" }, { type: "reset" }], slow);
    expect(reset).toMatchObject({ status: "idle", index: 0, rate: 0.85 });
  });
});

describe("M-MB-03 data-state", () => {
  it("names how it will read while at rest, and playing while it reads", () => {
    const base = { loaded: true, status: "idle" as const, online: true };
    expect(paminawaScreenState({ ...base, loaded: false, mode: "synthetic" })).toBe("loading");
    expect(paminawaScreenState({ ...base, mode: "synthetic" })).toBe("paused");
    expect(paminawaScreenState({ ...base, mode: "mixed" })).toBe("paused");
    expect(paminawaScreenState({ ...base, mode: "device-voice" })).toBe("device-voice");
    expect(paminawaScreenState({ ...base, mode: "filipino-audio" })).toBe("filipino-audio");
    expect(paminawaScreenState({ ...base, mode: "text-only" })).toBe("text-only");
    expect(paminawaScreenState({ ...base, online: false, mode: "device-voice" })).toBe("offline");
    expect(paminawaScreenState({ ...base, status: "playing", mode: "device-voice" })).toBe("playing");
  });
});
