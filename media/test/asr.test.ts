import { describe, expect, it } from "vitest";
import { ASR_MODEL, asrPrompt, cer, normaliseForCer, spellNumerals, transcribe } from "../src/tts/asr.js";

describe("listening proxy (ASR round trip)", () => {
  it("normalises away case, punctuation, accents and pause tags", () => {
    expect(normaliseForCer("Maayong adlaw, Nang Celing. <long pause> Salamat!")).toBe(
      "maayong adlaw nang celing salamat",
    );
    expect(normaliseForCer("Pacaña")).toBe("pacana");
  });

  it("spells out numerals the ASR writes as digits (22 Oct English transcript)", () => {
    const sent =
      "Your pay this season: sixty-four dollars and forty-five cents, about four thousand and twenty-eight pesos, by PayPal.";
    const heard = "Your pay this season, $64.45, about 4,028 pesos by PayPal.";
    expect(spellNumerals("$64.45")).toBe("sixty-four dollars and forty-five cents");
    expect(spellNumerals("₱4,028")).toBe("four thousand and twenty-eight pesos");
    expect(cer(sent, heard)).toBe(0);
  });

  it("scores the character error rate against the text sent", () => {
    expect(cer("Good day, Nang Celing.", "good day nang celing")).toBe(0);
    expect(cer("abcd", "abed")).toBe(0.25);
    expect(cer("", "")).toBe(0);
    expect(cer("", "x")).toBe(1);
  });

  it("sends the WAV inline with a verbatim-transcription prompt", async () => {
    const calls: Record<string, unknown>[] = [];
    let t = 0;
    const r = await transcribe(
      {
        models: {
          generateContent: async (p) => {
            calls.push(p);
            t += 1500;
            return { text: "  Maayong adlaw.  " };
          },
        },
      },
      Buffer.from("RIFF...."),
      "ceb",
      () => t,
    );
    expect(r).toEqual({ text: "Maayong adlaw.", latencyMs: 1500 });
    expect(calls[0]?.model).toBe(ASR_MODEL);
    expect(JSON.stringify(calls[0])).toContain('"mimeType":"audio/wav"');
    expect(asrPrompt("ceb")).toMatch(/Cebuano speech verbatim/);
  });
});
