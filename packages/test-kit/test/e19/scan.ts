// E-19 scanner: which files are public copy, how their sentences are read, and how findings meet allowances.
// Markdown is read paragraph by paragraph (fenced code and HTML comments are not copy). TypeScript copy modules
// are parsed with the TypeScript compiler, so only string literals, template literals and JSX text are read:
// comments, property keys, import paths and dotted message keys are code, not copy.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { figuresIn, ic03Figures } from "./figures.js";
import { type Allowance, type CopyRule, FIGURES_RULE, RULES } from "./rules.js";

export interface Sentence {
  readonly text: string;
  readonly line: number;
  /** The containing source literal, so an allowance can distinguish identical sentences in different footers. */
  readonly literal?: string;
  /** A literal with no whitespace (a word, key or code value): only `token` rules read it. */
  readonly token: boolean;
}

export interface Finding {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly sentence: string;
  readonly literal?: string;
  readonly match: string;
}

// ------------------------------------------------------------------ scope

export interface Area {
  readonly name: string;
  /** Repo-relative files or `{ dir, match }` walks; a missing file is fine when `optional`. */
  readonly files?: readonly string[];
  readonly walk?: { readonly dir: string; readonly match: RegExp };
  readonly optional?: boolean;
}

/** What E-19 reads (schedule §3 Q2, "Scope"). Tests and generated files are never copy. */
export const AREAS: readonly Area[] = [
  { name: "README", files: ["README.md"] },
  // Generated from IC-03 by tools/devpost-text.ts (S2); required now that it ships.
  { name: "Devpost text", files: ["docs/devpost.md"] },
  { name: "film script", files: ["video/script.ts"], optional: true },
  { name: "judge rail notices", files: ["apps/api/src/judge/quota.ts"] },
  // REVIEW.md is rendered from these catalogs, so it is not read twice.
  { name: "i18n catalogs", walk: { dir: "packages/i18n/src", match: /\.ts$/ } },
  {
    name: "console copy",
    // Every console source file: copy lives in copy.ts and errors.ts, but also in the stage's run-log rows
    // (stage/Stage.tsx), Proof's plates (proof/Chain.tsx), the brand header and the ops page. The prototype
    // gallery is WS-DS's and not public copy.
    walk: { dir: "apps/console/src", match: /^apps\/console\/src\/(?!prototype\/).+\.tsx?$/ },
    optional: true,
  },
  {
    name: "app catalogs",
    walk: { dir: "apps/mobile/src", match: /\/messages\.ts$|^apps\/mobile\/src\/_shims\/i18n\.ts$/ },
  },
  // The statement's AI_NOTE (T1): the product note may exist only beside its seeded variant. §6 names both homes:
  // the API's templates and the app's demo statement shim, which K1d replaces with T1's seeded plan.
  {
    name: "statement templates",
    files: ["apps/api/src/statements/templates.ts", "apps/mobile/src/_shims/seed.ts"],
  },
];

const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", "coverage", "test", "__tests__"]);
const isTest = (p: string) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(p);

function walk(root: string, dir: string, match: RegExp, out: string[]): void {
  const abs = resolve(root, dir);
  if (!existsSync(abs)) return;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, rel, match, out);
    } else if (match.test(rel) && !isTest(rel) && !rel.endsWith(".gen.ts")) out.push(rel);
  }
}

/** The scanned files of each area, repo-relative and sorted. */
export function scopeFiles(root: string, areas: readonly Area[] = AREAS): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const area of areas) {
    const files: string[] = [];
    for (const f of area.files ?? []) if (existsSync(resolve(root, f))) files.push(f);
    if (area.walk) walk(root, area.walk.dir, area.walk.match, files);
    out.set(area.name, files.sort());
  }
  return out;
}

// ------------------------------------------------------------------ sentences

