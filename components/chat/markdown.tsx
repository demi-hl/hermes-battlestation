"use client";

import { Fragment, useState, type ReactNode } from "react";
import { MediaActions, copyText } from "./MessageActions";
import { haptic } from "@/components/shell/haptics";

type ListItem = { text: string; checked?: boolean };
type ListState = { ordered: boolean; items: ListItem[] };
type Block = { type: "code" | "prose"; content: string; lang?: string };

export function Markdown({ text, pending = false }: { text: string; pending?: boolean }) {
  const blocks = splitFences(text);
  return (
    <div className="hermes-md space-y-2.5 text-[0.92rem] leading-relaxed text-text-primary">
      {blocks.map((b, i) =>
        b.type === "code" ? (
          <CodeBlock key={i} lang={b.lang} content={b.content} />
        ) : (
          <Fragment key={i}>
            {renderProse(b.content)}
            {pending && i === blocks.length - 1 && (
              <span aria-hidden className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.18em] rounded-full bg-midground/70 animate-caret-blink align-baseline" />
            )}
          </Fragment>
        ),
      )}
    </div>
  );
}

function CodeBlock({ lang, content }: { lang?: string; content: string }) {
  const [copied, setCopied] = useState(false);
  const command = commandText(content, lang);

  const copyCommand = async () => {
    if (!command) return;
    void haptic(8);
    await copyText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <pre className="hermes-md-enter relative overflow-x-auto rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_5%,transparent)] p-3 pr-14">
      <span className="mb-2 flex items-center justify-between gap-3">
        {lang ? (
          <span className="font-mono-ui text-[0.58rem] uppercase tracking-wider text-text-tertiary">{lang}</span>
        ) : (
          <span aria-hidden />
        )}
        {command && (
          <button
            type="button"
            aria-label="Copy command"
            onClick={copyCommand}
            className="shrink-0 rounded-full border border-border/70 px-2 py-1 font-mono-ui text-[0.55rem] uppercase tracking-[0.12em] text-text-tertiary transition-colors hover:text-midground active:scale-95"
          >
            {copied ? "copied" : "copy"}
          </button>
        )}
      </span>
      <code className="font-mono text-[0.8rem] leading-relaxed text-text-secondary">{content}</code>
    </pre>
  );
}

function splitFences(text: string): Block[] {
  const out: Block[] = [];
  const re = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: "prose", content: text.slice(last, m.index) });
    out.push({ type: "code", lang: m[1].trim(), content: m[2].replace(/\n$/, "") });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ type: "prose", content: text.slice(last) });
  return out.length ? out : [{ type: "prose", content: text }];
}

