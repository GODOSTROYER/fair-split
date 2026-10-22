import { readFileSync } from "node:fs";
import { sha256Hex } from "../gateway/index.js";

/**
 * Frozen prompt files. `promptV` is the file name (S4.2): changing a prompt means adding a new file
 * (a.v2.md) and switching to it, which forces a live run before replays work again. The sha256 of
 * each file is pinned by a test, so an in-place edit fails CI.
 */
export type PromptName = "a.v1" | "b.v1" | "zoom.v1" | "screen.v1";

const cache = new Map<string, string>();

export function loadPromptFile(dir: URL, name: string): string {
  const url = new URL(`${name}.md`, dir);
  const key = url.href;
  let text = cache.get(key);
  if (text === undefined) {
    text = readFileSync(url, "utf8").replace(/\r\n/g, "\n").trimEnd();
    cache.set(key, text);
  }
  return text;
}

export const READ_PROMPTS_DIR = new URL("./prompts/", import.meta.url);

export function prompt(name: PromptName): { promptV: PromptName; text: string; sha256: string } {
  const text = loadPromptFile(READ_PROMPTS_DIR, name);
  return { promptV: name, text, sha256: sha256Hex(text) };
}
