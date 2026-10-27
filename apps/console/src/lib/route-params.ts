// Path and search parameters, checked against IC-01's formats. A path that does not fit is a 404 (never a
// half-rendered screen); a search value that does not fit is dropped.

import { MemberNo, PhotoId, RunSlug, SeasonLabel, SlipSerial } from "@fairsplit/contracts";
import { notFound } from "@tanstack/react-router";

export function requireSeason(seasonCode: string): void {
  if (!SeasonLabel.safeParse(seasonCode).success) throw notFound();
}

export function requireRunSlug(runSlug: string): void {
  if (!RunSlug.safeParse(runSlug).success) throw notFound();
}

export function requireSlip(slipNo: string): void {
  if (!SlipSerial.safeParse(slipNo).success) throw notFound();
}

export function requireMember(memberNo: string): void {
  if (!MemberNo.safeParse(memberNo).success) throw notFound();
}

export interface ReadingSearch {
  readonly photo?: string | undefined;
}

/**
 * Validators return every key they own, `undefined` when the value does not fit: the router merges a route's
 * validated search over the raw one, so an omitted key would let the raw (invalid) value through.
 */
export function readingSearch(input: Record<string, unknown>): ReadingSearch {
  const photo =
    typeof input.photo === "string" && PhotoId.safeParse(input.photo).success ? input.photo : undefined;
  return { photo };
}

export interface SplitSearch {
  readonly hold?: string | undefined;
  readonly member?: string | undefined;
}

/** `?hold=H1` (a hold label or ID) and `?member=M-014` (register §4). */
export function splitSearch(input: Record<string, unknown>): SplitSearch {
  const hold =
    typeof input.hold === "string" && /^[A-Za-z0-9 :_-]{1,64}$/.test(input.hold) ? input.hold : undefined;
  const member =
    typeof input.member === "string" && MemberNo.safeParse(input.member).success ? input.member : undefined;
  return { hold, member };
}