function renderProse(prose: string): ReactNode {
  const lines = prose.replace(/\n{3,}/g, "\n\n").split("\n");
  const nodes: ReactNode[] = [];
  let list: ListState | null = null;
  let para: string[] = [];

  const flushPara = (key: string) => {
    if (!para.length) return;
    nodes.push(<p key={key} className="hermes-md-enter whitespace-pre-wrap break-words">{inline(para.join("\n"))}</p>);
    para = [];
  };

  const flushList = (key: string) => {
    if (!list) return;
    const L = list;
    nodes.push(
      L.ordered ? (
        <ol key={key} className="hermes-md-enter ml-4 list-decimal space-y-1 marker:text-text-tertiary">
          {L.items.map((it, i) => <li key={i} className="break-words pl-1">{inline(it.text)}</li>)}
        </ol>
      ) : (
        <ul key={key} className="hermes-md-enter ml-1 space-y-1">
          {L.items.map((it, i) => (
            <li key={i} className="flex gap-2">
              {typeof it.checked === "boolean" ? (
                <span className="mt-[0.25em] grid h-4 w-4 shrink-0 place-items-center rounded border border-border bg-[color-mix(in_srgb,var(--midground)_5%,transparent)] text-[0.6rem] text-midground">{it.checked ? "✓" : ""}</span>
              ) : (
                <span className="mt-[0.5em] h-1 w-1 shrink-0 rounded-full bg-text-tertiary" />
              )}
              <span className="min-w-0 break-words">{inline(it.text)}</span>
            </li>
          ))}
        </ul>
      ),
    );
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const media = parseMediaLine(line);
    if (media) {
      flushPara(`p${i}`); flushList(`l${i}`);
      nodes.push(<MediaEmbed key={`m${i}`} src={media.src} kind={media.kind} alt={media.alt} />);
      continue;
    }

    if (isTableStart(lines, i)) {
      flushPara(`p${i}`); flushList(`l${i}`);
      const parsed = collectTable(lines, i);
      nodes.push(<MarkdownTable key={`t${i}`} headers={parsed.headers} rows={parsed.rows} />);
      i = parsed.next - 1;
      continue;
    }

    const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);

    if (task) {
      flushPara(`p${i}`);
      if (!list || list.ordered) flushList(`l${i}`);
      list = list ?? { ordered: false, items: [] };
      list.items.push({ text: task[2], checked: task[1].toLowerCase() === "x" });
      continue;
    }
    if (bullet) {
      flushPara(`p${i}`);
      if (!list || list.ordered) flushList(`l${i}`);
      list = list ?? { ordered: false, items: [] };
      list.items.push({ text: bullet[1] });
      continue;
    }
    if (numbered) {
      flushPara(`p${i}`);
      if (!list || !list.ordered) flushList(`l${i}`);
      list = list ?? { ordered: true, items: [] };
      list.items.push({ text: numbered[1] });
      continue;
    }
    flushList(`l${i}`);

    if (/^\s*---+\s*$/.test(line)) {
      flushPara(`p${i}`);
      nodes.push(<hr key={`hr${i}`} className="hermes-md-enter border-border/70" />);
      continue;
    }
    if (heading) {
      flushPara(`p${i}`);
      const sizes = ["text-[1.05rem]", "text-[0.95rem]", "text-[0.86rem]", "text-[0.8rem]"];
      nodes.push(<p key={i} className={`hermes-md-enter font-mondwest text-display ${sizes[heading[1].length - 1]} tracking-wide text-midground`}>{inline(heading[2])}</p>);
      continue;
    }
    if (quote) {
      flushPara(`p${i}`);
      nodes.push(<blockquote key={`q${i}`} className="hermes-md-enter border-l-2 border-midground/40 pl-3 text-text-secondary">{inline(quote[1])}</blockquote>);
      continue;
    }
    if (!line.trim()) {
      flushPara(`p${i}`);
      continue;
    }
    para.push(line);
  }
  flushList("lend");
  flushPara("pend");
  return <>{nodes}</>;
}

function isTableStart(lines: string[], i: number): boolean {
  return !!lines[i]?.includes("|") && !!lines[i + 1] && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1]);
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((x) => x.trim());
}

function collectTable(lines: string[], start: number): { headers: string[]; rows: string[][]; next: number } {
  const headers = splitRow(lines[start]);
  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
    rows.push(splitRow(lines[i]));
    i++;
  }
  return { headers, rows, next: i };
}

function MarkdownTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="hermes-md-enter overflow-x-auto rounded-[var(--radius-md)] border border-border">
      <table className="min-w-full border-collapse text-left text-[0.78rem]">
        <thead className="bg-[color-mix(in_srgb,var(--midground)_8%,transparent)] text-midground">
          <tr>{headers.map((h, i) => <th key={i} className="border-b border-border px-2.5 py-2 font-medium">{inline(h)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/60">
              {headers.map((_, j) => <td key={j} className="px-2.5 py-2 text-text-secondary align-top">{inline(r[j] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(~~[^~]+~~)|(==[^=]+==)|(\|\|[^|]+\|\|)|(\*[^*\n]+\*)|(\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      parts.push(<code key={k++} className="rounded bg-[color-mix(in_srgb,var(--midground)_10%,transparent)] px-1 py-0.5 font-mono text-[0.78em] text-midground">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**")) {
      parts.push(<strong key={k++} className="font-semibold text-midground">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("__")) {
      parts.push(<span key={k++} className="underline decoration-text-tertiary underline-offset-2">{tok.slice(2, -2)}</span>);
    } else if (tok.startsWith("~~")) {
      parts.push(<span key={k++} className="line-through decoration-text-tertiary">{tok.slice(2, -2)}</span>);
    } else if (tok.startsWith("==")) {
      parts.push(<mark key={k++} className="rounded bg-[color-mix(in_srgb,var(--color-warning)_22%,transparent)] px-0.5 text-text-primary">{tok.slice(2, -2)}</mark>);
    } else if (tok.startsWith("||")) {
      parts.push(<span key={k++} className="rounded bg-midground/80 px-1 text-background-base active:bg-midground/20 active:text-text-primary">{tok.slice(2, -2)}</span>);
    } else if (tok.startsWith("[")) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      parts.push(lm ? <a key={k++} href={lm[2]} target="_blank" rel="noopener noreferrer" className="break-all text-midground underline decoration-text-tertiary underline-offset-2">{lm[1]}</a> : tok);
    } else {
      parts.push(<em key={k++} className="italic">{tok.slice(1, -1)}</em>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

function commandText(content: string, lang?: string): string | null {
  const normalized = content
    .split("\n")
    .map((line) => line.replace(/^\s*[$❯>]\s?/, "").trimEnd())
    .join("\n")
    .trim();
  if (!normalized) return null;
  const language = (lang ?? "").toLowerCase();
  if (/^(bash|sh|shell|zsh|fish|console|terminal)$/.test(language)) return normalized;
  if (/^(json|yaml|yml|toml|tsx?|jsx?|css|html|markdown|md|diff|python|py)$/.test(language)) return null;
  const first = normalized.split("\n").find((line) => line.trim() && !line.trim().startsWith("#"))?.trim() ?? "";
  if (!first) return null;
  return /^(cd|npm|npx|pnpm|yarn|bun|node|python3?|uv|git|gh|curl|wget|ssh|scp|rsync|docker|docker-compose|kubectl|systemctl|journalctl|hermes|claude|codex|ffmpeg|ffprobe|xcodebuild|make|cargo|go|rustup|pipx?|brew|sudo)\b/.test(first)
    ? normalized
    : null;
}

const IMG_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|svg)(\?[^\s]*)?$/i;
const VID_EXT = /\.(mp4|webm|mov|m4v)(\?[^\s]*)?$/i;
const AUD_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba)(\?[^\s]*)?$/i;

function mediaKind(raw: string): "image" | "video" | "audio" {
  if (VID_EXT.test(raw)) return "video";
  if (AUD_EXT.test(raw)) return "audio";
  return "image";
}

function parseMediaLine(line: string): { src: string; kind: "image" | "video" | "audio"; alt: string } | null {
  const t = line.trim();
  if (!t) return null;
  const md = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
  if (md) return { src: toSrc(md[2]), kind: mediaKind(md[2]), alt: md[1] };
  const mediaDirective = t.match(/^MEDIA:\s*(\S+)$/);
  if (mediaDirective) return { src: toSrc(mediaDirective[1]), kind: mediaKind(mediaDirective[1]), alt: "" };
  if (!/\s/.test(t) && (IMG_EXT.test(t) || VID_EXT.test(t) || AUD_EXT.test(t))) return { src: toSrc(t), kind: mediaKind(t), alt: "" };
  return null;
}

function toSrc(raw: string): string {
  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) return raw;
  return `/api/media?path=${encodeURIComponent(raw.replace(/^~(?=\/)/, ""))}`;
}

function MediaEmbed({ src, kind, alt }: { src: string; kind: "image" | "video" | "audio"; alt: string }) {
  const media =
    kind === "video" ? (
      <video src={src} controls playsInline preload="metadata" className="max-h-[420px] w-full rounded-[var(--radius-md)] border border-border bg-black" />
    ) : kind === "audio" ? (
      <audio src={src} controls preload="metadata" className="w-full max-w-[420px]" />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt} decoding="async" className="max-h-[420px] w-auto max-w-full rounded-[var(--radius-md)] border border-border object-contain" />
    );

  return (
    <div className="hermes-md-enter space-y-1.5">
      {media}
      <MediaActions src={src} kind={kind} alt={alt} className={kind === "audio" ? "max-w-[420px]" : undefined} />
    </div>
  );
}
