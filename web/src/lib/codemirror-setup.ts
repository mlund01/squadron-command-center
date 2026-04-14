import { EditorView } from '@codemirror/view';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { hcl } from 'codemirror-lang-hcl';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';

// --- Editor structural theme ---

export const editorStructuralTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
  },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '8px 0',
  },
  '.cm-change-gutter': {
    width: '4px',
    minWidth: '4px',
  },
  '.cm-change-gutter .cm-gutterElement': {
    padding: '0',
    cursor: 'pointer',
  },
});

// --- Material Dark theme ---

export const materialDarkTheme = EditorView.theme({
  '&': { backgroundColor: '#2e3235', color: '#bdbdbd' },
  '.cm-content': { caretColor: '#a0a4ae' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#a0a4ae' },
  '.cm-selectionBackground': { backgroundColor: '#505d64 !important' },
  '.cm-gutters': {
    backgroundColor: '#2e3235',
    borderRight: '1px solid #4f5b66',
    color: '#606f7a',
  },
  '.cm-activeLineGutter': { backgroundColor: '#545b61', color: '#fdf6e3' },
  '.cm-activeLine': { backgroundColor: '#545b61' },
  '.cm-matchingBracket': { color: '#e0e0e0', outline: '1px solid #4ebaaa' },
  '.cm-searchMatch': { outline: '1px solid #facf4e', backgroundColor: 'transparent' },
  '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: 'none', color: '#ddd' },
}, { dark: true });

export const materialDarkHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#cf6edf' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: '#56c8d8' },
  { tag: [t.propertyName], color: '#facf4e' },
  { tag: [t.variableName], color: '#bdbdbd' },
  { tag: [t.function(t.variableName)], color: '#56c8d8' },
  { tag: [t.labelName], color: '#cf6edf' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#facf4e' },
  { tag: [t.definition(t.name), t.separator], color: '#fa5788' },
  { tag: [t.brace], color: '#cf6edf' },
  { tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: '#ffad42' },
  { tag: [t.typeName, t.className], color: '#ffad42' },
  { tag: [t.operator, t.operatorKeyword], color: '#7186f0' },
  { tag: [t.tagName], color: '#ff6e40' },
  { tag: [t.squareBracket], color: '#ff5f52' },
  { tag: [t.angleBracket], color: '#606f7a' },
  { tag: [t.attributeName], color: '#bdbdbd' },
  { tag: [t.regexp], color: '#ff5f52' },
  { tag: [t.quote], color: '#6abf69' },
  { tag: [t.string], color: '#99d066' },
  { tag: t.link, color: '#56c8d8', textDecoration: 'underline' },
  { tag: [t.url, t.escape, t.special(t.string)], color: '#facf4e' },
  { tag: [t.meta], color: '#707d8b' },
  { tag: [t.comment], color: '#707d8b', fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold', color: '#ff5f52' },
  { tag: t.emphasis, fontStyle: 'italic', color: '#99d066' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.heading, fontWeight: 'bold', color: '#facf4e' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#56c8d8' },
  { tag: [t.processingInstruction, t.inserted], color: '#ff5f52' },
  { tag: t.invalid, color: '#606f7a', borderBottom: '1px dotted #ff5f52' },
]);

// --- DEFCON 5 terminal theme ---

export const defcon5Theme = EditorView.theme({
  '&': { backgroundColor: '#0a1f0a', color: '#33ff33' },
  '.cm-content': { caretColor: '#33ff33' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#33ff33' },
  '.cm-selectionBackground': { backgroundColor: '#1a4a1a !important' },
  '.cm-gutters': {
    backgroundColor: '#081808',
    borderRight: '1px solid #1a3a1a',
    color: '#2a6a2a',
  },
  '.cm-activeLineGutter': { backgroundColor: '#1a3a1a', color: '#33ff33' },
  '.cm-activeLine': { backgroundColor: '#1a3a1a' },
  '.cm-matchingBracket': { color: '#66ff66', outline: '1px solid #33ff33' },
  '.cm-searchMatch': { outline: '1px solid #33ff33', backgroundColor: 'transparent' },
  '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: 'none', color: '#33ff33' },
}, { dark: true });

export const defcon5HighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#66ff66', fontWeight: 'bold' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: '#33cc33' },
  { tag: [t.propertyName], color: '#88ff88' },
  { tag: [t.variableName], color: '#33ff33' },
  { tag: [t.function(t.variableName)], color: '#66ffaa' },
  { tag: [t.labelName], color: '#66ff66' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#aaff44' },
  { tag: [t.definition(t.name), t.separator], color: '#ff6644' },
  { tag: [t.brace], color: '#66ff66' },
  { tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: '#ffcc33' },
  { tag: [t.typeName, t.className], color: '#ffcc33' },
  { tag: [t.operator, t.operatorKeyword], color: '#88ff88' },
  { tag: [t.tagName], color: '#ff6644' },
  { tag: [t.squareBracket], color: '#66ff66' },
  { tag: [t.angleBracket], color: '#2a6a2a' },
  { tag: [t.attributeName], color: '#33ff33' },
  { tag: [t.regexp], color: '#ff6644' },
  { tag: [t.quote], color: '#44cc44' },
  { tag: [t.string], color: '#44dd44' },
  { tag: t.link, color: '#66ffaa', textDecoration: 'underline' },
  { tag: [t.url, t.escape, t.special(t.string)], color: '#aaff44' },
  { tag: [t.meta], color: '#2a6a2a' },
  { tag: [t.comment], color: '#2a6a2a', fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold', color: '#66ff66' },
  { tag: t.emphasis, fontStyle: 'italic', color: '#44dd44' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.heading, fontWeight: 'bold', color: '#88ff88' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#66ffaa' },
  { tag: [t.processingInstruction, t.inserted], color: '#ff6644' },
  { tag: t.invalid, color: '#2a6a2a', borderBottom: '1px dotted #ff6644' },
]);

// --- Neat (light) theme ---

export const neatTheme = EditorView.theme({
  '&': { backgroundColor: '#ffffff' },
  '.cm-gutters': {
    backgroundColor: '#f5f5f5',
    borderRight: '1px solid #ddd',
    color: '#999',
  },
  '.cm-activeLineGutter': { backgroundColor: '#e8f2ff' },
  '.cm-activeLine': { backgroundColor: '#e8f2ff' },
  '.cm-selectionBackground': { backgroundColor: '#d7d4f0 !important' },
  '.cm-cursor': { borderLeftColor: '#000' },
}, { dark: false });

export const neatHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#0000ff', fontWeight: 'bold' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: '#000' },
  { tag: [t.propertyName], color: '#000' },
  { tag: [t.processingInstruction, t.string, t.inserted, t.special(t.string)], color: '#aa2222' },
  { tag: [t.function(t.variableName), t.labelName], color: '#007700' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#007700' },
  { tag: [t.definition(t.name), t.separator], color: '#000' },
  { tag: [t.className], color: '#007700' },
  { tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: '#33aa33' },
  { tag: [t.typeName], color: '#077' },
  { tag: [t.operator, t.operatorKeyword], color: '#000' },
  { tag: [t.url, t.escape, t.regexp, t.link], color: '#33aa33' },
  { tag: [t.meta, t.comment], color: '#aa8866' },
  { tag: t.tagName, color: '#077' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: '#0000ff' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#33aa33' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
]);

// --- Language detection ---

export function getLanguageExtension(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'hcl': return hcl();
    case 'json': return json();
    case 'md': case 'markdown': return markdown();
    case 'py': return python();
    case 'go': return go();
    default: return [];
  }
}

// --- Theme helpers ---

export function getThemeExtensions(resolvedTheme: string) {
  switch (resolvedTheme) {
    case 'defcon5':
      return [defcon5Theme, syntaxHighlighting(defcon5HighlightStyle)];
    case 'dark':
      return [materialDarkTheme, syntaxHighlighting(materialDarkHighlightStyle)];
    default:
      return [neatTheme, syntaxHighlighting(neatHighlightStyle)];
  }
}
