// focusAcrossRemoval: where focus is at each moment a sighted keyboard user or a screen reader could notice it
// while something that held focus goes away (a drawer, the Proof trace). It samples `document.activeElement` in
// the commit itself, right after React's removeChild takes the element with `testId` out of the document (no
// later microtask, timer or frame has run yet), and on each `frame()` the test awaits after it. A focus return
// that waits for a timer shows <body> in the commit's sample. `settled` samples it once more at the first
// microtask after each removal: after the commit's own layout effects and the mutation observers it woke, before
// any task, timer or frame, so before a browser could paint or a person press a key (a focus return made in the
// commit after the DOM went shows <body> in `samples`, but never in `settled`).

export interface FocusSamples {
  /** activeElement right after each removal of the element (in the commit), then after each `frame()`. */
  readonly samples: (Element | null)[];
  /** activeElement at the first microtask after each removal: what a browser could ever paint, or a key reach. */
  readonly settled: (Element | null)[];
  /** How many removals of the element were seen. */
  readonly removals: () => number;
  /** Waits one animation frame and samples again. */
  frame(): Promise<void>;
  /** Puts removeChild back. */
  restore(): void;
}

export function focusAcrossRemoval(testId: string): FocusSamples {
  const selector = `[data-testid="${testId}"]`;
  const samples: (Element | null)[] = [];
  const settled: (Element | null)[] = [];
  let removals = 0;
  const remove = Node.prototype.removeChild;
  Node.prototype.removeChild = function removeChild<T extends Node>(this: Node, child: T): T {
    const removed = remove.call(this, child) as T;
    if (child instanceof Element && (child.matches(selector) || child.querySelector(selector))) {
      removals += 1;
      samples.push(document.activeElement);
      queueMicrotask(() => settled.push(document.activeElement));
    }
    return removed;
  };
  return {
    samples,
    settled,
    removals: () => removals,
    frame: () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          samples.push(document.activeElement);
          resolve();
        });
      }),
    restore: () => {
      Node.prototype.removeChild = remove;
    },
  };
}
