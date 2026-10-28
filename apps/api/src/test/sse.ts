// A small SSE reader for tests: pull messages off a streaming Response one at a time, with timeouts.
export interface SseMessage {
  id: string | undefined;
  event: string | undefined;
  data: string;
  retry: number | undefined;
}

export interface SseReader {
  /** The next message (comments like `: ping` are collected, not returned). */
  next(timeoutMs?: number): Promise<SseMessage>;
  /** Up to `count` messages, or throws on timeout. */
  take(count: number, timeoutMs?: number): Promise<SseMessage[]>;
  readonly comments: string[];
  close(): Promise<void>;
}

export function sseReader(res: Response): SseReader {
  if (!res.body) throw new Error("sseReader: response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const comments: string[] = [];
  const ready: SseMessage[] = [];
  let buffer = "";
  let done = false;

  function parseBlocks() {
    buffer = buffer.replace(/\r\n?/g, "\n");
    let idx = buffer.indexOf("\n\n");
    while (idx >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const msg: SseMessage = { id: undefined, event: undefined, data: "", retry: undefined };
      const data: string[] = [];
      let hasField = false;
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) {
          comments.push(line.slice(1).trim());
          continue;
        }
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "data") {
          data.push(value);
          hasField = true;
        } else if (field === "id") msg.id = value;
        else if (field === "event") msg.event = value;
        else if (field === "retry") msg.retry = Number(value);
      }
      if (hasField) {
        msg.data = data.join("\n");
        ready.push(msg);
      }
      idx = buffer.indexOf("\n\n");
    }
  }

  async function next(timeoutMs = 5_000): Promise<SseMessage> {
    const deadline = Date.now() + timeoutMs;
    while (ready.length === 0) {
      if (done) throw new Error("sseReader: stream ended");
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`sseReader: no message within ${timeoutMs} ms`);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), left);
        }),
      ]);
      clearTimeout(timer);
      if (chunk === "timeout") throw new Error(`sseReader: no message within ${timeoutMs} ms`);
      if (chunk.done) {
        done = true;
        continue;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      parseBlocks();
    }
    return ready.shift() as SseMessage;
  }

  return {
    next,
    async take(count, timeoutMs = 5_000) {
      const out: SseMessage[] = [];
      for (let i = 0; i < count; i++) out.push(await next(timeoutMs));
      return out;
    },
    comments,
    async close() {
      await reader.cancel().catch(() => undefined);
    },
  };
}
