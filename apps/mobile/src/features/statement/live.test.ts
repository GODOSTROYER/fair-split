import { describe, expect, it } from "vitest";
import type { StatementDTO } from "../../_shims/api-client";
import type { RunEvent } from "../../_shims/contracts";
import { capsuleFor, confirmedPayment, EMPTY_TRACK, reduceItemEvent } from "../../lib/item-status";
import { audioPlan, mergeTrack, statementSentences } from "../../lib/statement";
import { buildDemoStatement } from "../../services/demo-fixtures";
import { figureRuns, isFigure } from "../../ui/figures";
import { historyRows, lineView } from "./line-view";
import { memberEvent, railLabel, statementRail } from "./live";
import { t } from "./messages";

const dto = buildDemoStatement({ stage: "sent", now: "2026-11-01T12:00:00.000Z" });
const event = (source: string, provenance = "simulated_rail", to = "SUCCEEDED") =>
  ({
    id: "event-1",
    ws: "workspace",
    runId: dto.runId,
    type: "item.updated",
    at: "2026-11-01T12:01:00.000Z",
    actor: { kind: "paypal", id: "simulator" },
    provenance,
    payload: {
      memberNo: "M-014",
      senderItemId: dto.item?.senderItemId,
      to,
      from: "PENDING",
      source,
      eventId: "sim-webhook-1",
    },
  }) as RunEvent;

describe("inv.i8.member: served rail and forward-only item events", () => {
  it.each(["en", "ceb", "fil"] as const)(
    "%s labels post-time replay on the live stream and cold read without a payment celebration",
    (lang) => {
      const simulated = { ...dto, provenance: "simulated_rail" as const, paypalRail: "simulator" };
      const replay = memberEvent(event("status_check", "replay"));
      if (!replay || !dto.item) throw new Error("Missing replay fixture");
      const applied = reduceItemEvent(EMPTY_TRACK, replay, dto.item.senderItemId);
      expect(applied.effect).toBe("applied");
      expect(confirmedPayment(applied.track)).toBe(false);
      const refreshed = mergeTrack(applied.track, { ...dto.item, status: "SUCCESS" });
      const cold: StatementDTO = {
        ...simulated,
        provenance: "replay",
        lineState: "PAID",
        item: { ...dto.item, status: "SUCCESS" },
      };
      for (const [read, track] of [
        [simulated, refreshed],
        [cold, mergeTrack(EMPTY_TRACK, cold.item)],
      ] as const) {
        const rail = statementRail(read, lang, track);
        expect(rail.kind).toBe("replay");
        expect(rail.chip).toMatch(/replay/i);
        expect(rail.copy).toMatch(/replay/i);
        expect(rail.review).toBe(lang !== "en");
        const capsule = capsuleFor({ lineState: read.lineState, rail: read.rail, itemStatus: track.status });
        const view = lineView(read, capsule, track, lang);
        expect(view.word).toMatch(/replay/i);
        expect(view.fillsOnPress).toBe(false);
        expect(view.amountState).toBe("hollow");
        expect(view.tone).toBe("neutral");
        expect(view.sentWord).toBeNull();
        if (!view.detail) throw new Error("Replay explanation is missing");
        expect(t(lang, view.detail.key, view.detail.args)).toMatch(/replay/i);
        const paid = historyRows(read, track).find((row) => row.kind === "paid");
        expect(paid?.mark).toBe("pencil");
        if (!paid) throw new Error("Replay history is missing");
        expect(t(lang, paid.copy.key, paid.copy.args)).toMatch(/replay/i);
      }
    },
  );
  it.each(["ceb", "fil", "en"] as const)("%s labels simulation and unknown honestly", (lang) => {
    expect(railLabel("simulator", "live", lang).chip).toBe("Simulated PayPal sandbox");
    expect(railLabel(null, "simulated_rail", lang).chip).toBe("Simulated PayPal sandbox");
    expect(railLabel(null, "live", lang).kind).toBe("unknown");
    expect(railLabel(null, "replay", lang).kind).toBe("replay");
    expect(railLabel("simulator", "seeded", lang).review).toBe(lang !== "en");
  });
  it("adapts a verified simulated success once and refuses a backward event", () => {
    const served = memberEvent(event("webhook"));
    const backward = memberEvent(event("webhook", "simulated_rail", "PENDING"));
    const senderItemId = dto.item?.senderItemId;
    if (!served || !backward || !senderItemId) throw new Error("Missing item fixture");
    expect(served?.payload).toMatchObject({ status: "SUCCESS", source: "webhook" });
    const first = reduceItemEvent(EMPTY_TRACK, served, senderItemId);
    expect(first.track.status).toBe("SUCCESS");
    expect(confirmedPayment(first.track)).toBe(true);
    expect(statementRail(dto, "en", first.track).kind).toBe("simulated");
    expect(reduceItemEvent(first.track, served, senderItemId).effect).toBe("duplicate");
    expect(reduceItemEvent(first.track, { ...backward, id: "older" }, senderItemId).effect).toBe("stale");
    const staleReplay = reduceItemEvent(
      first.track,
      { ...backward, id: "old-replay", provenance: "replay" },
      senderItemId,
    );
    expect(staleReplay.effect).toBe("stale");
    expect(statementRail(dto, "en", staleReplay.track).kind).toBe("simulated");
  });
  it("never treats an unverified POST response or unknown rail as paid; permits labelled replay", () => {
    expect(memberEvent(event("post_response"))).toBeNull();
    expect(memberEvent(event("webhook", "live"))).toBeNull();
    expect(memberEvent(event("webhook", "replay"))?.payload.status).toBe("SUCCESS");
    expect(
      memberEvent({
        ...event("webhook"),
        payload: { ...(event("webhook").payload as object), eventId: null },
      }),
    ).toBeNull();
  });
});

