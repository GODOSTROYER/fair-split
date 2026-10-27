/**
 * A capture shown as what it is: paper (design §2.5 "only photographed evidence counts as paper; it casts the only
 * shadow and carries a 'Synthetic sample' tag in the corner"). Square corners, the paper shadow, the photo cropped
 * from the top so a slip's header and serial show first.
 */
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import { space } from "../../_shims/tokens.native";
import { useFs } from "../../theme/theme";
import { Txt } from "../../ui/text";

export function Paper({
  uri,
  width,
  height,
  tag,
  label,
  testID,
}: {
  uri: string | null;
  width: number;
  height: number;
  /** "Synthetic sample", drawn in the corner when the paper is large enough to carry it. */
  tag?: string | null;
  /** When set, the paper is an image for screen readers; otherwise the words beside it speak for it. */
  label?: string;
  testID?: string;
}) {
  const { t, motion } = useFs();
  return (
    <View
      testID={testID}
      accessible={!!label}
      accessibilityRole={label ? "image" : undefined}
      accessibilityLabel={label}
      importantForAccessibility={label ? "yes" : "no-hide-descendants"}
      style={{ width, height, backgroundColor: t.color.copyWhite, boxShadow: t.shadowPaper }}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition="top"
          transition={motion.reduced ? 0 : 150}
          accessible={false}
        />
      ) : null}
      {tag && width >= 88 ? (
        <View style={[styles.tag, { backgroundColor: t.color.copyWhite, borderColor: t.color.rule }]}>
          <Txt kind="caption" color="ink2" maxFontSizeMultiplier={1.2} numberOfLines={1}>
            {tag}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    position: "absolute",
    right: space.s4,
    bottom: space.s4,
    paddingHorizontal: space.s4,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
