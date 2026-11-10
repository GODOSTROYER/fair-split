/**
 * A capture shown as what it is: paper (design §2.5 "only photographed evidence counts as paper; it casts the only
 * shadow and carries a 'Synthetic sample' tag in the corner"). Square corners, the paper shadow, the photo cropped
 * from the top so a slip's header and serial show first.
 *
 * UI gate round 3: the sample's mark is the synthetic legend glyph (a hatched square) on a white chip at 90%, bottom
 * left, as on the console's papers; its words ("Synthetic sample") stay in the label beside or around the paper.
 */
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import { radius, space } from "../../_shims/tokens.native";
import { MARK_KIND } from "../../lib/honesty";
import { useFs } from "../../theme/theme";
import { MarkShape, useMarkColor } from "../../ui/honesty";

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
  /** "Synthetic sample": its glyph is drawn in the corner (the words are the caller's label). */
  tag?: string | null;
  /** When set, the paper is an image for screen readers; otherwise the words beside it speak for it. */
  label?: string;
  testID?: string;
}) {
  const { t, motion } = useFs();
  const mark = useMarkColor(MARK_KIND.syntheticSample);
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
      {tag && width >= 40 ? (
        <View style={styles.tag} pointerEvents="none">
          <View style={[styles.chip, { backgroundColor: t.color.plate }]} />
          <MarkShape kind={MARK_KIND.syntheticSample} size={12} color={mark} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { position: "absolute", left: space.s4, bottom: space.s4, padding: 3 },
  chip: { ...StyleSheet.absoluteFill, borderRadius: radius.cell, opacity: 0.9 },
});
