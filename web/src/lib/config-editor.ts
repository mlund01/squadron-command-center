import { defaultKeymap } from '@codemirror/commands';
import { bracketMatching, foldGutter, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { drawSelection, EditorView, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { hcl } from 'codemirror-lang-hcl';
import { wrappedLineIndent } from '@/lib/wrapped-line-indent';

// Shared by the source viewer and, later, both panes of @codemirror/merge.
// Keep syntax, theme and document behavior independent of dialog/page layout.
export function configEditorExtensions({ dark, startLine, label, hclSyntax = true }: { dark: boolean; startLine: number; label: string; hclSyntax?: boolean }) {
  return [
    ...(hclSyntax ? [hcl()] : []),
    EditorView.lineWrapping,
    wrappedLineIndent,
    lineNumbers({ formatNumber: (line) => String(startLine + line - 1) }),
    foldGutter(),
    highlightSpecialChars(),
    drawSelection(),
    bracketMatching(),
    highlightSelectionMatches(),
    search({ top: true }),
    keymap.of([...defaultKeymap, ...searchKeymap]),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.contentAttributes.of({
      tabindex: '0',
      role: 'textbox',
      'aria-label': label,
      'aria-readonly': 'true',
      'aria-multiline': 'true',
    }),
    EditorView.theme({
      '&': { height: '100%', backgroundColor: 'var(--background)', color: 'var(--foreground)', fontSize: '13px' },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)', lineHeight: '1.8' },
      '.cm-content': { padding: '16px 0', minHeight: '100%' },
      '.cm-line': {
        padding: '0 16px',
        paddingLeft: 'calc(16px + var(--cm-wrap-indent, 0ch))',
        textIndent: 'calc(-1 * var(--cm-wrap-indent, 0ch))',
      },
      '.cm-gutters': { backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)', borderRight: '1px solid var(--border)' },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 16px' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--accent)' },
      '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
      '.cm-matchingBracket': { backgroundColor: 'var(--accent)', outline: '1px solid var(--border)' },
      '.cm-searchMatch': { backgroundColor: 'var(--accent)', outline: '1px solid var(--ring)' },
      '.cm-searchMatch-selected': { backgroundColor: 'var(--accent)', outline: '2px solid var(--ring)' },
      '.cm-panels': { backgroundColor: 'var(--card)', color: 'var(--foreground)' },
      '.cm-panels-top': { borderBottom: '1px solid var(--border)' },
      '.cm-textfield': { backgroundColor: 'var(--background)', color: 'var(--foreground)', border: '1px solid var(--input)', borderRadius: '4px' },
      '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: '4px' },
      '.cm-foldPlaceholder': { backgroundColor: 'var(--accent)', color: 'var(--foreground)', border: '1px solid var(--border)' },
    }, { dark }),
    syntaxHighlighting(HighlightStyle.define([
      { tag: tags.keyword, color: dark ? '#a3e635' : '#15803d', fontWeight: '600' },
      { tag: [tags.string, tags.special(tags.string)], color: dark ? '#86efac' : '#0f766e' },
      { tag: [tags.number, tags.bool, tags.null], color: dark ? '#facc15' : '#a16207' },
      { tag: [tags.propertyName, tags.definition(tags.variableName)], color: dark ? '#bbf7d0' : '#14532d' },
      { tag: [tags.variableName, tags.name], color: 'var(--foreground)' },
      { tag: [tags.punctuation, tags.operator], color: 'var(--muted-foreground)' },
      { tag: tags.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
    ])),
  ];
}
