/**
 * Paminawa as one large play button (UI gate round 2; reel 2's "Start run" with its play circle): a 64 dp indigo
 * circle with a white triangle, the word beside it, and one mono line under the word, the length of the reading
 * when every sentence has a clip, and the voice's own label (Gemini TTS, the phone's voice). The whole row is the
 * 64 dp target; a screen reader hears one button.
 */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { radius, space, target } from "../../_shims/tokens.native";
import { useFs } from "../../theme/theme";
import { Glyph } from "../../ui/glyph";
import { Txt } from "../../ui/text";

export function ListenButton({
  label,
  srLabel,
  meta,
  metaTestID,
  onPress,
  testID,
  ring,
}: {
  label: string;
  srLabel: string;
  /** The mono line under the word ("0:42"), or null. */
  meta: string | null;
  metaTestID?: string;
  onPress(): void;
  testID: string;
  /** MM-1's invite ring, drawn around the circle. */
  ring?: ReactNode;
}) {
  const { t } = useFs();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={srLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? { opacity: 0.85 } : null]}
    >
      {({ pressed }) => (
        <>
          <View>
            <View
              style={[
                styles.circle,
                { backgroundColor: pressed ? t.slab.chalk.edgeRight : t.slab.chalk.face },
              ]}
            >
              {/* The triangle sits a hair right of centre, where the eye reads a play glyph as centred. */}
              <View style={styles.nudge}>
                <Glyph name="play" size={28} color={t.slab.chalk.label} />
              </View>
            </View>
            {ring}
          </View>
          <View style={styles.words}>
            <Txt kind="title2">{label}</Txt>
            {meta ? (
              <Txt kind="micro" color="statementInk2" testID={metaTestID}>
                {meta}
              </Txt>
            ) : null}
          </View>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    gap: space.s16,
    minHeight: target.hero,
    paddingRight: space.s16,
  },
  circle: {
    width: target.hero,
    height: target.hero,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  nudge: { marginLeft: 1 },
  words: { gap: space.s2, flexShrink: 1 },
});
