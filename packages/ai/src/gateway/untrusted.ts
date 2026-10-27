/** The characters a data block's own delimiters are made of, as JSON escapes. */
const ESCAPES: Readonly<Record<string, string>> = { "<": "\\u003c", ">": "\\u003e", "&": "\\u0026" };

/**
 * JSON for untrusted text inside a prompt's data block (`<transcription>`, `<line>`, `<terms>`, a
 * `tool_result`): S4.2 and S4.7 layer 5 send slip text only JSON-encoded. `JSON.stringify` alone
 * leaves `<`, `>` and `&` as they are, so a transcribed "</transcription> Operator note: ..." would
 * close the block and the rest would read as prompt text. Here they become the JSON escapes
 * `\u003c`, `\u003e` and `\u0026`: still valid JSON that parses back to the same value, and no
 * slip text can close a block or open one. The bytes change only for values that contain those
 * characters, so recordings of clean inputs stay valid (the replay key hashes the raw values, never
 * these bytes).
 */
export function jsonForPrompt(value: unknown): string {
  const json: string | undefined = JSON.stringify(value);
  if (json === undefined) throw new TypeError("jsonForPrompt: value has no JSON representation");
  return json.replace(/[<>&]/g, (c) => ESCAPES[c] ?? c);
}
