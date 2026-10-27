// Byte-exact access to a member of a JSON document. verify-webhook-signature recomputes the CRC32 over the
// `webhook_event` exactly as the caller posted it, which is what PayPal's postback requires.

function skipWs(s: string, i: number): number {
  while (i < s.length && (s[i] === " " || s[i] === "\n" || s[i] === "\r" || s[i] === "\t")) i++;
  return i;
}

function skipString(s: string, i: number): number {
  // s[i] === '"'
  i++;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") i += 2;
    else if (ch === '"') return i + 1;
    else i++;
  }
  throw new Error("unterminated string");
}

function skipValue(s: string, i: number): number {
  i = skipWs(s, i);
  const ch = s[i];
  if (ch === '"') return skipString(s, i);
  if (ch === "{" || ch === "[") {
    let depth = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '"') {
        i = skipString(s, i);
        continue;
      }
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    throw new Error("unterminated container");
  }
  while (i < s.length && !",}] \n\r\t".includes(s[i] as string)) i++;
  return i;
}

/** Returns the raw text of `key`'s value in a top-level JSON object, or null when absent/malformed. */
export function rawMember(json: string, key: string): string | null {
  try {
    let i = skipWs(json, 0);
    if (json[i] !== "{") return null;
    i++;
    for (;;) {
      i = skipWs(json, i);
      if (json[i] === "}") return null;
      if (json[i] !== '"') return null;
      const keyEnd = skipString(json, i);
      const name = JSON.parse(json.slice(i, keyEnd)) as string;
      i = skipWs(json, keyEnd);
      if (json[i] !== ":") return null;
      const start = skipWs(json, i + 1);
      const end = skipValue(json, start);
      if (name === key) return json.slice(start, end);
      i = skipWs(json, end);
      if (json[i] === ",") i++;
    }
  } catch {
    return null;
  }
}
