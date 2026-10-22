/**
 * WorkspaceScope: the only way into workspace data. It is derived from the credential (session, frame token,
 * device bearer, signed member link) or from a system context, never from a request body (architecture §3).
 * The brand makes `{ workspaceId: req.body.ws }` a type error: build scopes with `workspaceScope()`.
 */
import { ACTOR_KINDS, type ActorKind } from "./_shims/contracts.js";

export interface Actor {
  kind: ActorKind;
  /** persona or user id, e.g. treasurer:analyn, board:ernesto, engine, paypal, system:cron */
  id: string;
  /** e.g. judge_session:{sid} or judge_session:{sid}/device:{keyId} */
  impersonatedBy?: string | null;
}

export type ScopeSource = "session" | "frame_token" | "device" | "signed_link" | "system";

declare const scopeBrand: unique symbol;

export interface WorkspaceScope {
  readonly workspaceId: string;
  readonly actor: Readonly<Actor>;
  readonly via: ScopeSource;
  readonly [scopeBrand]: true;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function workspaceScope(input: {
  workspaceId: string;
  actor: Actor;
  via: ScopeSource;
}): WorkspaceScope {
  if (!UUID.test(input.workspaceId)) throw new TypeError(`workspaceScope: not a uuid: ${input.workspaceId}`);
  if (!ACTOR_KINDS.includes(input.actor.kind))
    throw new TypeError(`workspaceScope: bad actor kind ${input.actor.kind}`);
  if (!input.actor.id) throw new TypeError("workspaceScope: actor id is required");
  const actor = Object.freeze({
    kind: input.actor.kind,
    id: input.actor.id,
    impersonatedBy: input.actor.impersonatedBy ?? null,
  });
  return Object.freeze({
    workspaceId: input.workspaceId.toLowerCase(),
    actor,
    via: input.via,
  }) as WorkspaceScope;
}

/** A scope for engine, PayPal and cron work inside one workspace (tasks load their workspace from the row). */
export function systemScope(
  workspaceId: string,
  actor: Actor = { kind: "system", id: "system" },
): WorkspaceScope {
  return workspaceScope({ workspaceId, actor, via: "system" });
}
