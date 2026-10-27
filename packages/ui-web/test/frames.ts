// Animation frames on setTimeout, installed before anything imports Motion. Motion's frame loop keeps the
// requestAnimationFrame it finds when its module loads, and jsdom runs its own frames off a timer that stops
// for good once fake timers have been swapped in and out. Frames on setTimeout run under fake and real timers
// alike, so a test can see what Motion draws (travel, fill, edge opacity), and Base UI can move a dialog's
// initial focus in a frame.

interface PendingFrame {
  readonly callback: FrameRequestCallback;
  readonly timer: ReturnType<typeof setTimeout>;
}

let lastFrame = 0;
const pending = new Map<number, PendingFrame>();

function runFrame(id: number): void {
  const frame = pending.get(id);
  if (!frame) return;
  pending.delete(id);
  frame.callback(performance.now());
}

function requestFrame(callback: FrameRequestCallback): number {
  const id = ++lastFrame;
  pending.set(id, { callback, timer: setTimeout(() => runFrame(id), 16) });
  return id;
}

function cancelFrame(id: number): void {
  const frame = pending.get(id);
  if (frame) clearTimeout(frame.timer);
  pending.delete(id);
}

/**
 * Runs every frame still waiting, and the frames those ask for, so no test inherits one. Motion asks for its
 * next frame only once the last one has run: a frame that died with a fake clock would stop it drawing for the
 * rest of the file, and one left on the real clock would land at a random point in the next test. With
 * animations skipped, the chain ends within a few frames.
 */
export function flushFrames(): void {
  for (let round = 0; round < 50 && pending.size > 0; round++) {
    for (const [id, frame] of [...pending]) {
      clearTimeout(frame.timer);
      runFrame(id);
    }
  }
}

for (const scope of [globalThis, window] as const) {
  scope.requestAnimationFrame = requestFrame;
  scope.cancelAnimationFrame = cancelFrame;
}
