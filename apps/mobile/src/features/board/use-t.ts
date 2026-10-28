import type { Lang } from "../../_shims/contracts";
import { useMessages } from "../../ui/text";
import { messages } from "./messages";

/** This slice's copy plus the shell's keys, bound to the app language (or an explicit one). */
export function useT(lang?: Lang) {
  return useMessages(messages, lang);
}