describe("served statement words and clip hashes", () => {
  const sentence = {
    id: "BONUS.default",
    slot: "BONUS" as const,
    variant: "default",
    display: "Bonus sa kalidad: US$21.85.",
    spoken: "Exact server words",
    mentions: [],
    textSha256: "a".repeat(64),
  };
  const rendered: StatementDTO = { ...dto, rendered: { ceb: [sentence] } };
  it("reads exact server words instead of re-rendering spoken money", () => {
    expect(statementSentences(rendered, "ceb").sentences.find((s) => s.slot === "BONUS")?.spoken).toBe(
      sentence.spoken,
    );
  });
  it("keeps served money in the figure face without changing the rendered words", () => {
    const bonus = statementSentences(rendered, "ceb").sentences.find((s) => s.slot === "BONUS");
    expect(
      figureRuns(bonus?.segments ?? [])
        .filter(isFigure)
        .map((s) => s.text),
    ).toEqual(["US$21.85"]);
  });
  it.each(["matched", "mismatched", "missing"])(
    "%s clip uses device voice unless both server hashes match",
    (kind) => {
      const withAudio = {
        ...rendered,
        audio: {
          ceb: [
            {
              slot: "BONUS" as const,
              variant: "default",
              mentions: [],
              textSha256: kind === "mismatched" ? "b".repeat(64) : sentence.textSha256,
              clip:
                kind === "missing"
                  ? null
                  : {
                      slot: "BONUS" as const,
                      textSha256: kind === "mismatched" ? "b".repeat(64) : sentence.textSha256,
                      url: "/media/audio/M-014/ceb/s04-BONUS-test.m4a",
                      label: "Sintetikong tingog (Gemini TTS)",
                      durationMs: 100,
                      offsets: [],
                    },
            },
          ],
        },
      };
      const step = audioPlan(withAudio, "ceb", { deviceVoice: true }).steps.find((s) => s.slot === "BONUS");
      expect(step?.voice.kind).toBe(kind === "matched" ? "clip" : "device");
    },
  );
});
