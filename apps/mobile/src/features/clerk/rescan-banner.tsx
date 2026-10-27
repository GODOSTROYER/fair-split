/**
 * A rescan request on M-CL-01 (design K1; S1.9 "Gihangyo ni Analyn nga i-scan pag-usab ang photo E."): canary,
 * because a person is asking him for something, with the photo in question when it was this phone's own, and the one
 * action that answers it. It stays until a slip filed after the request is safe on the phone.
 */
import { StyleSheet, View } from "react-native";
import { format } from "../../_shims/domain";
import { space } from "../../_shims/tokens.native";
import type { CaptureRecord } from "../../lib/outbox";
import { Banner, Button } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { Paper } from "./paper";
import type { RescanRequest } from "./rescan";
import { useT } from "./use-t";

export function RescanBanner({
  request,
  original,
  onScan,
  disabled,
}: {
  request: RescanRequest;
  /** The capture the photo came from, when this phone filed it. */
  original: CaptureRecord | null;
  onScan(): void;
  disabled: boolean;
}) {
  const tr = useT();
  const { photo, requestedBy } = request;
  const thumb = original ? (original.thumbUri ?? original.fileUri) : null;
  return (
    <Banner tone="decide" icon={thumb ? undefined : "scan"} testID={`M-CL-01.rescan.${request.id}`}>
      <View style={styles.row}>
        {thumb && original ? (
          <Paper
            uri={thumb}
            width={44}
            height={56}
            label={tr("M-CL-01.rescanPhotoSr", {
              photo,
              time: format.time(new Date(original.createdAt).toISOString()),
            })}
          />
        ) : null}
        <View style={styles.words}>
          <Txt kind="bodyStrong">
            {requestedBy
              ? tr("M-CL-01.rescanAsked", { name: requestedBy, photo })
              : tr("M-CL-01.rescanAskedAnon", { photo })}
          </Txt>
          <Txt kind="caption" color="ink2">
            {tr("M-CL-01.rescanUntil")}
          </Txt>
        </View>
      </View>
      <Button
        variant="tonal"
        icon="scan"
        label={tr("M-CL-01.rescan")}
        accessibilityLabel={tr("M-CL-01.rescanSr", { photo })}
        onPress={onScan}
        disabled={disabled}
        style={styles.action}
        testID={`M-CL-01.rescan.${request.id}.scan`}
      />
    </Banner>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.s12 },
  words: { flex: 1, gap: space.s4 },
  action: { alignSelf: "flex-start", marginTop: space.s4 },
});