/** Splits text into sentences at . ! ? followed by a capital, a quote, a bracket or a placeholder. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘'([{_*`₱$])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Markdown inline marks removed: emphasis, code ticks, links (their text stays) and images. */
function plain(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/(^|[\s(])_(?=\S)/g, "$1")
    .replace(/(?<=\S)_(?=[\s).,:;!?]|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function markdownSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let block: { kind: string; text: string; line: number } | undefined;
  const flush = () => {
    if (block)
      for (const s of sentences(plain(block.text))) out.push({ text: s, line: block.line, token: false });
    block = undefined;
  };
  let fence = false;
  let comment = false;
  for (const [i, raw] of lines.entries()) {
    const line = raw.trimEnd();
    if (/^\s*(?:```|~~~)/.test(line)) {
      flush();
      fence = !fence;
      continue;
    }
    if (fence) continue;
    if (comment || /^\s*<!--/.test(line)) {
      flush();
      comment = !line.includes("-->");
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    const start = /^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|\||>)/.exec(line)?.[1];
    if (start) {
      const kind = start.trim().startsWith("#")
        ? "heading"
        : start.trim() === "|"
          ? "table"
          : start.trim() === ">"
            ? "quote"
            : "list";
      const body = line.replace(/^\s*(?:#{1,6}\s|[-*+]\s|\d+\.\s|>\s?)/, "");
      if (kind === "quote" && block?.kind === "quote") {
        block.text += ` ${body}`;
        continue;
      }
      flush();
      if (kind === "table" && /^\s*\|[\s|:-]+\|\s*$/.test(line)) continue; // the header rule
      block = { kind, text: kind === "table" ? line.replace(/\|/g, " | ") : body, line: i + 1 };
      if (kind === "heading" || kind === "table") flush();
      continue;
    }
    if (block) block.text += ` ${line}`;
    else block = { kind: "para", text: line, line: i + 1 };
  }
  flush();
  return out;
}

/** A dotted key or code value such as "W-JG-01.notice" or "money.sandbox": code, not copy. */
const DOTTED_KEY = /^[\w$-]+(?:\.[\w$-]+)+$/;
/** An enum value such as "CERTIFIED" or "PAYPAL_PENDING": code, not copy. */
const ENUM_VALUE = /^[A-Z0-9_]+$/;

export function sourceSentences(file: string, text: string): Sentence[] {
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: Sentence[] = [];
  const push = (raw: string, node: ts.Node) => {
    const value = raw.replace(/\s+/g, " ").trim();
    if (!value || DOTTED_KEY.test(value) || ENUM_VALUE.test(value)) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const token = !/\s/.test(value);
    for (const s of token ? [value] : sentences(value)) out.push({ text: s, line, token, literal: value });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return;
    if (ts.isPropertyAssignment(node)) {
      visit(node.initializer);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) {
      push(node.text, node);
    } else {
      if (ts.isTemplateExpression(node)) {
        push(node.head.text + node.templateSpans.map((s) => `{}${s.literal.text}`).join(""), node);
      }
      ts.forEachChild(node, visit);
    }
  };
  visit(sf);
  return out;
}

export function sentencesOf(file: string, text: string): Sentence[] {
  return /\.(?:md|mdx|txt)$/i.test(file) ? markdownSentences(text) : sourceSentences(file, text);
}

// ------------------------------------------------------------------ lint

/** Every rule and figure finding in one file's text. */
export function lintText(file: string, text: string, rules: readonly CopyRule[] = RULES): Finding[] {
  const all = sentencesOf(file, text);
  const joined = all.map((s) => s.text).join("\n");
  const figures = ic03Figures();
  const out: Finding[] = [];
  for (const s of all) {
    for (const rule of rules) {
      if (s.token && !rule.token) continue;
      const m = rule.pattern.exec(s.text);
      if (!m) continue;
      if (rule.context && !rule.context.test(s.text)) continue;
      if (rule.unless?.test(s.text)) continue;
      if (rule.unlessInFile?.test(joined)) continue;
      out.push({ rule: rule.id, file, line: s.line, sentence: s.text, literal: s.literal, match: m[0] });
    }
    for (const f of figuresIn(s.text)) {
      if (!figures.has(f))
        out.push({ rule: FIGURES_RULE.id, file, line: s.line, sentence: s.text, match: f.text });
    }
  }
  return out;
}

export function lintFiles(root: string, files: readonly string[]): Finding[] {
  return files.flatMap((f) => lintText(f, readFileSync(resolve(root, f), "utf8")));
}

export const allowanceCovers = (a: Allowance, f: Finding): boolean =>
  a.rule === f.rule &&
  a.file === f.file &&
  (a.inLiteral ? (f.literal ?? f.sentence) : f.sentence).toLowerCase().includes(a.phrase.toLowerCase());

export interface Verdict {
  /** Findings no allowance covers: each one fails the lint. */
  readonly violations: readonly Finding[];
  /** Findings an allowance covers, with the allowance. */
  readonly allowed: readonly { readonly finding: Finding; readonly allowance: Allowance }[];
  /** Allowances whose file is scanned but whose sentence no longer fires: delete them. */
  readonly stale: readonly Allowance[];
  /** Allowances whose file is not in the tree yet (ws/console unmerged). */
  readonly dormant: readonly Allowance[];
}

export function judge(
  findings: readonly Finding[],
  allowances: readonly Allowance[],
  scanned: ReadonlySet<string>,
): Verdict {
  const violations: Finding[] = [];
  const allowed: { finding: Finding; allowance: Allowance }[] = [];
  for (const finding of findings) {
    const allowance = allowances.find((a) => allowanceCovers(a, finding));
    if (allowance) allowed.push({ finding, allowance });
    else violations.push(finding);
  }
  const stale = allowances.filter((a) => scanned.has(a.file) && !allowed.some((x) => x.allowance === a));
  const dormant = allowances.filter((a) => !scanned.has(a.file));
  return { violations, allowed, stale, dormant };
}

export const describeFinding = (f: Finding): string => {
  const why = RULES.find((r) => r.id === f.rule)?.reason ?? FIGURES_RULE.reason;
  return `${f.file}:${f.line} [${f.rule}] "${f.match}" in "${f.sentence}" (${why})`;
};
