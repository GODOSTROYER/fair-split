/**
 * Themed text and the translators. Every string on screen goes through `Txt` (type role, token colour, font scaling)
 * and every user-facing word through a catalog (`useT` for the shell's keys, `useMessages(catalog)` for a slice's).
 */
import { Children, type ReactNode, useCallback } from "react";
import { StyleSheet, Text, type TextProps } from "react-native";
import type { Lang } from "../_shims/contracts";
import { pesoFace } from "../_shims/fonts";
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
import { pesoRuns } from "./figures";

export interface TxtProps extends TextProps {
  /** Type role from the scale (named `kind` because `role` is the ARIA role on Text). */
  kind?: TypeRole;
  color?: keyof FsColors;
  align?: "left" | "center" | "right";
}

/**
 * Sets every ₱ in string children in the face `pesoFace` names for the text's own face: FS Sans has its own ₱ (left
 * alone), Atkinson has none, so a peso in statement prose takes the figure face (S2.3: money is always FS Sans).
 * Other children pass through. The face is only looked up when a child carries a ₱.
 */
function withPeso(children: ReactNode, face: () => string | null): ReactNode {
  let peso: string | null | undefined;
  return Children.map(children, (child) => {
    if (typeof child !== "string" || !child.includes("₱")) return child;
    if (peso === undefined) peso = face();
    if (!peso) return child;
    const style = { fontFamily: peso };
    let at = 0;
    return pesoRuns(child).map((r) => {
      const key = `peso-${at}`;
      at += r.text.length;
      return r.peso ? (
        <Text key={key} style={style}>
          {r.text}
        </Text>
      ) : (
        r.text
      );
    });
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
  const face = () =>
    pesoFace((StyleSheet.flatten(style)?.fontFamily as string | undefined) ?? typeScale[kind].fontFamily);
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (kind === "amountHero" ? 1.5 : 2)}
      style={[typeScale[kind], { color: t.color[color] }, align ? { textAlign: align } : null, style]}
    >
      {withPeso(children, face)}
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
