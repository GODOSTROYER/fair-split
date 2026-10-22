/**
 * LanguagePicker (S2.7): Cebuano, Filipino, English, each named in its own language, as a radio group of chips.
 * The statement, Paminawa and the first run use it; changing it changes the app language at once.
 */
import { StyleSheet, View } from "react-native";
import { LANGS, type Lang } from "../_shims/contracts";
import { translate } from "../_shims/i18n";
import { space } from "../_shims/tokens.native";
import { useApp } from "../state/app";
import { Chip } from "./primitives";

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
  const current = value ?? lang;
  const pick = onChange ?? setLang;
  return (
    <View style={styles.row} accessibilityRole="radiogroup" testID={testID}>
      {langs.map((l) => (
        <Chip
          key={l}
          label={translate(l, "common.langName")}
          selected={l === current}
          onPress={() => pick(l)}
          role="radio"
          testID={`${testID}.${l}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.s8 },
});
