/**
 * One capture, on the Scan screen's recent list and in the Outbox: the paper, what it is (its serial once read, or
 * the member for a cash receipt), where it is in words, a second line when it helps, and its ring. A capture waiting
 * on a retry, or refused for a reason a resend can fix, offers "Ipadala karon"; a refused one can also be removed
 * from the phone ("Tangtanga", after a confirm). A refusal no resend can fix offers only the removal: its words say
 * what to file instead. A capture another clerk filed on this phone (or one filed before it kept who filed it) says
 * whose it is, waits for that clerk, and offers "Ipadala isip ako" instead, which confirms by name first.
 *
 * The words are one element for TalkBack ("Resibo 0403. 4 ka linya nabasa. 412 KB, 09:12."); the buttons stay their
 * own. Progress is not a live region: the outbox announces one summary when uploads land.
 */
import { StyleSheet, View } from "react-native";
import { format } from "../../_shims/domain";
import { space, target } from "../../_shims/tokens.native";
import type { CaptureRecord } from "../../lib/outbox";
import { useFs } from "../../theme/theme";
import { SnapRow } from "../../ui/chrome";
import { Button, InkStamp } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import {
  canRemove,
  canSendNow,
  canTakeOver,
  filedNoteOf,
  filerName,
  hintOf,
  metaOf,
  ringOf,
  statusOf,
  titleOf,
} from "./capture-view";
import { Paper } from "./paper";
import { CaptureRing } from "./ring";
import { useCompact } from "./use-compact";
import { useT } from "./use-t";

export function CaptureRow({
  r,
  now,
  online,
  treasurer,
  me,
  onSendNow,
  onTakeOver,
  onRemove,
  testID,
  paper = 64,
}: {
  r: CaptureRecord;
  now: number;
  online: boolean;
  /** The treasurer's name for refusal copy, from the pairing or the co-op; null says "the treasurer". */
  treasurer: string | null;
  /** The persona of the clerk paired now: a capture filed by anyone else says so and is never sent by a tap. */
  me: string | null;
  onSendNow?: () => void;
  /** Asks to send another clerk's capture as this clerk's own (the screen confirms first, naming the filer). */
  onTakeOver?: () => void;
  /** Asks to remove a refused capture (the screen confirms first). */
  onRemove?: () => void;
  testID: string;
  paper?: number;
}) {
  const { t } = useFs();
  const tr = useT();
  const compact = useCompact();
  const title = titleOf(r);
  const status = statusOf(r, now, online, treasurer, me);
  const hint = hintOf(r);
  const filed = filedNoteOf(r, me);
  const titleText = tr(title.key, title.args);
  const statusText = tr(status.key, status.args);
  const hintText = hint ? tr(hint.key, hint.args) : null;
  const filedText = filed ? tr(filed.key, filed.args) : null;
  const n = r.nadawat;
  const metaText = [
    r.source === "sample" ? tr("common.syntheticSample") : null,
    n ? `${n.memberNo}, ${format.cashPesos(n.cents, n.phpPerUsd)}` : r.memberHint,
    tr("M-CL-02.meta", metaOf(r)),
  ]
    .filter(Boolean)
    .join(", ");
  const send = onSendNow && canSendNow(r, me);
  const take = onTakeOver && canTakeOver(r, me);
  const remove = onRemove && canRemove(r);
  return (
    // Round 4: a capture is one snap row, whole above the tab bar or not at all.
    <SnapRow testID={testID} dataSet={{ captureState: r.state, kind: r.kind }} style={styles.row}>
      <Paper uri={r.thumbUri ?? r.fileUri} width={compact ? 40 : paper} height={compact ? 40 : paper} />
      <View style={styles.body}>
        <View
          accessible
          accessibilityLabel={tr("M-CL-02.rowSr", {
            title: titleText,
            status: [statusText, filedText, hintText].filter(Boolean).join(". "),
            meta: metaText,
          })}
          style={{ gap: space.s2 }}
        >
          <View style={styles.titleRow}>
            <Txt kind="bodyStrong" style={{ flexShrink: 1 }}>
              {titleText}
            </Txt>
            {n ? <InkStamp initials={n.attestedBy} /> : null}
          </View>
          <Txt kind="label" style={{ color: t.color[status.tone] }} testID={`${testID}.status`}>
            {statusText}
          </Txt>
          {filedText && filed ? (
            <Txt kind="caption" style={{ color: t.color[filed.tone] }} testID={`${testID}.filed-by`}>
              {filedText}
            </Txt>
          ) : null}
          {hintText && hint ? (
            <Txt kind="caption" style={{ color: t.color[hint.tone] }}>
              {hintText}
            </Txt>
          ) : null}
          <Txt kind="caption" color="ink3">
            {metaText}
          </Txt>
        </View>
        {send || take || remove ? (
          <View style={styles.actions}>
            {take ? (
              <Button
                variant="text"
                icon="people"
                label={tr("M-CL-02.takeOver")}
                accessibilityLabel={
                  r.filedBy
                    ? tr("M-CL-02.takeOverSr", { title: titleText, name: filerName(r.filedBy) })
                    : tr("M-CL-02.takeOverUnknownSr", { title: titleText })
                }
                onPress={onTakeOver}
                testID={`${testID}.take-over`}
              />
            ) : null}
            {send ? (
              <Button
                variant="text"
                icon="forward"
                label={tr("M-CL-02.sendNow")}
                accessibilityLabel={tr("M-CL-02.sendNowSr", { title: titleText })}
                onPress={onSendNow}
                testID={`${testID}.send-now`}
              />
            ) : null}
            {remove ? (
              <Button
                variant="text"
                icon="close"
                label={tr("M-CL-02.remove")}
                accessibilityLabel={tr("M-CL-02.removeSr", { title: titleText })}
                onPress={onRemove}
                testID={`${testID}.remove`}
              />
            ) : null}
          </View>
        ) : null}
      </View>
      <CaptureRing tone={ringOf(r, me)} progress={r.progress} size={compact ? 28 : 36} />
    </SnapRow>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.s12,
    paddingVertical: space.s12,
    minHeight: target.min + space.s16,
  },
  body: { flex: 1, gap: space.s4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.s8 },
  actions: { flexDirection: "row", flexWrap: "wrap", columnGap: space.s8, marginLeft: -space.s8 },
});
