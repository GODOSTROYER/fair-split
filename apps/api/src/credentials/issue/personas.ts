// Personas a credential may be issued for (S3.8). A persona is `{role}:{name}`: officers are rows of the
// workspace's `memberships` (treasurer:analyn, board:ernesto, board:theresa, clerk:jessie, brand:dana in a
// judge workspace), members are `member:M-014` by member number. Nothing here trusts a workspace id from a
// request: the caller passes the credential's workspace.
import { MemberNo, type Role } from "@fairsplit/contracts";
import { type DbOrTx, schema } from "@fairsplit/db";
import { and, eq } from "drizzle-orm";

/** Roles a phone or a stage frame can act as. `judge` and `operator` are never issued this way. */
export const PAIRABLE_ROLES = ["treasurer", "board", "clerk", "member", "brand"] as const;
export type PairableRole = (typeof PAIRABLE_ROLES)[number];

/** Roles that may issue credentials for other personas of their workspace (pairing, frames, links). */
export const ISSUER_ROLES = ["judge", "treasurer"] as const satisfies readonly Role[];

export function isPairableRole(role: string): role is PairableRole {
  return (PAIRABLE_ROLES as readonly string[]).includes(role);
}

export function canIssue(role: Role): boolean {
  return (ISSUER_ROLES as readonly string[]).includes(role);
}

/**
 * Who may pair a phone for which persona (S3.8 role table; separation of duties). In a judge workspace the
 * judge acts as every persona of their own workspace, so the stage and its console pair any of them.
 * Elsewhere (showcase, real) the treasurer pairs only its own persona, clerks and members: the Chair (the
 * second key), the brand and any other treasurer are paired by the operator (`POST /v1/ops/pairing`), so
 * one officer's credential can never become another officer's.
 */
export function mayPair(
  issuer: { role: Role; persona: string },
  target: Pick<PersonaRef, "role" | "persona">,
  workspaceKind: string,
): { ok: true } | { ok: false; message: string } {
  if (!canIssue(issuer.role)) {
    return { ok: false, message: "Pairing a phone needs the treasurer's console or the judge stage." };
  }
  if (workspaceKind === "judge") return { ok: true };
  if (target.role === "member" || target.role === "clerk") return { ok: true };
  if (issuer.role === "treasurer" && target.role === "treasurer" && target.persona === issuer.persona) {
    return { ok: true };
  }
  return {
    ok: false,
    message: `Outside Judge Mode the operator pairs ${target.role}:${target.persona}'s phone (/ops), never another officer.`,
  };
}

export interface PersonaRef {
  role: PairableRole;
  /** `analyn`, `ernesto`, `M-014`… (the actor id is `{role}:{persona}`) */
  persona: string;
  memberId: string | null;
  memberNo: string | null;
}

export type PersonaResult =
  | { ok: true; ref: PersonaRef }
  | { ok: false; code: "FORBIDDEN" | "VALIDATION_FAILED"; message: string };

const OFFICER_NAME = /^[a-z][a-z0-9-]{0,31}$/;

/** `board:ernesto` → {role, persona}; `member:M-014` → {role: member, persona: M-014}. Null when unreadable. */
export function parsePersonaRef(s: string): { role: string; persona: string } | null {
  const m = /^([a-z]+):([A-Za-z0-9-]{1,32})$/.exec(s.trim());
  return m ? { role: m[1] as string, persona: m[2] as string } : null;
}

/**
 * Checks that `{role}:{persona}` exists in the workspace and returns its canonical form. Members are named by
 * member number (persona === memberNo); officers by their membership row.
 */
export async function resolvePersona(
  db: DbOrTx,
  workspaceId: string,
  input: { role: string; persona: string; memberNo?: string | undefined },
): Promise<PersonaResult> {
  if (!isPairableRole(input.role)) {
    return { ok: false, code: "FORBIDDEN", message: `A phone or frame cannot act as ${input.role}.` };
  }
  if (input.role === "member") {
    const memberNo =
      input.memberNo ?? (MemberNo.safeParse(input.persona).success ? input.persona : undefined);
    if (!memberNo) {
      return { ok: false, code: "VALIDATION_FAILED", message: "A member persona needs its member number." };
    }
    if (input.persona !== memberNo) {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        message: `A member's persona is their member number (${memberNo}).`,
      };
    }
    const [m] = await db
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(and(eq(schema.members.workspaceId, workspaceId), eq(schema.members.memberNo, memberNo)))
      .limit(1);
    if (!m) return { ok: false, code: "FORBIDDEN", message: `There is no member ${memberNo} in this co-op.` };
    return { ok: true, ref: { role: "member", persona: memberNo, memberId: m.id, memberNo } };
  }
  if (input.memberNo !== undefined) {
    return { ok: false, code: "VALIDATION_FAILED", message: "Only a member persona takes a member number." };
  }
  if (!OFFICER_NAME.test(input.persona)) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: "A persona is a short lowercase name, e.g. ernesto.",
    };
  }
  const [row] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.workspaceId, workspaceId),
        eq(schema.memberships.role, input.role),
        eq(schema.memberships.persona, input.persona),
      ),
    )
    .limit(1);
  if (!row) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: `There is no ${input.role} named ${input.persona} in this co-op.`,
    };
  }
  return { ok: true, ref: { role: input.role, persona: input.persona, memberId: null, memberNo: null } };
}
