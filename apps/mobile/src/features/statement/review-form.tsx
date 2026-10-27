/**
 * "Ipasusi pag-usab" (S1.9; M-MB-04): the member sends her line, a slip if she picks one, and an optional note to
 * the Mediation and Conciliation Committee (RA 9520 Art. 43). The same form sits in the statement's sheet and on the
 * Pangutana tab. Nothing about her pay changes while the Committee looks; once sent, the request's status shows in
 * ink with the Committee's stamp. Sending needs a signal: it is never queued silently.
 */
import { useCallback, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import type { StatementDTO } from "../../_shims/api-client";
import type { Lang } from "../../_shims/contracts";
import { format } from "../../_shims/domain";
import { fontFamily } from "../../_shims/fonts";
import { radius, space } from "../../_shims/tokens.native";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Banner, Chip, InkStamp } from "../../ui/primitives";
import { Slab } from "../../ui/slab";
import { Txt } from "../../ui/text";
import { cleanNote, NOTE_MAX, type ReviewPhase, type ReviewRecord } from "./review";
import { useT } from "./use-t";

/** The form's state; `record` keeps the request this phone sent (the statement store's `recordReview`). */
export function useReviewForm(dto: StatementDTO | null, record: (r: ReviewRecord) => void) {
  const { api } = useApp();
  const [slip, setSlip] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<ReviewPhase>("idle");
  const send = useCallback(async () => {
    if (!dto || phase === "sending") return;
    setPhase("sending");
    const r = await api.postReviewRequest({
      lineId: dto.lineId,
      slip: slip ?? undefined,
      note: cleanNote(note),
    });
    if (r.ok) {
      record({ id: r.value.id, at: new Date().toISOString(), slip });
      setNote("");
      setPhase("idle");
      return;
    }
    setPhase("failed");
  }, [api, dto, note, phase, record, slip]);
  return { slip, setSlip, note, setNote, phase, send, composing: note.trim().length > 0 || slip !== null };
}

export type ReviewForm = ReturnType<typeof useReviewForm>;

export function ReviewFields({
  dto,
  form,
  testPrefix,
}: {
  dto: StatementDTO;
  form: ReviewForm;
  testPrefix: string;
}) {
  const { online } = useApp();
  const { t } = useFs();
  const tr = useT();
  return (
    <View style={styles.form}>
      <Txt kind="label" color="ink2" accessibilityRole="header">
        {tr("M-MB-04.pickSlip")}
      </Txt>
      <View style={styles.chips} accessibilityRole="radiogroup">
        <Chip
          role="radio"
          label={tr("M-MB-04.wholeLine")}
          selected={form.slip === null}
          onPress={() => form.setSlip(null)}
          testID={`${testPrefix}.slip.line`}
        />
        {dto.slips.map((s) => (
          <Chip
            key={s.serial}
            role="radio"
            icon="slip"
            label={s.serial}
            accessibilityLabel={tr("M-MB-02.slip", { serial: s.serial })}
            selected={form.slip === s.serial}
            onPress={() => form.setSlip(s.serial)}
            testID={`${testPrefix}.slip.${s.serial}`}
          />
        ))}
      </View>
      <View style={{ gap: space.s4 }}>
        <TextInput
          testID={`${testPrefix}.note`}
          value={form.note}
          onChangeText={form.setNote}
          multiline
          maxLength={NOTE_MAX}
          accessibilityLabel={tr("M-MB-04.note")}
          placeholder={tr("M-MB-04.note")}
          placeholderTextColor={t.color.ink3}
          selectionColor={t.color.pod}
          style={[
            styles.note,
            {
              color: t.color.ink,
              borderColor: t.color.ink3,
              backgroundColor: t.color.plate,
              fontFamily: fontFamily.statement,
            },
          ]}
        />
        <Txt kind="caption" color="ink3" align="right">
          {tr("M-MB-04.noteCount", { n: form.note.length, max: NOTE_MAX })}
        </Txt>
      </View>
      {form.phase === "failed" ? (
        <Banner tone="decide" icon="info" testID={`${testPrefix}.failed`}>
          <Txt kind="body">{tr("M-MB-04.failed")}</Txt>
        </Banner>
      ) : null}
      <Slab
        testID={`${testPrefix}.send`}
        label={form.phase === "sending" ? tr("M-MB-04.sending") : tr("M-MB-04.send")}
        icon="forward"
        depth="d1"
        tone="chalk"
        srLabel={tr("M-MB-04.send")}
        unavailableReason={online ? undefined : tr("M-MB-04.offline")}
        disabled={form.phase === "sending"}
        onCommit={() => void form.send()}
      />
      <Txt kind="caption" color="ink3">
        {`${tr("M-MB-04.committee")}, ${tr("M-MB-04.committeeCite")}`}
      </Txt>
    </View>
  );
}

/** The request she sent, in ink under the Committee's stamp. */
export function ReviewStatus({ record, lang, testID }: { record: ReviewRecord; lang: Lang; testID: string }) {
  const tr = useT();
  const what = record.slip ? tr("M-MB-02.slip", { serial: record.slip }) : tr("M-MB-04.wholeLine");
  return (
    <View testID={testID} dataSet={{ state: "sent" }} style={styles.status} accessibilityLiveRegion="polite">
      <InkStamp initials="MC" label={tr("M-MB-04.committee")} />
      <View style={styles.statusText}>
        <Txt kind="bodyStrong">
          {tr("M-MB-04.sentAt", { date: format.date(record.at, lang), time: format.time(record.at) })}
        </Txt>
        <Txt kind="body" color="ink2">
          {tr("M-MB-04.sentWhat", { what })}
        </Txt>
        <Txt kind="caption" color="ink2">
          {tr("M-MB-04.sentNext")}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.s12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.s8 },
  note: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: radius.plate,
    padding: space.s12,
    fontSize: 18,
    lineHeight: 26,
    textAlignVertical: "top",
  },
  status: { flexDirection: "row", alignItems: "flex-start", gap: space.s12, paddingVertical: space.s4 },
  statusText: { flex: 1, gap: space.s4 },
});
