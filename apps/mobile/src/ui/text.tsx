import { useCallback } from "react";
import { Text, type TextProps } from "react-native";
import type { Lang } from "../_shims/contracts";
import { type MessageKey, translate } from "../_shims/i18n";
import type { FsColors } from "../_shims/tokens.native";
import { useApp } from "../state/app";
import { type TypeRole, typeScale, useFs } from "../theme/theme";

export interface TxtProps extends TextProps {
  /** Type role from the scale (named `kind` because `role` is the ARIA role on Text). */
  kind?: TypeRole;
  color?: keyof FsColors;
  align?: "left" | "center" | "right";
}

/** Themed text. Everything scales with the system font size up to 2×; the hero amount caps itself at 1.5×. */
export function Txt({
  kind = "body",
  color = "ink",
  align,
  style,
  maxFontSizeMultiplier,
  ...rest
}: TxtProps) {
  const { t } = useFs();
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (kind === "amountHero" ? 1.5 : 2)}
      style={[typeScale[kind], { color: t.color[color] }, align ? { textAlign: align } : null, style]}
    />
  );
}

export type TFn = (key: MessageKey, args?: Readonly<Record<string, string | number>>) => string;

/** Translator bound to the app language (or an explicit one, for the three-language first-run prompt). */
export function useT(langOverride?: Lang): TFn {
  const { lang } = useApp();
  const l = langOverride ?? lang;
  return useCallback((key, args) => translate(l, key, args), [l]);
}
