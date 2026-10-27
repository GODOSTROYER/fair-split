// One SSE connection per run, shared by every screen and the stage (S3.7 caps streams per credential). The
// hub reduces each event into the run's query data, so all surfaces see the same state at once (C-05),
// and hands the raw event to listeners, flagged when it is a replay: data-state changes for replays too,
// but only live events may start a moment (motion is evidence, not history).

import type { RunEvent } from "@fairsplit/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { StreamStatus } from "./adapter.js";
import { queryKeys, type RunViewDeps, runViewQuery } from "./query.js";
import { applyRunEvent, type RunView } from "./run-view.js";

export interface EventMeta {
  /** True when the event was committed before this page subscribed (SSE replay): show it, don't animate it. */
  readonly replay: boolean;
}

export type RunEventListener = (event: RunEvent, meta: EventMeta) => void;

interface Channel {
  refs: number;
  /** Bumped whenever the stream closes, so an open still awaiting its base gives up. */
  generation: number;
  status: StreamStatus;
  stop: (() => void) | null;
  readonly listeners: Set<RunEventListener>;
  readonly statusListeners: Set<() => void>;
  subscribedAt: number;
}

const IDLE: StreamStatus = { kind: "closed", reason: "unsubscribed" };

/** Events older than this before the subscription count as replay (clock skew allowance). */
export const REPLAY_SKEW_MS = 1500;

export class StreamHub {
  private readonly channels = new Map<string, Channel>();

  private readonly client: QueryClient;

  constructor(
    private readonly deps: RunViewDeps,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.client = deps.client;
  }

  private channel(runSlug: string): Channel {
    let channel = this.channels.get(runSlug);
    if (!channel) {
      channel = {
        refs: 0,
        generation: 0,
        status: IDLE,
        stop: null,
        listeners: new Set(),
        statusListeners: new Set(),
        subscribedAt: 0,
      };
      this.channels.set(runSlug, channel);
    }
    return channel;
  }

  private setStatus(channel: Channel, status: StreamStatus): void {
    channel.status = status;
    for (const listener of channel.statusListeners) listener();
  }

  /** Holds the run's stream open while at least one caller needs it. Returns the release function. */
  acquire(runSlug: string): () => void {
    const channel = this.channel(runSlug);
    channel.refs += 1;
    if (channel.refs === 1) void this.open(runSlug, channel, channel.generation);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      channel.refs -= 1;
      if (channel.refs === 0) {
        channel.generation += 1;
        channel.stop?.();
        channel.stop = null;
      }
    };
  }

  private async open(runSlug: string, channel: Channel, generation: number): Promise<void> {
    this.setStatus(channel, { kind: "connecting" });
    let base: RunView;
    try {
      base = await this.client.ensureQueryData(runViewQuery(this.deps, runSlug));
    } catch {
      if (generation === channel.generation) this.setStatus(channel, { kind: "closed", reason: "not-found" });
      return;
    }
    if (channel.refs === 0 || generation !== channel.generation) return;
    channel.subscribedAt = this.now();
    channel.stop = this.deps.adapter.subscribe(
      { kind: "run", runSlug },
      {
        onEvent: (event) => this.deliver(runSlug, channel, event),
        onStatus: (status) => this.setStatus(channel, status),
      },
      { lastEventId: base.lastEventId },
    );
  }

  private deliver(runSlug: string, channel: Channel, event: RunEvent): void {
    const key = queryKeys.run(runSlug);
    const before = this.client.getQueryData<RunView>(key);
    if (before) this.client.setQueryData<RunView>(key, applyRunEvent(before, event));
    const replay = Date.parse(event.at) < channel.subscribedAt - REPLAY_SKEW_MS;
    for (const listener of channel.listeners) listener(event, { replay });
  }

  /** Raw events for one run (moments start from these). Does not open the stream by itself. */
  listen(runSlug: string, listener: RunEventListener): () => void {
    const channel = this.channel(runSlug);
    channel.listeners.add(listener);
    return () => channel.listeners.delete(listener);
  }

  status(runSlug: string): StreamStatus {
    return this.channels.get(runSlug)?.status ?? IDLE;
  }

  onStatus(runSlug: string, listener: () => void): () => void {
    const channel = this.channel(runSlug);
    channel.statusListeners.add(listener);
    return () => channel.statusListeners.delete(listener);
  }

  /** Closes everything (Reset, tests). */
  closeAll(): void {
    for (const channel of this.channels.values()) {
      channel.generation += 1;
      channel.stop?.();
      channel.stop = null;
      channel.refs = 0;
    }
    this.channels.clear();
  }
}
