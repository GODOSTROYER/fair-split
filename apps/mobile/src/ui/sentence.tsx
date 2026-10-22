import { StyleSheet, Text } from "react-native";
import { FIGURE_VARIANT, fontFamily } from "../_shims/fonts";
import type { FsColors } from "../_shims/tokens.native";
import type { TypeRole } from "../theme/theme";
import { figureRuns, isFigure, type Segment } from "./figures";
import { Txt, withPeso } from "./text";

export { figures, type Segment } from "./figures";

/**
 * Statement prose (Atkinson Hyperlegible Next) with every engine figure set in the figure face, tabular, with the
 * straight-bar zero: "Money is always set in FS Sans, even inside Atkinson prose" (design §2.3).
 */
export function Sentence({
  segments,
  kind = "statementBody",
  color,
  lang,
  underline,
  testID,
}: {
  segments: readonly Segment[];
  kind?: TypeRole;
  color?: keyof FsColors;
  lang?: string;
  underline?: boolean;
  testID?: string;
}) {
  return (
    <Txt
      kind={kind}
      color={color}
      lang={lang}
      testID={testID}
      style={underline ? styles.underline : undefined}
    >
      {figureRuns(segments).map((s, i) =>
        isFigure(s) ? (
          <Text key={`${i}-${s.text}`} style={styles.figure}>
            {withPeso(s.text)}
          </Text>
        ) : (
          s.text
        ),
      )}
    </Txt>
  );
}

const styles = StyleSheet.create({
  underline: { textDecorationLine: "underline" },
  figure: { fontFamily: fontFamily.figure, fontVariant: [...FIGURE_VARIANT] },
});
