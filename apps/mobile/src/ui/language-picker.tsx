/**
 * LanguagePicker (S2.7): Cebuano, Filipino, English, each named in its own language, as a radio group. The
 * statement, Paminawa and the first run use it; changing it changes the app language at once.
 *
 * UI gate round 2: one segmented control (the console's Member / Chair / Clerk tabs) instead of three loose chips:
 * a porcelain track, the chosen language on a white segment. Each segment keeps a 48 dp target.
 */
import { Pressable, StyleSheet, View } from "react-native";
import { LANGS, type Lang } from "../_shims/contracts";
import { translate } from "../_shims/i18n";
import { radius, space, target } from "../_shims/tokens.native";
import { useApp } from "../state/app";
import { useFs } from "../theme/theme";
import { Txt } from "./text";

/** The visible segment; the hit slop makes up the 48 dp target. */
const SEGMENT = 36;

export function LanguagePicker({
  value,
  onChange,
  testID = "lang",
  langs = LANGS,
}: {
  /** Defaults to the app language. */
  value?: Lang;
  /** Defaults to switching the app language. */
  onChange?(l: Lang): void;
  testID?: string;
  langs?: readonly Lang[];
}) {
  const { lang, setLang } = useApp();
  const { t } = useFs();
  const current = value ?? lang;
  const pick = onChange ?? setLang;
  return (
    <View
      style={[styles.track, { backgroundColor: t.color.plate2, borderColor: t.color.rule }]}
      accessibilityRole="radiogroup"
      testID={testID}
    >
      {langs.map((l) => {
        const on = l === current;
        const label = translate(l, "common.langName");
        return (
          <Pressable
            key={l}
            onPress={() => pick(l)}
            accessibilityRole="radio"
            aria-checked={on}
            accessibilityState={{ checked: on }}
            accessibilityLabel={label}
            testID={`${testID}.${l}`}
            dataSet={{ state: on ? "selected" : "idle" }}
            hitSlop={(target.min - SEGMENT) / 2}
            style={({ pressed }) => [
              styles.segment,
              on ? { backgroundColor: t.color.plate, boxShadow: t.shadow.e1 } : null,
              pressed && !on ? { backgroundColor: t.color.pencilWash } : null,
            ]}
          >
            <Txt kind="label" color={on ? "ink" : "ink2"} numberOfLines={1}>
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    alignSelf: "flex-start",
    maxWidth: "100%",
    padding: 3,
    gap: 2,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  segment: {
    minHeight: SEGMENT,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: space.s12 + 2,
    borderRadius: radius.pill,
  },
});
