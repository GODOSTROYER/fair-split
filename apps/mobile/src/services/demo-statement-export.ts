/** K1d: consume AU2's exact fs-api words and AU3's published manifest, never a test golden or a phone re-render. */
import manifest from "../../../../media/audio/manifest.json";
import exported from "../../../../media/statement-plans.json";
import type { StatementAudio, StatementAudioClip, StatementDTO } from "../_shims/api-client";
import { AUDIO_CLIP_URL_RE, type Lang, type StatementSlot } from "../_shims/contracts";
import { withServedAudio } from "../lib/statement";

interface ExportedSentence {
  slot: StatementSlot;
  variant: string;
  text: string;
  textSha256: string;
  mentions: readonly string[];
  placeholders: readonly { name: string }[];
  displayText: string;
}

interface ExportedRequest {
  member_no: string;
  lang: Lang;
  lineId: string;
  sentences: readonly ExportedSentence[];
}

const LABELS: Readonly<Record<Lang, string>> = {
  ceb: "Sintetikong tingog (Gemini TTS)",
  fil: "Sintetikong boses (Gemini TTS)",
  en: "Synthetic voice (Gemini TTS)",
};
const DEVICE_LABELS: Readonly<Record<Lang, string>> = {
  ceb: "Tingog sa telepono",
  fil: "Boses ng telepono",
  en: "Device voice",
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** Committed export and manifest already carry fs-api's hashes. Compare them; never hash text on the phone. */
function publishedClip(
  request: ExportedRequest,
  sentence: ExportedSentence,
  entries: readonly unknown[],
): StatementAudioClip | null {
  const candidates = entries
    .map(record)
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  for (const e of candidates) {
    if (
      e.member_no !== request.member_no ||
      e.lang !== request.lang ||
      e.slot !== sentence.slot ||
      e.synthetic !== true ||
      e.draft !== false ||
      e.text !== sentence.text ||
      e.text_sha256 !== sentence.textSha256 ||
      typeof e.file !== "string" ||
      typeof e.duration_ms !== "number" ||
      !Number.isInteger(e.duration_ms) ||
      e.duration_ms <= 0
    )
      continue;
    const url = `/media/${e.file}`;
    if (!AUDIO_CLIP_URL_RE.test(url) || !url.startsWith(`/media/audio/${request.member_no}/${request.lang}/`))
      continue;
    if (e.offsets !== undefined && !Array.isArray(e.offsets)) continue;
    const offsets = (e.offsets ?? []) as unknown[];
    const parsed = offsets.map(record);
    if (
      parsed.some(
        (o) =>
          !o ||
          typeof o.ref !== "string" ||
          !/^(?:(?:slip|rule):[A-Za-z0-9-]+|fact:[A-Z][A-Z0-9_]*)$/.test(o.ref) ||
          typeof o.at_ms !== "number" ||
          !Number.isInteger(o.at_ms) ||
          o.at_ms < 0,
      )
    )
      continue;
    const known = new Set([...sentence.mentions, ...sentence.placeholders.map((p) => `fact:${p.name}`)]);
    return {
      url,
      textSha256: sentence.textSha256,
      slot: sentence.slot,
      label: LABELS[request.lang],
      durationMs: e.duration_ms,
      offsets: parsed
        .flatMap((o) =>
          o &&
          typeof o.ref === "string" &&
          typeof o.at_ms === "number" &&
          known.has(o.ref) &&
          o.at_ms <= (e.duration_ms as number)
            ? [{ ref: o.ref, atMs: o.at_ms }]
            : [],
        )
        .sort((a, b) => a.atMs - b.atMs),
    };
  }
  return null;
}

/** Adding a published manifest entry makes it available on the next build without a code change. */
export function withDemoStatementExport(
  dto: StatementDTO,
  entries: readonly unknown[] = manifest.entries,
): StatementDTO {
  let result = dto;
  for (const request of exported.requests as readonly ExportedRequest[]) {
    if (request.member_no !== dto.member.memberNo) continue;
    const rendered = request.sentences.map((s) => {
      const template = dto.sentences[request.lang].find(
        (t) =>
          t.slot === s.slot &&
          (t.variant ?? (t.slot === "PAY" ? "paypal" : "default")) === s.variant &&
          (!t.ref || s.mentions.includes(`${t.slot === "DEDUCTION" ? "rule" : "slip"}:${t.ref}`)),
      );
      return {
        id: template?.id ?? `${s.slot.toLowerCase()}-${s.variant}`,
        slot: s.slot,
        variant: s.variant,
        display: s.displayText,
        spoken: s.text,
        mentions: [...s.mentions],
        textSha256: s.textSha256,
      };
    });
    const sentences = request.sentences.map((s) => ({
      slot: s.slot,
      variant: s.variant,
      mentions: [...s.mentions],
      textSha256: s.textSha256,
      clip: publishedClip(request, s, entries),
    }));
    const clips = sentences.filter((s) => s.clip !== null).length;
    const source = clips === sentences.length ? "gemini" : clips > 0 ? "mixed" : "device";
    const audio: StatementAudio = {
      // AU2 names the seed member UUID, while the demo's line has its own ID (ADR-0011 K1d).
      lineId: dto.lineId,
      memberNo: request.member_no,
      lang: request.lang,
      source,
      label: source === "device" ? DEVICE_LABELS[request.lang] : LABELS[request.lang],
      deviceLabel: DEVICE_LABELS[request.lang],
      sentences,
    };
    result = withServedAudio(
      { ...result, rendered: { ...result.rendered, [request.lang]: rendered } },
      audio,
    );
  }
  return result;
}
