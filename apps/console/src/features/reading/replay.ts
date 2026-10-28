// Mock-only: the recorded reading, replayed on this page. fs-api streams the recorded run's `extract.row` events
// (MM-2's trigger) into the run; api-client's mock does not yet (requested from WS-API: the 48 rows plus slip
// 0449's quarantine, built by ./replay-fixture.ts). Without them the mock's run reaches its lines in about a
// second and the rows only appear from the seed, so MM-2 can't be judged at all. While the console runs on the
// mock (`adapter.source === "mock"`), the reading room offers this replay: it feeds the recording's events, at
// the pace of the recording's replay (48 rows inside 12 s), through the same handler live events take, and
// folds them into a copy of the run that only this page shows. Everything it draws is labelled a replay of
// mock data; it never runs against fs-api, and it never touches the run the rest of the stage reads.

import type { RunEvent, SeasonSnapshot } from "@fairsplit/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdapter } from "../../data/hooks.js";
import { applyRunEvents, type RunView } from "../../data/run-view.js";
import { extractRowEvent, quarantineEvent, replayRows } from "./replay-fixture.js";

/** S1.7: "The 48 replayed rows land within 12 s." One event every 240 ms lands the 48th at 11.3 s. */
export const REPLAY_GAP_MS = 240;

/** The replay's pace, read when it starts (a test can slow it so each row's act completes before the next). */
export const replayTiming = { gapMs: REPLAY_GAP_MS };

/** The recording's events in replay order: photos A to L, slip by slip, slip 0449's quarantine after its row. */
export function recordedEvents(snapshot: SeasonSnapshot, nonce: string, at: () => string): RunEvent[] {
  const rows = replayRows(snapshot);
  const quarantine = snapshot.quarantineNotices[0];
  const events: RunEvent[] = [];
  const stamp = () => ({
    id: `${nonce}-${String(events.length + 1).padStart(3, "0")}`,
    at: at(),
    ws: "replay",
    runId: null,
  });
  for (const row of rows) {
    events.push(extractRowEvent(row, stamp(), "seeded"));
    if (quarantine && row.serial === quarantine.serial && row.photoId === quarantine.photoId) {
      const q = quarantineEvent(snapshot, stamp(), "seeded");
      if (q) events.push(q);
    }
  }
  return events;
}

/** The run as this page shows it while a replay plays: its rows are the replay's, read so far. */
export function replayView(view: RunView, delivered: readonly RunEvent[], running: boolean): RunView {
  const base: RunView = {
    ...view,
    state: running ? "EXTRACTING" : view.state,
    rows: [],
    quarantined: [],
    lastEventId: null,
  };
  return applyRunEvents(base, delivered);
}

export interface RecordedReplay {
  /** The console runs on the mock: the replay is offered. */
  readonly available: boolean;
  /** A replay has started on this page (running or finished). */
  readonly active: boolean;
  readonly running: boolean;
  readonly delivered: readonly RunEvent[];
  readonly rows: number;
  readonly total: number;
  start(): void;
  stop(): void;
}

export function useRecordedReplay(
  snapshot: SeasonSnapshot,
  onEvent: (event: RunEvent) => void,
): RecordedReplay {
  const adapter = useAdapter();
  const available = adapter.source === "mock";
  const [events, setEvents] = useState<readonly RunEvent[] | null>(null);
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(onEvent);
  latest.current = onEvent;

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  const start = useCallback(() => {
    if (!available) return;
    clear();
    // A fresh nonce per replay: MM-2 plays each event's evidence once, so a second replay needs new IDs.
    const nonce = `R${Date.now().toString(36)}`;
    const all = recordedEvents(snapshot, nonce, () => new Date().toISOString());
    setEvents(all);
    setCount(0);
    const gap = replayTiming.gapMs;
    let next = 0;
    // The stand-in for the server's stream: one recorded event per gap, each through the live handler.
    const deliver = () => {
      const event = all[next];
      if (!event) {
        timer.current = null;
        return;
      }
      next += 1;
      setCount(next);
      latest.current(event);
      timer.current = setTimeout(deliver, gap);
    };
    deliver();
  }, [available, clear, snapshot]);

  const stop = useCallback(() => {
    clear();
    setEvents(null);
    setCount(0);
  }, [clear]);

  return useMemo(() => {
    const delivered = events ? events.slice(0, count) : [];
    return {
      available,
      active: events !== null,
      running: events !== null && count < events.length,
      delivered,
      rows: delivered.filter((e) => e.type === "extract.row").length,
      total: events ? events.filter((e) => e.type === "extract.row").length : 0,
      start,
      stop,
    };
  }, [available, count, events, start, stop]);
}
