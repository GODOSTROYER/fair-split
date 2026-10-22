/**
 * M-MB-02 Resibo: her slips, each a crop (low resolution first) with serial, date and net kilos. "Dili tugma?"
 * starts a re-check. Tapping a slip zooms into it inside this screen (no cross-screen transitions).
 */
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, View, type ViewInstance } from "react-native";
import { format } from "../../_shims/domain";
import { people } from "../../_shims/seed";
import { radius, space } from "../../_shims/tokens.native";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Screen } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { Button, Rule } from "../../ui/primitives";
import { Txt, useT } from "../../ui/text";
import { SlipCrop, SlipZoom } from "./slip-zoom";
import { useStatement } from "./use-statement";

export function ResiboScreen() {
  const { lang, demo } = useApp();
  const { t } = useFs();
  const tr = useT();
  const { dto } = useStatement();
  const [zoom, setZoom] = useState<{ serial: string; x: number; y: number } | null>(null);
  const refs = useRef<Record<string, ViewInstance | null>>({});

  if (!dto)
    return (
      <Screen testID="M-MB-02" state="loading">
        {null}
      </Screen>
    );

  const open = (serial: string) => {
    const node = refs.current[serial];
    if (!node) return setZoom({ serial, x: 0, y: 0 });
    node.measureInWindow((x, y, w, h) => setZoom({ serial, x: x + w / 2, y: y + h / 2 }));
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen testID="M-MB-02" state="list">
        <View style={{ gap: space.s4 }}>
          <Txt kind="title1" accessibilityRole="header">
            {tr("M-MB-02.title")}
          </Txt>
          <Txt kind="body" color="ink2">
            {tr("M-MB-02.subtitle", { clerk: people.clerk.first })}
          </Txt>
        </View>
        <View style={[styles.list, { backgroundColor: t.color.plate }]}>
          {dto.slips.map((s, i) => (
            <View key={s.serial}>
              {i > 0 ? <Rule /> : null}
              <Pressable
                ref={(r) => {
                  refs.current[s.serial] = r;
                }}
                testID={`M-MB-02.slip.${s.serial}`}
                accessibilityRole="button"
                accessibilityLabel={`${tr("M-MB-02.slip", { serial: s.serial })}, ${format.date(s.deliveredOn, lang)}, ${format.kg(s.netGrams, 2)}`}
                onPress={() => open(s.serial)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.color.pencilWash }]}
              >
                <SlipCrop slip={s} width={88} lang={lang} />
                <View style={{ flex: 1, gap: space.s2 }}>
                  <Txt kind="bodyStrong">{tr("M-MB-02.slip", { serial: s.serial })}</Txt>
                  <Txt kind="caption" color="ink2">
                    {format.date(s.deliveredOn, lang)}
                  </Txt>
                  {demo && s.provisional ? (
                    <Txt kind="caption" color="ink3">
                      {tr("M-MB-02.provisional")}
                    </Txt>
                  ) : null}
                </View>
                <Txt kind="figure">{format.kg(s.netGrams, 2)}</Txt>
                <Glyph name="chevron" size={20} color={t.color.ink3} />
              </Pressable>
            </View>
          ))}
          <View style={[styles.total, { borderTopColor: t.color.ink }]}>
            <Txt kind="bodyStrong" style={{ flex: 1 }}>
              {tr("M-MB-02.total", { kg: "" }).replace(/:\s*$/, "")}
            </Txt>
            <Txt kind="amountM">{format.kg(dto.kilos.netGrams)}</Txt>
          </View>
        </View>
        <Button
          variant="tonal"
          icon="question"
          label={tr("M-MB-02.mismatch")}
          onPress={() => router.push("/(member)/(tabs)/pangutana")}
          testID="M-MB-02.mismatch"
        />
        <Txt kind="caption" color="ink3">
          {tr("M-MB-02.photoPending")}
        </Txt>
      </Screen>
      {zoom ? (
        <SlipZoom
          slips={dto.slips}
          serial={zoom.serial}
          origin={{ x: zoom.x, y: zoom.y }}
          lang={lang}
          onPhase={() => {}}
          onClosed={() => setZoom(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: radius.none },
  row: { flexDirection: "row", alignItems: "center", gap: space.s12, padding: space.s12, minHeight: 72 },
  total: {
    flexDirection: "row",
    alignItems: "center",
    padding: space.s12,
    borderTopWidth: 2,
  },
});
