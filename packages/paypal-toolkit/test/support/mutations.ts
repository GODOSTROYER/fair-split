// Every single-point change to a canonical body, for "differs in any byte" tests (I1). Each mutant
// differs from the body at one place: a string leaf with a zero-width space appended, its last
// character changed, a leading space, its letter case swapped, a number or null in its place; any key
// or array entry removed; an extra key on any object; an array entry added or the order reversed.
// Item names are the agent's labels, so their content is left to the label tests (core decides which
// labels pass); removing a name, or reordering the items, is still a mutant here.

type Path = (string | number)[];
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Mutant {
  /** Where and how the body was changed, e.g. "items[1].unit_amount.value: a number instead". */
  label: string;
  draft: unknown;
}

const isRecord = (v: unknown): v is Record<string, Json> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function where(path: Path): string {
  let out = "";
  for (const s of path) out += typeof s === "number" ? `[${s}]` : out === "" ? s : `.${s}`;
  return out || "(body)";
}

function* leaves(value: Json, path: Path = []): Generator<{ path: Path; value: Json }> {
  yield { path, value };
  if (Array.isArray(value)) {
    for (const [i, x] of value.entries()) yield* leaves(x, [...path, i]);
  } else if (isRecord(value)) {
    for (const [k, x] of Object.entries(value)) yield* leaves(x, [...path, k]);
  }
}

/** A copy of `body` with `change` applied to the value at `path` (its parent and key are given). */
function edited(
  body: Json,
  path: Path,
  change: (parent: Json[] | Record<string, Json>, key: string | number) => void,
) {
  const copy = structuredClone(body);
  let parent: Json = copy;
  for (const k of path.slice(0, -1)) parent = (parent as Record<string | number, Json>)[k] as Json;
  change(parent as Json[] | Record<string, Json>, path.at(-1) as string | number);
  return copy;
}

const swapCase = (s: string) =>
  s.replace(/[A-Za-z]/g, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));

const isItemName = (path: Path) => path.length === 3 && path[0] === "items" && path[2] === "name";

export function mutants(body: unknown): Mutant[] {
  const root = body as Json;
  const out: Mutant[] = [];
  const set = (path: Path, label: string, next: Json) =>
    out.push({
      label: `${where(path)}: ${label}`,
      draft: edited(root, path, (p, k) => {
        (p as Record<string | number, Json>)[k] = next;
      }),
    });
  for (const { path, value } of leaves(root)) {
    if (typeof value === "string" && !isItemName(path)) {
      const last = value.charCodeAt(value.length - 1);
      const variants: [string, Json][] = [
        ["a zero-width space appended", `${value}\u200b`],
        ["its last character changed", `${value.slice(0, -1)}${String.fromCharCode(last + 1)}`],
        ["a leading space", ` ${value}`],
        ["its letter case swapped", swapCase(value)],
        ["a number in its place", Number.isNaN(Number(value)) ? 0 : Number(value)],
        ["null in its place", null],
      ];
      for (const [how, next] of variants) if (next !== value) set(path, how, next);
    }
    if (path.length > 0) {
      out.push({
        label: `${where(path)}: removed`,
        draft: edited(root, path, (p, k) => {
          if (Array.isArray(p)) p.splice(k as number, 1);
          else delete p[k as string];
        }),
      });
    }
    if (isRecord(value)) {
      const extra = structuredClone(root);
      let target: Json = extra;
      for (const k of path) target = (target as Record<string | number, Json>)[k] as Json;
      (target as Record<string, Json>).discount = "0.00";
      out.push({ label: `${where(path)}: an extra key`, draft: extra });
    }
    if (Array.isArray(value) && value.length > 0) {
      const appended = structuredClone(root);
      let list: Json = appended;
      for (const k of path) list = (list as Record<string | number, Json>)[k] as Json;
      (list as Json[]).push(structuredClone((list as Json[]).at(-1) as Json));
      out.push({ label: `${where(path)}: an entry added`, draft: appended });
      if (value.length > 1) {
        const reversed = structuredClone(root);
        let rev: Json = reversed;
        for (const k of path) rev = (rev as Record<string | number, Json>)[k] as Json;
        (rev as Json[]).reverse();
        out.push({ label: `${where(path)}: reordered`, draft: reversed });
      }
    }
  }
  return out;
}
