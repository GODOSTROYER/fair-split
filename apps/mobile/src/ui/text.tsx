/**
 * Themed text and the translators. Every string on screen goes through `Txt` (type role, token colour, font scaling)
 * and every user-facing word through a catalog (`useT` for the shell's keys, `useMessages(catalog)` for a slice's).
 */
import { Children, type ReactNode, useCallback } from "react";
import { Text, type TextProps } from "react-native";
import type { Lang } from "../_shims/contracts";
import { systemFont } from "../_shims/fonts";
import {
  type Catalog,
  type MessageArgs,
  type MessageKey,
  messages as shellMessages,
  translateIn,
} from "../_shims/i18n";
import type { FsColors } from "../_shims/tokens.native";
import { useApp } from "../state/app";
import { type TypeRole, typeScale, useFs } from "../theme/theme";

export interface TxtProps extends TextProps {
  /** Type role from the scale (named `kind` because `role` is the ARIA role on Text). */
  kind?: TypeRole;
  color?: keyof FsColors;
  align?: "left" | "center" | "right";
}

/** Neither Mona Sans nor Atkinson Next has ₱ (S2.3): it is set in the system font as its own span. */
const PESO = { fontFamily: systemFont } as const;

/** Splits plain string children so every ₱ renders in the system font; other children pass through. */
export function withPeso(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== "string" || !child.includes("₱")) return child;
    const parts = child.split("₱");
    return parts.flatMap((p, i) =>
      i === 0
        ? [p]
        : [
            <Text key={`peso-${i}`} style={PESO}>
              ₱
            </Text>,
            p,
          ],
    );
  });
}

/**
 * Themed text. Everything scales with the system font size up to 2× (S1.12 "font scale 2.0 passes"); the 48 sp hero
 * amount caps itself at 1.5×. Pass `accessibilityRole="header"` on titles so TalkBack can jump between them.
 */
export function Txt({
  kind = "body",
  color = "ink",
  align,
  style,
  maxFontSizeMultiplier,
  children,
  ...rest
}: TxtProps) {
  const { t } = useFs();
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (kind === "amountHero" ? 1.5 : 2)}
      style={[typeScale[kind], { color: t.color[color] }, align ? { textAlign: align } : null, style]}
    >
      {withPeso(children)}
    </Text>
  );
}

export type Translator<K extends string> = (key: K, args?: MessageArgs) => string;

/** The shell's own keys (common, tab, role, slab, seal), in the app language or an explicit one. */
export function useT(langOverride?: Lang): Translator<MessageKey> {
  return useMessages(shellMessages, langOverride);
}

/**
 * A slice's catalog plus the shell's keys, bound to the app language. Slices wrap it once in their own
 * `messages.ts` (`export const useT = () => useMessages(messages)`), so screens never import another slice's copy.
 */
export function useMessages<C extends Catalog>(
  catalog: C,
  langOverride?: Lang,
): Translator<(keyof C & string) | MessageKey> {
  const { lang } = useApp();
  const l = langOverride ?? lang;
  return useCallback((key, args) => translateIn(catalog, l, key, args), [catalog, l]);
}
