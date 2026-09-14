import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useTheme } from '@/components/theme';
import { configEditorExtensions } from '@/lib/config-editor';

interface ConfigSourceEditorProps {
  content: string;
  filename: string;
  startLine?: number;
}

export default function ConfigSourceEditor({ content, filename, startLine = 1 }: ConfigSourceEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        extensions: configEditorExtensions({
          dark: theme === 'dark',
          startLine,
          label: `Read-only source in ${filename}`,
          hclSyntax: /\.hcl$/i.test(filename),
        }),
      }),
    });
    editor.current = view;
    return () => {
      editor.current = null;
      view.destroy();
    };
  }, [filename, startLine, theme]);

  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== content) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
    }
  }, [content, filename, startLine, theme]);

  return <div ref={host} className="h-full min-h-0 min-w-0 overflow-hidden" />;
}
