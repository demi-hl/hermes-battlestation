"use client";

import { useEffect, useMemo, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import {
  openSearchPanel,
  closeSearchPanel,
  search,
} from "@codemirror/search";
import { basicSetup } from "codemirror";
import { hermesEditorTheme, hermesHighlight } from "./cm-theme";
import { langFor } from "./lang";

export interface CodeEditorHandle {
  openSearch: () => void;
  openReplace: () => void;
  closeSearch: () => void;
  gotoLine: (line: number) => void;
  getValue: () => string;
  getSelection: () => { from: number; to: number; text: string } | undefined;
  focus: () => void;
}

interface CodeEditorProps {
  /** Stable key for the open file; changing it reloads the document. */
  docKey: string;
  filename: string;
  initialValue: string;
  onChange: (value: string) => void;
  /** Receives the imperative handle once the view is mounted. */
  onReady?: (handle: CodeEditorHandle) => void;
}

/**
 * CodeMirror 6 surface (touch-native, not Monaco). One EditorView; switching the
 * open tab swaps the whole EditorState (parent owns each tab's content + dirty).
 * The imperative handle (find/replace/go-to-line) is delivered via `onReady` so
 * the component stays dynamic-import friendly (no ref forwarding through
 * next/dynamic). Mounts only in the browser (EditorView builds in an effect).
 */
export function CodeEditor({
  docKey,
  filename,
  initialValue,
  onChange,
  onReady,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langComp = useMemo(() => new Compartment(), []);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Mount once.
  useEffect(() => {
    if (!hostRef.current) return;
    const langExt = langFor(filename).extension() ?? [];
    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        search({ top: true }),
        langComp.of(langExt),
        hermesEditorTheme,
        hermesHighlight,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    const handle: CodeEditorHandle = {
      openSearch: () => {
        openSearchPanel(view);
        view.focus();
      },
      openReplace: () => {
        openSearchPanel(view);
        requestAnimationFrame(() => {
          view.dom
            .querySelector<HTMLInputElement>('input[name="replace"]')
            ?.focus();
        });
      },
      closeSearch: () => closeSearchPanel(view),
      gotoLine: (line: number) => {
        const total = view.state.doc.lines;
        const target = Math.max(1, Math.min(total, line));
        const pos = view.state.doc.line(target).from;
        view.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: "center" }),
        });
        view.focus();
      },
      getValue: () => view.state.doc.toString(),
      getSelection: () => {
        const sel = view.state.selection.main;
        if (sel.empty) return undefined;
        return {
          from: sel.from,
          to: sel.to,
          text: view.state.sliceDoc(sel.from, sel.to),
        };
      },
      focus: () => view.focus(),
    };
    onReadyRef.current?.(handle);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount only; doc/lang updates handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload the document + language when the open file changes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const langExt = langFor(filename).extension() ?? [];
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: initialValue },
      effects: langComp.reconfigure(langExt),
      selection: { anchor: 0 },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  return <div ref={hostRef} className="h-full w-full" />;
}
