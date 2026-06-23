"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Minimal, dependency-free markdown renderer for assistant turns. Handles the
 * subset the Hermes agent actually emits in chat: fenced code blocks, inline
 * code, bold, headings, and bullet/numbered lists. Deliberately small (no
 * markdown lib added to the bundle) and calm, matching the desktop Hermes chat
 * aesthetic (plain text on background, code as light chips/blocks).
 */
export function Markdown({ text, pending = false }: { text: string; pending?: boolean }) {
  const blocks = splitFences(text);
  return (
    <div className="space-y-2.5 text-[0.92rem] leading-relaxed text-text-primary">
      {blocks.map((b, i) =>
        b.type === "code" ? (
          <pre
            key={i}
            className="overflow-x-auto rounded-[var(--radius-md)] border border-border bg-[color-mix(in_srgb,var(--midground)_5%,transparent)] p-3"
          >
            <code className="font-mono text-[0.8rem] leading-relaxed text-text-secondary">
              {b.content}
            </code>
          </pre>
        ) : (
          <Fragment key={i}>
            {renderProse(b.content)}
            {/* Streaming caret on the last prose block while tokens arrive —
                eases the per-token "pop" by showing a steady live cursor. */}
            {pending && i === blocks.length - 1 && (
              <span
                aria-hidden
                className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.18em] rounded-full bg-midground/70 animate-caret-blink align-baseline"
              />
            )}
          </Fragment>
        ),
      )}
    </div>
  );
}

type Block = { type: "code" | "prose"; content: string };

