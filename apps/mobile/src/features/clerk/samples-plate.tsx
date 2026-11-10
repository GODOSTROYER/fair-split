/**
 * Sample slips (demo, and Judge Mode where the co-op accepts nothing else): the three drawn slips as paper, each
 * tagged "Synthetic sample". A tap files one through the same outbox as a phone capture; a second tap on the same
 * slip shows the duplicate check doing its job ("Napadala na sa 09:12").
 */
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { radius, space } from "../../_shims/tokens.native";
import type { CaptureRecord } from "../../lib/outbox";
import { samplePage } from "../../platform/scanner";
import { useFs } from "../../theme/theme";
import { Glyph } from "../../ui/glyph";
import { Txt } from "../../ui/text";
import { Paper } from "./paper";
import { SAMPLE_SERIALS, sampleSlip } from "./samples";
import { useT } from "./use-t";

const TILE = { width: 96, height: 135 } as const;

export function SamplesPlate({
  records,
  samplesOnly,
  onAdd,
}: {
  records: readonly CaptureRecord[];
  samplesOnly: boolean;
  onAdd(serial: string): void;
}) {
  const { t } = useFs();
  const tr = useT();
  const [uris, setUris] = useState<Readonly<Record<string, string>>>({});
  useEffect(() => {
    let alive = true;
    for (const serial of SAMPLE_SERIALS) {
      void samplePage(serial).then((p) => {
        if (alive) setUris((u) => ({ ...u, [serial]: p.thumbUri }));
      });
    }
    return () => {
      alive = false;
    };
  }, []);
  const filed = new Set(records.map((r) => r.sha256));
  return (
    <View
      testID="M-CL-01.samples"
      style={[styles.plate, { borderColor: t.color.rule, backgroundColor: t.color.plate2 }]}
    >
      <View style={{ gap: space.s4 }}>
        <Txt kind="title2" accessibilityRole="header">
          {tr("M-CL-01.samples")}
        </Txt>
        <Txt kind="body" color="ink2">
          {tr(samplesOnly ? "M-CL-01.samplesOnly" : "M-CL-01.samplesHint")}
        </Txt>
      </View>
      <View style={styles.tiles}>
        {SAMPLE_SERIALS.map((serial) => {
          const s = sampleSlip(serial);
          const isFiled = filed.has(s.sha256);
          return (
            <Pressable
              key={serial}
              testID={`M-CL-01.sample.${serial}`}
              dataSet={{ filed: isFiled ? "yes" : "no" }}
              accessibilityRole="button"
              accessibilityLabel={[
                tr("M-CL-01.sampleSr", { serial, member: s.memberNo }),
                tr("common.syntheticSample"),
                isFiled ? tr("M-CL-01.sampleFiled") : null,
              ]
                .filter(Boolean)
                .join(". ")}
              accessibilityHint={tr("M-CL-01.addSample", { serial })}
              onPress={() => onAdd(serial)}
              style={({ pressed }) => [
                styles.tile,
                pressed && { opacity: 0.85, transform: [{ translateY: 1 }] },
              ]}
            >
              <Paper
                uri={uris[serial] ?? null}
                width={TILE.width}
                height={TILE.height}
                tag={tr("common.syntheticSample")}
              />
              <View style={styles.caption}>
                <Txt kind="figureS">{serial}</Txt>
                <Txt kind="caption" color="ink2">
                  {s.memberNo}
                </Txt>
              </View>
              {isFiled ? (
                <View style={styles.filed}>
                  <Glyph name="check" size={14} color={t.color.ink2} />
                  <Txt kind="caption" color="ink2">
                    {tr("M-CL-01.sampleFiled")}
                  </Txt>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    gap: space.s16,
    padding: space.s16,
    // Round 3: a solid hairline. Dashed means simulated only; the samples are synthetic (their glyph says so).
    borderWidth: 1,
    borderRadius: radius.plate,
  },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space.s16 },
  tile: { width: TILE.width, gap: space.s8, minHeight: 48 },
  caption: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  filed: { flexDirection: "row", alignItems: "center", gap: space.s4 },
});
