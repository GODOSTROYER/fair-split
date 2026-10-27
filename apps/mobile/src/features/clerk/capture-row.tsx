/**
 * One capture, on the Scan screen's recent list and in the Outbox: the paper, what it is (its serial once read, or
 * the member for a cash receipt), where it is in words, a second line when it helps, and its ring. A capture waiting
 * on a retry, or refused for a reason a resend can fix, offers "Ipadala karon"; a refused one can also be removed
 * from the phone ("Tangtanga", after a confirm). A refusal no resend can fix offers only the removal: its words say
 * what to file instead.
 *
 * The words are one element for TalkBack ("Resibo 0403. 4 ka linya nabasa. 412 KB, 09:12."); the buttons stay their
 * own. Progress is not a live region: the outbox announces one summary when uploads land.
 */
import { StyleSheet, View } from "react-native";
import { format } from "../../_shims/domain";
import { space, target } from "../../_shims/tokens.native";
import type { CaptureRecord } from "../../lib/outbox";
import { useFs } from "../../theme/theme";
import { Button, InkStamp } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { canRemove, canSendNow, hintOf, metaOf, ringOf, statusOf, titleOf } from "./capture-view";
import { Paper } from "./paper";
import { CaptureRing } from "./ring";
import { useCompact } from "./use-compact";
import { useT } from "./use-t";

export function CaptureRow({
  r,
  now,
  online,
  treasurer,
  onSendNow,
  onRemove,
  testID,
  paper = 64,
}: {
  r: CaptureRecord;
  now: number;
  online: boolean;
  /** The treasurer's name for refusal copy, from the pairing or the co-op; null says "the treasurer". */
  treasurer: string | null;
  onSendNow?: () => void;
  /** Asks to remove a refused capture (the screen confirms first). */
  onRemove?: () => void;
  testID: string;
  paper?: number;
}) {
  const { t } = useFs();
  const tr = useT();
  const compact = useCompact();
  const title = titleOf(r);
  const status = statusOf(r, now, online, treasurer);
  const hint = hintOf(r);
  const titleText = tr(title.key, title.args);
  const statusText = tr(status.key, status.args);
  const hintText = hint ? tr(hint.key, hint.args) : null;
  const n = r.nadawat;
  const metaText = [
    r.source === "sample" ? tr("common.syntheticSample") : null,
    n ? `${n.memberNo}, ${format.cashPesos(n.cents, n.phpPerUsd)}` : r.memberHint,
    tr("M-CL-02.meta", metaOf(r)),
  ]
    .filter(Boolean)
    .join(", ");
  const send = onSendNow && canSendNow(r);
  const remove = onRemove && canRemove(r);
  return (
    <View testID={testID} dataSet={{ captureState: r.state, kind: r.kind }} style={styles.row}>
      <Paper uri={r.thumbUri ?? r.fileUri} width={compact ? 40 : paper} height={compact ? 40 : paper} />
      <View style={styles.body}>
        <View
          accessible
          accessibilityLabel={tr("M-CL-02.rowSr", {
            title: titleText,
            status: [statusText, hintText].filter(Boolean).join(". "),
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
          {hintText && hint ? (
            <Txt kind="caption" style={{ color: t.color[hint.tone] }}>
              {hintText}
            </Txt>
          ) : null}
          <Txt kind="caption" color="ink3">
            {metaText}
          </Txt>
        </View>
        {send || remove ? (
          <View style={styles.actions}>
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
      <CaptureRing tone={ringOf(r)} progress={r.progress} size={compact ? 28 : 36} />
    </View>
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
