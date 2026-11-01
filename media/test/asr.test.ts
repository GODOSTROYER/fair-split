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

  it("preserves explicit leading zeros in slip identifiers digit by digit", () => {
    expect(spellNumerals("0403 0410 0000")).toBe(
      "zero four zero three zero four one zero zero zero zero zero",
    );
    expect(normaliseForCer("Slips 0403 and 0410.")).toBe("slips zero four zero three and zero four one zero");
    expect(cer("See slip zero four zero three and zero four one zero.", "See slip 0403 and 0410.")).toBe(0);
    expect(cer("zero four zero three", "403")).toBeGreaterThan(0.12);
  });

  it("separates embedded rule numerals from their letters without inventing zeros", () => {
    expect(spellNumerals("R1 R2")).toBe("R one R two");
    expect(normaliseForCer("Under R1 and R2.")).toBe("under r one and r two");
    expect(cer("Rule R one names slip zero four zero three.", "Rule R1 names slip 0403.")).toBe(0);
    expect(normaliseForCer("403")).toBe("four hundred and three");
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
