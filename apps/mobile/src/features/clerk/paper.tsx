/**
 * A capture shown as what it is: paper (design §2.5 "only photographed evidence counts as paper; it casts the only
 * shadow and carries a 'Synthetic sample' tag in the corner"). Square corners, the paper shadow, the photo cropped
 * from the top so a slip's header and serial show first.
 *
 * UI gate round 3: the sample's mark was the synthetic legend glyph in the corner. Round 5 (provenance once, the
 * console's `Paper`): nothing drawn on the paper; its words ("Synthetic sample") stay in the label beside or around
 * the paper and in its text.
 */
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import { useFs } from "../../theme/theme";
import { Hidden } from "../../ui/honesty";

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
  /** "Synthetic sample": kept in the paper's text, never drawn (round 5); the caller's label says it too. */
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
      {/* Round 5 (provenance once, as the console's Paper): no glyph in the paper's corner; the screen's own mark
          and the words beside the paper say it, and the tag's words stay in the text. */}
      {tag ? <Hidden>{tag}</Hidden> : null}
    </View>
  );
}
