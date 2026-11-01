import type { ApiResult, RenderedStatementSentence, StatementDTO } from "../../_shims/api-client";
import type { Lang, StatementAudio, StatementSlot, StatementTemplate } from "../../_shims/contracts";
import { withServedAudio } from "../../lib/statement";

interface TextSentence {
  slot: StatementSlot;
  variant: string;
  text: string;
  mentions: string[];
}
export interface ServedStatement {
  lineId: string;
  lang: Lang;
  provenance: StatementDTO["provenance"];
  mobile: Omit<StatementDTO, "lineId" | "provenance" | "sentences" | "audio">;
  display: TextSentence[];
  spoken: TextSentence[];
}

/** No client template renderer or money arithmetic participates in a served statement. */
export async function readMemberStatement(
  read: <T>(path: string) => Promise<ApiResult<T>>,
  rail: () => string | null,
  origin: string,
): Promise<ApiResult<StatementDTO>> {
  const line = await read<{ lineId: string }>("/v1/members/me/statement-line");
  if (!line.ok) return line;
  const path = encodeURIComponent(line.value.lineId);
  const reads = await Promise.all(
    (["ceb", "fil", "en"] as const).map(async (lang) => {
      const view = await read<ServedStatement>(`/v1/statements/${path}?lang=${lang}`);
      const audio = await read<StatementAudio>(`/v1/media/audio/${path}?lang=${lang}`);
      return { lang, view, audio };
    }),
  );
  const first = reads[0]?.view;
  if (!first?.ok) return first ?? { ok: false, code: "NETWORK" };
  const sentences = {} as Record<Lang, StatementTemplate[]>;
  const rendered: Partial<Record<Lang, RenderedStatementSentence[]>> = {};
  for (const { lang, view } of reads) {
    if (!view.ok) return view;
    if (view.value.lineId !== line.value.lineId || !view.value.mobile) return { ok: false, code: "NETWORK" };
    sentences[lang] = view.value.display.map((s, i) => ({
      id: `${s.slot}.${s.variant}.${i}`,
      slot: s.slot,
      variant: s.variant,
      text: "",
      ref: s.mentions.find((m) => /^(rule|slip):/.test(m))?.split(":")[1],
    }));
    rendered[lang] = view.value.display.map((s, i) => ({
      id: `${s.slot}.${s.variant}.${i}`,
      slot: s.slot,
      variant: s.variant,
      display: s.text,
      spoken: view.value.spoken[i]?.text ?? s.text,
      mentions: s.mentions,
      textSha256: view.value.mobile.spokenHashes?.[i] ?? "",
    }));
  }
  const formattedByLang = Object.fromEntries(
    reads.map(({ lang, view }) => [lang, view.ok ? view.value.mobile.formatted : undefined]),
  );
  let dto: StatementDTO = {
    ...first.value.mobile,
    lineId: line.value.lineId,
    provenance: first.value.provenance,
    served: true,
    paypalRail: rail(),
    sentences,
    rendered,
    formattedByLang,
    audio: {},
  };
  for (const { audio } of reads) if (audio.ok) dto = withServedAudio(dto, audio.value, origin);
  return { ok: true, value: dto };
}
