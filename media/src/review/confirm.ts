import { createInterface } from "node:readline/promises";
import type { Fixture } from "../fixtures/schema.js";
import { humanReviewBlockers } from "./session.js";

/**
 * The terminal a person sits at. `human-reviewed` (register §11 "Checking image labels", C-24) and the
 * review page itself need an interactive terminal: a coding agent's shell, a pipe or CI has none, so an
 * agent cannot record a person's review, however it is asked to.
 */
export interface TerminalIo {
  /** stdin and stdout are both an interactive terminal. */
  interactive: boolean;
  ask(question: string): Promise<string>;
  say(line: string): void;
}

export function processTerminal(): TerminalIo {
  return {
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    say: (line) => console.log(line),
  };
}

export class ConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfirmationError";
  }
}

export const NOT_INTERACTIVE =
  "this step records a person's review, so it needs an interactive terminal; run it yourself (not through an agent, a pipe or CI)";

/** Refuses unless a person is at an interactive terminal. */
export function requireInteractive(io: TerminalIo): void {
  if (!io.interactive) throw new ConfirmationError(NOT_INTERACTIVE);
}

/**
 * Marks a fixture `human-reviewed` once the person confirms at the terminal. Every field must already
 * carry the person's own reading from `imagegen review` (no blanket stamp), and no crop may be marked wrong.
 * Returns the updated fixture; throws {@link ConfirmationError} and changes nothing otherwise.
 */
export async function confirmHumanReview(
  f: Fixture,
  reviewer: string,
  io: TerminalIo,
  now: () => Date = () => new Date(),
): Promise<Fixture> {
  requireInteractive(io);
  if (!reviewer.trim()) throw new ConfirmationError("name the reviewer (--reviewer)");
  const blockers = humanReviewBlockers(f);
  if (blockers.length)
    throw new ConfirmationError(`${f.id} cannot be marked human-reviewed: ${blockers.join("; ")}`);
  io.say(
    `${reviewer}: you are confirming that you looked at every crop of ${f.id} and typed what is visibly written.`,
  );
  const answer = (await io.ask(`Type the fixture id (${f.id}) to confirm, anything else to cancel: `)).trim();
  if (answer !== f.id) throw new ConfirmationError("not confirmed; nothing changed");
  return {
    ...f,
    review: {
      ...f.review,
      status: "human-reviewed",
      reviewer: reviewer.trim(),
      reviewedAt: now().toISOString(),
    },
  } as Fixture;
}
