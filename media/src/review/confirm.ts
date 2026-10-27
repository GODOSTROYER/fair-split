import { createInterface } from "node:readline/promises";
import type { Fixture } from "../fixtures/schema.js";
import { humanReviewBlockers, type SessionRecord, sessionMismatches } from "./session.js";

/**
 * The terminal a person sits at. `human-reviewed` (register §11 "Checking image labels", C-24) and the
 * review page itself need an interactive terminal, so a pipe, CI or an agent's ordinary shell cannot set it
 * by accident. That is a guard, not a guarantee: anything that can drive a real terminal, or edit the JSON,
 * can still claim a review. What makes a claim checkable is the record behind it: a human-reviewed fixture
 * names the saved review session it was confirmed from, and `reviewProof` checks that session is of the
 * same image, by the same reviewer, with the same readings, and was confirmed here.
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

/** Refuses unless stdin and stdout are an interactive terminal (a guard against accidents). */
export function requireInteractive(io: TerminalIo): void {
  if (!io.interactive) throw new ConfirmationError(NOT_INTERACTIVE);
}

/** A saved review session and where it is kept (relative to the media root). */
export interface SessionRef {
  path: string;
  record: SessionRecord;
}

/**
 * Marks a fixture `human-reviewed` once the person confirms at the terminal. Every field must already
 * carry the person's own reading from `imagegen review` (no blanket stamp), no crop may be marked wrong,
 * and `session` must be the saved session those readings came from (this image, this reviewer). Returns the
 * fixture, which now names the session, and the session with its confirmation time; the caller writes both.
 * Throws {@link ConfirmationError} and changes nothing otherwise.
 */
export async function confirmHumanReview(
  f: Fixture,
  reviewer: string,
  io: TerminalIo,
  session: SessionRef,
  now: () => Date = () => new Date(),
): Promise<{ fixture: Fixture; session: SessionRecord }> {
  requireInteractive(io);
  const who = reviewer.trim();
  if (!who) throw new ConfirmationError("name the reviewer (--reviewer)");
  const blockers = humanReviewBlockers(f);
  if (blockers.length)
    throw new ConfirmationError(`${f.id} cannot be marked human-reviewed: ${blockers.join("; ")}`);
  const mismatch = sessionMismatches(f, session.record, who);
  if (mismatch.length) {
    throw new ConfirmationError(
      `${f.id}: review session ${session.path} does not stand behind these readings: ${mismatch.join("; ")}`,
    );
  }
  io.say(
    `${who}: you are confirming that you looked at every crop of ${f.id} and typed what is visibly written.`,
  );
  const answer = (await io.ask(`Type the fixture id (${f.id}) to confirm, anything else to cancel: `)).trim();
  if (answer !== f.id) throw new ConfirmationError("not confirmed; nothing changed");
  const at = now().toISOString();
  return {
    fixture: {
      ...f,
      review: { ...f.review, status: "human-reviewed", reviewer: who, reviewedAt: at, session: session.path },
    } as Fixture,
    session: { ...session.record, confirmedAt: at },
  };
}