function splitFences(text: string): Block[] {
  const out: Block[] = [];
  const re = /```[^\n]*\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: "prose", content: text.slice(last, m.index) });
    out.push({ type: "code", content: m[1].replace(/\n$/, "") });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ type: "prose", content: text.slice(last) });
  return out.length ? out : [{ type: "prose", content: text }];
}

function renderProse(prose: string): ReactNode {
  // Collapse 3+ blank lines to a single paragraph break, then split into
  // paragraph groups on blank lines so spacing is consistent (one gap between
  // paragraphs, not a gap per newline). Within a group, single newlines become
  // soft line breaks so multi-line sentences stay together visually.
  const lines = prose.replace(/\n{3,}/g, "\n\n").split("\n");
  const nodes: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];

  const flushPara = (key: string) => {
    if (!para.length) return;
    const joined = para.join("\n");
    nodes.push(
      <p key={key} className="whitespace-pre-wrap break-words">
        {inline(joined)}
      </p>,
    );
    para = [];
  };

  const flushList = (key: string) => {
    if (!list) return;
    const L = list;
    nodes.push(
      L.ordered ? (
        <ol key={key} className="ml-4 list-decimal space-y-1 marker:text-text-tertiary">
          {L.items.map((it, i) => (
            <li key={i} className="break-words pl-1">{inline(it)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="ml-1 space-y-1">
          {L.items.map((it, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-[0.5em] h-1 w-1 shrink-0 rounded-full bg-text-tertiary" />
              <span className="min-w-0 break-words">{inline(it)}</span>
            </li>
          ))}
        </ul>
      ),
    );
    list = null;
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    // Media on its own line: ![alt](url) image, or a bare MEDIA:/path or
    // image/video URL the render pipeline emits. Render as real <img>/<video>.
    const media = parseMediaLine(line);
    if (media) {
      flushPara(`p${i}`);
      flushList(`l${i}`);
      nodes.push(<MediaEmbed key={`m${i}`} src={media.src} kind={media.kind} alt={media.alt} />);
      return;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^(#{1,4})\s+(.*)$/);

    if (bullet) {
      flushPara(`p${i}`);
      if (!list || list.ordered) flushList(`l${i}`);
      list = list ?? { ordered: false, items: [] };
      list.items.push(bullet[1]);
      return;
    }
    if (numbered) {
      flushPara(`p${i}`);
      if (!list || !list.ordered) flushList(`l${i}`);
      list = list ?? { ordered: true, items: [] };
      list.items.push(numbered[1]);
      return;
    }
    flushList(`l${i}`);

    if (heading) {
      flushPara(`p${i}`);
      nodes.push(
        <p
          key={i}
          className="font-mondwest text-display text-[0.82rem] tracking-wide text-midground"
        >
          {inline(heading[2])}
        </p>,
      );
      return;
    }
    // Blank line = paragraph boundary; otherwise accumulate into the paragraph.
    if (!line.trim()) {
      flushPara(`p${i}`);
      return;
    }
    para.push(line);
  });
  flushList("lend");
  flushPara("pend");
  return <>{nodes}</>;
}

// Inline: `code`, **bold**, *italic*, [text](url). Order matters — code first
// so backtick contents are never re-parsed as bold/italic/links.
function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      parts.push(
        <code
          key={k++}
          className="rounded bg-[color-mix(in_srgb,var(--midground)_10%,transparent)] px-1 py-0.5 font-mono text-[0.78em] text-midground"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      parts.push(
        <strong key={k++} className="font-semibold text-midground">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("[")) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (lm) {
        parts.push(
          <a
            key={k++}
            href={lm[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-midground underline decoration-text-tertiary underline-offset-2 break-all"
          >
            {lm[1]}
          </a>,
        );
      } else {
        parts.push(tok);
      }
    } else {
      // *italic*
      parts.push(
        <em key={k++} className="italic">
          {tok.slice(1, -1)}
        </em>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

const IMG_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|svg)(\?[^\s]*)?$/i;
const VID_EXT = /\.(mp4|webm|mov|m4v)(\?[^\s]*)?$/i;

/**
 * Detect a line that is *just* a piece of media so it renders as a real
 * <img>/<video> instead of plain text. Handles three shapes the Hermes agent
 * emits:
 *   1. `![alt](url-or-path)`            markdown image
 *   2. `MEDIA:/abs/path/to/file.mp4`    gateway media directive
 *   3. a bare image/video URL on its own line
 * Local paths are routed through /api/media so the WebView can load files that
 * live on the host filesystem.
 */
function parseMediaLine(
  line: string,
): { src: string; kind: "image" | "video"; alt: string } | null {
  const t = line.trim();
  if (!t) return null;

  // 1. ![alt](src)
  const md = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
  if (md) {
    const raw = md[2];
    return { src: toSrc(raw), kind: VID_EXT.test(raw) ? "video" : "image", alt: md[1] };
  }

  // 2. MEDIA:/path  (optionally the whole line is just that)
  const mediaDirective = t.match(/^MEDIA:\s*(\S+)$/);
  if (mediaDirective) {
    const raw = mediaDirective[1];
    return { src: toSrc(raw), kind: VID_EXT.test(raw) ? "video" : "image", alt: "" };
  }

  // 3. bare URL/path on its own line ending in a known media extension
  if (!/\s/.test(t) && (IMG_EXT.test(t) || VID_EXT.test(t))) {
    return { src: toSrc(t), kind: VID_EXT.test(t) ? "video" : "image", alt: "" };
  }

  return null;
}

/** Local filesystem paths → proxied through the media route; URLs pass through. */
function toSrc(raw: string): string {
  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) return raw;
  // absolute or ~ path → media proxy
  const path = raw.replace(/^~(?=\/)/, "");
  return `/api/media?path=${encodeURIComponent(path)}`;
}

function MediaEmbed({
  src,
  kind,
  alt,
}: {
  src: string;
  kind: "image" | "video";
  alt: string;
}) {
  if (kind === "video") {
    return (
      <video
        src={src}
        controls
        playsInline
        preload="metadata"
        className="max-h-[420px] w-full rounded-[var(--radius-md)] border border-border bg-black"
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      decoding="async"
      className="max-h-[420px] w-auto max-w-full rounded-[var(--radius-md)] border border-border object-contain"
    />
  );
}
