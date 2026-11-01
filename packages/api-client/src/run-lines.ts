// Additive run-read shape: the frozen MemberLineDTO stays unchanged. The Chair needs the exact
// hash preimage, including credit mark IDs and carried deduction amounts, to verify displayed cash.
import { LineCanonical, MemberLineDTO, RunSlug } from "@fairsplit/contracts";
import { z } from "zod";

export const RunLine = MemberLineDTO.extend({ canonical: LineCanonical });
export type RunLine = z.infer<typeof RunLine>;
export const RunLineList = z.strictObject({ runSlug: RunSlug, lines: z.array(RunLine) });
export type RunLineList = z.infer<typeof RunLineList>;
