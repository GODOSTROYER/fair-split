import {
  isApiClientError,
  isContractError,
  type StatementRouteMethods,
  type StatementView,
} from "@fairsplit/api-client";
import type { ApiResult, RenderedStatementSentence, StatementDTO } from "../../_shims/api-client";
import type { Lang, StatementAudio, StatementTemplate } from "../../_shims/contracts";
import type { ReceiptId } from "../../lib/figures";
import { withServedAudio } from "../../lib/statement";
import { discoverMemberLine } from "./discovery";

function formatted(view: StatementView): NonNullable<StatementDTO["formatted"]> {
  return {
    ...view.mobile.formatted,
    receiptRows: view.mobile.formatted.receiptRows.map((row) => {
      if (!/^(premium|bonus|net|ded:.+|credit:.+)$/.test(row.id)) throw new Error("Unknown receipt row");
      return { ...row, id: row.id as ReceiptId };
    }),
  };
}

/** No client template renderer or money arithmetic participates in a served statement. */
export async function readMemberStatement(
  routes: StatementRouteMethods,
  readAudio: (lineId: string, lang: Lang) => Promise<ApiResult<StatementAudio>>,
  rail: () => string | null,
  origin: string,
  options: { signal?: AbortSignal } = {},
): Promise<ApiResult<StatementDTO>> {
  try {
    const line = await discoverMemberLine(() => routes.memberStatementLine(options), options.signal);
    const reads = await Promise.all(
      (["ceb", "fil", "en"] as const).map(async (lang) => {
        const view = await routes.statement({ params: { lineId: line.lineId }, query: { lang }, ...options });
        const audio = await readAudio(line.lineId, lang);
        return { lang, view, audio };
      }),
    );
    const first = reads[0]?.view;
    if (!first) return { ok: false, code: "NETWORK" };
    const sentences = {} as Record<Lang, StatementTemplate[]>;
    const rendered: Partial<Record<Lang, RenderedStatementSentence[]>> = {};
    for (const { lang, view } of reads) {
      if (view.lineId !== line.lineId || !view.mobile) return { ok: false, code: "NETWORK" };
      sentences[lang] = view.display.map((s, i) => ({
        id: `${s.slot}.${s.variant}.${i}`,
        slot: s.slot,
        variant: s.variant,
        text: "",
        ref: s.mentions.find((m) => /^(rule|slip):/.test(m))?.split(":")[1],
      }));
      rendered[lang] = view.display.map((s, i) => ({
        id: `${s.slot}.${s.variant}.${i}`,
        slot: s.slot,
        variant: s.variant,
        display: s.text,
        spoken: view.spoken[i]?.text ?? s.text,
        mentions: s.mentions,
        textSha256: view.mobile.spokenHashes?.[i] ?? "",
      }));
    }
    const formattedByLang = Object.fromEntries(reads.map(({ lang, view }) => [lang, formatted(view)]));
    let dto: StatementDTO = {
      ...first.mobile,
      formatted: formatted(first),
      lineId: line.lineId,
      provenance: first.provenance,
      served: true,
      paypalRail: rail(),
      sentences,
      rendered,
      formattedByLang,
      audio: {},
    };
    for (const { audio } of reads) if (audio.ok) dto = withServedAudio(dto, audio.value, origin);
    return { ok: true, value: dto };
  } catch (error) {
    if (isApiClientError(error)) return { ok: false, code: error.code, status: error.status };
    return { ok: false, code: "NETWORK", ...(isContractError(error) ? { status: error.status } : {}) };
  }
}
