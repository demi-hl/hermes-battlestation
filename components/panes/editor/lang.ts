import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";

export interface LangInfo {
  label: string;
  /** Lazy so the CM language extension is only built for opened files. */
  extension: () => Extension | null;
  /** Regex that captures a symbol name in group 1, per line. */
  symbol?: RegExp;
}

function ext(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : name.toLowerCase();
}

const JS_SYM =
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+([A-Za-z0-9_$]+)|(?:const|let|var|class)\s+([A-Za-z0-9_$]+)|([A-Za-z0-9_$]+)\s*(?:[:=]\s*(?:async\s*)?\(|\([^)]*\)\s*\{))/;
const PY_SYM = /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z0-9_]+)/;
const MD_SYM = /^#{1,6}\s+(.+?)\s*$/;
const CSS_SYM = /^\s*([.#]?[A-Za-z0-9_-]+(?:\s*[,>][^{]*)?)\s*\{/;

const MAP: Record<string, LangInfo> = {
  ts: { label: "TypeScript", extension: () => javascript({ typescript: true }), symbol: JS_SYM },
  tsx: { label: "TSX", extension: () => javascript({ typescript: true, jsx: true }), symbol: JS_SYM },
  js: { label: "JavaScript", extension: () => javascript(), symbol: JS_SYM },
  jsx: { label: "JSX", extension: () => javascript({ jsx: true }), symbol: JS_SYM },
  mjs: { label: "JavaScript", extension: () => javascript(), symbol: JS_SYM },
  cjs: { label: "JavaScript", extension: () => javascript(), symbol: JS_SYM },
  py: { label: "Python", extension: () => python(), symbol: PY_SYM },
  md: { label: "Markdown", extension: () => markdown(), symbol: MD_SYM },
  mdx: { label: "MDX", extension: () => markdown(), symbol: MD_SYM },
  markdown: { label: "Markdown", extension: () => markdown(), symbol: MD_SYM },
  json: { label: "JSON", extension: () => json() },
  jsonc: { label: "JSON", extension: () => json() },
  webmanifest: { label: "JSON", extension: () => json() },
  css: { label: "CSS", extension: () => css(), symbol: CSS_SYM },
  scss: { label: "SCSS", extension: () => css(), symbol: CSS_SYM },
  html: { label: "HTML", extension: () => html() },
  htm: { label: "HTML", extension: () => html() },
  vue: { label: "HTML", extension: () => html() },
  svg: { label: "HTML", extension: () => html() },
};

const PLAIN: LangInfo = { label: "Text", extension: () => null };

export function langFor(filename: string): LangInfo {
  return MAP[ext(filename)] ?? PLAIN;
}

export interface SymbolHit {
  name: string;
  line: number; // 1-based
}

/** Cheap go-to-symbol: regex-scan the doc for the language's declarations. */
export function extractSymbols(filename: string, doc: string): SymbolHit[] {
  const info = langFor(filename);
  if (!info.symbol) return [];
  const re = info.symbol;
  const hits: SymbolHit[] = [];
  const lines = doc.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    const name = m[1] || m[2] || m[3];
    if (name) hits.push({ name, line: i + 1 });
  }
  return hits;
}
