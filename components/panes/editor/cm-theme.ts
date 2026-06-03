import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/**
 * Hermes CodeMirror theme. Every color references a live app CSS var (the same
 * tokens the 8-theme switcher rewrites at runtime), so the editor recolors with
 * the rest of the app and the transparent ground lets the signature Backdrop
 * show through. Mono numerics, calm 2-accent syntax (Linear/Warp restraint).
 */

const mid = "var(--midground)";
const midBase = "var(--midground-base)";
const tertiary = "var(--color-text-tertiary)";

export const hermesEditorTheme: Extension = EditorView.theme(
  {
    "&": {
      color: mid,
      backgroundColor: "transparent",
      height: "100%",
      fontSize: "13px",
    },
    ".cm-scroller": {
      fontFamily: "var(--theme-font-mono)",
      lineHeight: "1.6",
      WebkitOverflowScrolling: "touch",
    },
    ".cm-content": {
      caretColor: mid,
      paddingBottom: "40vh",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: mid,
      borderLeftWidth: "2px",
    },
    "&.cm-focused .cm-cursor": {
      animation: "blink 1s step-end infinite",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
      {
        backgroundColor: `color-mix(in srgb, ${midBase} 24%, transparent)`,
      },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: `color-mix(in srgb, ${midBase} 40%, transparent)`,
      border: "none",
      fontFamily: "var(--theme-font-mono)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: mid,
    },
    ".cm-activeLine": {
      backgroundColor: `color-mix(in srgb, ${midBase} 5%, transparent)`,
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 8px 0 12px",
    },
    ".cm-foldGutter .cm-gutterElement": { color: tertiary },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      backgroundColor: `color-mix(in srgb, ${midBase} 18%, transparent)`,
      outline: `1px solid color-mix(in srgb, ${midBase} 40%, transparent)`,
      color: "inherit",
    },
    ".cm-selectionMatch": {
      backgroundColor: `color-mix(in srgb, ${midBase} 14%, transparent)`,
    },
    // Search panel — themed to match the sheet chrome.
    ".cm-panels": {
      backgroundColor: "color-mix(in srgb, var(--background-base) 88%, transparent)",
      color: mid,
      borderColor: "var(--color-border)",
      backdropFilter: "blur(12px)",
    },
    ".cm-panel.cm-search": {
      padding: "8px 10px",
      fontFamily: "var(--theme-font-sans)",
    },
    ".cm-panel.cm-search input, .cm-textfield": {
      backgroundColor: `color-mix(in srgb, ${midBase} 8%, transparent)`,
      color: mid,
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-md)",
      padding: "3px 7px",
      fontFamily: "var(--theme-font-mono)",
    },
    ".cm-panel.cm-search button, .cm-button": {
      backgroundColor: `color-mix(in srgb, ${midBase} 8%, transparent)`,
      color: mid,
      backgroundImage: "none",
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-md)",
      padding: "2px 8px",
      cursor: "pointer",
    },
    ".cm-panel.cm-search label": { color: tertiary, fontSize: "0.72rem" },
    ".cm-tooltip": {
      backgroundColor: "color-mix(in srgb, var(--background-base) 92%, transparent)",
      color: mid,
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-md)",
      backdropFilter: "blur(12px)",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: `color-mix(in srgb, ${midBase} 16%, transparent)`,
      color: mid,
    },
  },
  { dark: true },
);

const warning = "var(--color-warning)";
const success = "var(--color-success)";

export const hermesHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: `color-mix(in srgb, ${midBase} 46%, transparent)`, fontStyle: "italic" },
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword], color: warning },
  { tag: [t.string, t.special(t.string)], color: success },
  { tag: [t.number, t.bool, t.null, t.atom], color: `color-mix(in srgb, ${success} 65%, ${mid})` },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: mid, fontWeight: "600" },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: mid },
  { tag: [t.variableName, t.propertyName], color: `color-mix(in srgb, ${midBase} 84%, transparent)` },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: `color-mix(in srgb, ${warning} 78%, ${mid})` },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: tertiary },
  { tag: [t.propertyName, t.attributeName], color: `color-mix(in srgb, ${midBase} 80%, transparent)` },
  { tag: [t.meta, t.annotation], color: tertiary },
  { tag: t.heading, color: mid, fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: [t.link, t.url], color: success, textDecoration: "underline" },
  { tag: t.invalid, color: "var(--color-destructive)" },
]);

export const hermesHighlight: Extension = syntaxHighlighting(
  hermesHighlightStyle,
);
