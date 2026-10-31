// IC-08 on top of IC-01: which route folder owns each `API_COMMANDS` entry (the split's single source of
// truth, apps/api/SPLIT.md), plus the HTTP-level additions (success statuses, the boundary errors every
// command can answer with, header names, path types). Those additions are ONE definition shared with the
// typed client and the msw handlers: `@fairsplit/api-client/http`, re-exported here, so the server, the
// console and the mocks can never disagree about a status, an error code or a path.

import type { Command } from "@fairsplit/api-client/http";
import type { ApiCommandName } from "@fairsplit/contracts";

export {
  COMMAND_NAMES,
  COMMON_ERRORS,
  type Command,
  type CommandErrorCode,
  type CommandInput,
  type CommandOutput,
  type CommandSuccessStatus,
  type CommonErrorCode,
  compilePath,
  errorCodesOf,
  IDEMPOTENCY_ERRORS,
  isSseCommand,
  type JsonCommandName,
  NOT_IMPLEMENTED_REASON,
  NOT_IMPLEMENTED_STATUS,
  type PathParamNames,
  type PathParams,
  pathParamNames,
  RUN_SLUG_PATTERN,
  SSE_PATHS,
  type SseCommandName,
  SUCCESS_STATUS,
  type SuccessStatus,
  takesIdempotencyKey,
} from "@fairsplit/api-client/http";

// ---------------------------------------------------------------- ownership

/** The three slices that fill in handlers after the shell (SPLIT.md). */
export type SliceName = "judge" | "runs" | "proof";

/** Route folders under src/routes, each owned by one slice and mounted by the registry. */
export const ROUTE_FOLDERS = {
  judge: "judge",
  auth: "judge",
  season: "runs",
  "rate-cards": "runs",
  slips: "runs",
  runs: "runs",
  holds: "runs",
  fields: "runs",
  approvals: "runs",
  lines: "runs",
  proof: "proof",
  wellknown: "proof",
  brand: "proof",
  statements: "proof",
  print: "proof",
  ops: "proof",
  media: "proof",
  internal: "judge",
} as const satisfies Record<string, SliceName>;

export type RouteFolder = keyof typeof ROUTE_FOLDERS;

/** The SSE commands are the shell's (src/sse), not a slice's. */
export type ShellOwner = "shell:sse";

/** Which folder implements each API command. Adding a command to IC-01 is a compile error here until it is placed. */
export const COMMAND_FOLDER = {
  createJudgeSession: "judge",
  presence: "judge",
  createPairing: "auth",
  claimPairing: "auth",
  addDeduction: "rate-cards",
  capture: "slips",
  markPaid: "runs",
  setFlag: "runs",
  resolveHold: "holds",
  enterField: "fields",
  approvalPayload: "approvals",
  submitApproval: "approvals",
  declineApproval: "approvals",
  payCash: "lines",
  resend: "lines",
  createReviewRequest: "statements",
  proof: "proof",
  proofJson: "proof",
  proofExport: "proof",
  runEvents: "shell:sse",
  workspaceEvents: "shell:sse",
} as const satisfies Record<ApiCommandName, RouteFolder | ShellOwner>;

/** Commands a folder must implement (exactly these keys). */
export type CommandsOf<F extends RouteFolder> = {
  [N in ApiCommandName]: (typeof COMMAND_FOLDER)[N] extends F ? N : never;
}[ApiCommandName];

export function commandsOfFolder(folder: RouteFolder): ApiCommandName[] {
  return (Object.keys(COMMAND_FOLDER) as ApiCommandName[]).filter((n) => COMMAND_FOLDER[n] === folder);
}

/** Headers a command declares (Idempotency-Key, Content-Digest, Last-Event-ID). */
export type CommandHeaderName<N extends ApiCommandName> =
  Command<N> extends { headers: readonly (infer H)[] } ? H & string : never;
