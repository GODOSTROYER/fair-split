import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { StatementDTO } from "../../_shims/api-client";
import { MEMBER_STATUS_WORDS, type RunEvent } from "../../_shims/contracts";
import { capsuleFor, EMPTY_TRACK } from "../../lib/item-status";
import { mergeTrack } from "../../lib/statement";
import { buildDemoStatement, DEMO_STAGES } from "../../services/demo-fixtures";
import { lineView } from "./line-view";
import { applyStatementItemEvent, payoutStatus } from "./live";
import { t } from "./messages";
import { previewLine } from "./preview";

describe("inv.i8.mobile replay status sweep", () => {
  it.each(["en", "ceb", "fil"] as const)(
    "%s keeps co-op checking, held and excluded decisions current",
    (lang) => {
      for (const lineState of ["HELD", "READY", "COMPUTED", "EXCLUDED"] as const) {
        const dto: StatementDTO = {
          ...buildDemoStatement({ stage: "checking", now: "2026-11-04T00:00:00Z" }),
          provenance: "replay",
          lineState,
          item: null,
        };
        const v = lineView(
          dto,
          capsuleFor({ lineState, rail: "PAYPAL", itemStatus: null }),
          EMPTY_TRACK,
          lang,
        );
        expect(v.word).not.toMatch(/replay/i);
        expect(v.detail?.key).not.toBe("M-MB-01.replayed");
      }
    },
  );

  it.each(["en", "ceb", "fil"] as const)(
    "%s sweeps every Member state on replay and live fixtures",
    (lang) => {
      const paid = buildDemoStatement({ stage: "paid", now: "2026-11-04T00:00:00Z" });
      const fixtures = [
        ...DEMO_STAGES.map((stage) => buildDemoStatement({ stage, now: "2026-11-04T00:00:00Z" })),
        ...["HELD", "EXCLUDED", "PAYPAL_HELD", "NEEDS_ACTION", "REVERSED", "RETURNED"].map((state) =>
          previewLine(paid, state),
        ),
      ];
      for (const original of fixtures) {
        for (const provenance of ["replay", "simulated_rail"] as const) {
          const dto = { ...original, provenance, paypalRail: "simulator" };
          const track = mergeTrack(EMPTY_TRACK, dto.item);
          const capsule = capsuleFor({ lineState: dto.lineState, rail: dto.rail, itemStatus: track.status });
          const v = lineView(dto, capsule, track, lang);
          const paypalStatus = !["checking", "held-line", "excluded", "cash-due", "cash-received"].includes(
            capsule,
          );
          if (provenance === "replay" && paypalStatus) {
            expect(v.word).toMatch(/replay/i);
            expect(v.tone).toBe("neutral");
            expect(v.amountState).not.toBe("landed");
            expect(v.fillsOnPress).toBe(false);
            expect(v.sentWord).toBeNull();
            if (!v.detail) throw new Error("Missing replay explanation");
            expect(t(lang, v.detail.key, v.detail.args)).toMatch(/simulated PayPal sandbox/i);
          } else expect(v.word).not.toMatch(/replay/i);
        }
      }
    },
  );

  it.each(["en", "ceb", "fil"] as const)(
    "%s keeps Clerk cash and Chair approval semantics outside PayPal settlement",
    (lang) => {
      for (const status of ["HELD", "EXCLUDED", "OFF_RAIL_DUE", "OFF_RAIL_PAID"] as const) {
        for (const provenance of ["replay", "simulated_rail"] as const) {
          const projection = payoutStatus(
            {
              status,
              statusWord: MEMBER_STATUS_WORDS[status][lang],
              amountState: status === "OFF_RAIL_PAID" ? "attested" : "ink",
              paypal: false,
              evidence: [provenance],
            },
            lang,
          );
          expect(projection.replayed).toBe(false);
          expect(projection.tone).not.toBe("landed");
          expect(projection.amountState).not.toBe("landed");
          expect(projection.statusWord).not.toMatch(/replay/i);
        }
      }
    },
  );

  it("the actual store reducer preserves replay evidence with a stale simulated DTO and never emits MM-1's paid signal", () => {
    const dto = {
      ...buildDemoStatement({ stage: "sent", now: "2026-11-04T00:00:00Z" }),
      provenance: "simulated_rail" as const,
    };
    if (!dto.item) throw new Error("Missing item");
    const event = {
      id: "replay-success",
      type: "item.updated",
      at: "2026-11-04T00:00:00Z",
      provenance: "replay",
      payload: {
        senderItemId: dto.item.senderItemId,
        memberNo: dto.member.memberNo,
        source: "status_check",
        to: "SUCCESS",
      },
    } as RunEvent;
    const next = applyStatementItemEvent(EMPTY_TRACK, event, dto.item.senderItemId, 100, false);
    expect(next.effect).toBe("applied");
    expect(next.paid).toBeNull();
    const v = lineView(dto, "paid", next.track, "en");
    expect(v.replayed).toBe(true);
    expect(v.word).toMatch(/replay/i);
    expect(v.simulatedLabel).toBe("Simulated PayPal sandbox");
    expect(v.fillsOnPress).toBe(false);
    const live = applyStatementItemEvent(
      EMPTY_TRACK,
      {
        ...event,
        id: "live-success",
        provenance: "simulated_rail",
        payload: {
          senderItemId: dto.item.senderItemId,
          memberNo: dto.member.memberNo,
          to: "SUCCESS",
          source: "webhook",
          eventId: "verified-simulated-event",
        },
      } as RunEvent,
      dto.item.senderItemId,
      101,
      false,
    );
    expect(live.paid).toEqual({ eventId: "live-success", at: event.at, receivedAt: 101 });
    expect(lineView(dto, "paid", live.track, "en").word).not.toMatch(/replay/i);
  });

  it("screens consume the tested projection and store gate, including the replay MM-1 guard", () => {
    const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
    expect(source("./statement-store.tsx")).toContain("applyStatementItemEvent(");
    expect(source("./bayad-screen.tsx")).toContain("view.replayed ? null : st.paid");
    expect(source("./bayad-screen.tsx")).toContain("railLabel.chip");
    expect(source("../clerk/cash-plate.tsx")).toContain("payoutStatus(");
    for (const screen of ["../board/cosign-screen.tsx", "../board/sign-screen.tsx"]) {
      expect(source(screen)).toContain("railLabel(");
    }
  });
});
