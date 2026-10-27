/**
 * The Outbox tab's icon, with a count of what is still on the phone (Material 3 navigation badge). A capture the
 * co-op refused turns the badge canary: a person must look. The tab's own label stays "Outbox"; the count is drawn
 * here because the shell's navigation bar announces the title only (the screens announce the counts).
 */
import { type ColorValue, StyleSheet, View } from "react-native";
import { summarise } from "../../lib/outbox";
import { useFs } from "../../theme/theme";
import { Glyph } from "../../ui/glyph";
import { Txt } from "../../ui/text";
import { useOutbox } from "./outbox-provider";

export function OutboxTabIcon({ color }: { color: ColorValue }) {
  const { t } = useFs();
  const { records } = useOutbox();
  const s = summarise(records);
  const decide = s.refused > 0;
  return (
    <View>
      <Glyph name="outbox" color={color} />
      {s.onPhone > 0 ? (
        <View
          testID="tab.outbox.badge"
          dataSet={{ count: s.onPhone }}
          style={[
            styles.badge,
            {
              backgroundColor: decide ? t.color.canary : t.color.ink,
              borderColor: decide ? t.color.canaryBorder : t.color.plate,
            },
          ]}
        >
          <Txt
            kind="caption"
            maxFontSizeMultiplier={1}
            style={[styles.count, { color: decide ? t.color.onCanary : t.color.plate }]}
          >
            {s.onPhone > 99 ? "99+" : String(s.onPhone)}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: -6,
    right: -12,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  count: { fontSize: 11, lineHeight: 13, fontFamily: "MonaSans_700Bold" },
});
