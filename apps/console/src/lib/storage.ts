// Per-viewer preferences in localStorage (sound, single-key shortcuts, Data mode). Storage can be blocked
// (private windows, embedded previews), so every access is guarded and the page works without it. Nothing
// here is state that must persist or be shared: that lives on the server.

export function readStored(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Blocked storage: the choice holds for this page only.
  }
}

export function readFlag(key: string, fallback: boolean): boolean {
  const value = readStored(key);
  if (value === "on") return true;
  if (value === "off") return false;
  return fallback;
}

export function writeFlag(key: string, on: boolean): void {
  writeStored(key, on ? "on" : "off");
}
