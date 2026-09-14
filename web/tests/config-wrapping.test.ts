import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Compartment, EditorState } from '@codemirror/state';
import { wrappedLineIndent } from '../src/lib/wrapped-line-indent.ts';

function indents(state: EditorState) {
  const result: Array<{ line: number; style: string }> = [];
  const cursor = state.field(wrappedLineIndent).iter();
  while (cursor.value) {
    if (cursor.from === cursor.to) {
      result.push({ line: state.doc.lineAt(cursor.from).number, style: cursor.value.spec.attributes.style });
    }
    cursor.next();
  }
  return result;
}

test('continuations use each line’s indentation without changing config bytes', () => {
  const doc = 'agent "example" {\n  role = "Long role"\n    nested = "Long value"\n\n  \n}\n';
  const state = EditorState.create({ doc, extensions: [wrappedLineIndent] });
  assert.deepEqual(indents(state), [
    { line: 2, style: '--cm-wrap-indent: 2ch' },
    { line: 3, style: '--cm-wrap-indent: 4ch' },
  ]);
  assert.equal(state.doc.toString(), doc);
});

test('mixed tabs and spaces follow the editor’s tab stops', () => {
  const tabSize = new Compartment();
  let state = EditorState.create({ doc: ' \t  role = "value"', extensions: [wrappedLineIndent, tabSize.of(EditorState.tabSize.of(4))] });
  assert.deepEqual(indents(state), [{ line: 1, style: '--cm-wrap-indent: 6ch' }]);
  state = state.update({ effects: tabSize.reconfigure(EditorState.tabSize.of(8)) }).state;
  assert.deepEqual(indents(state), [{ line: 1, style: '--cm-wrap-indent: 10ch' }]);
});

test('tab indentation gets a fixed-width display span without replacing its text', () => {
  const doc = ' \t  role = "value"';
  const state = EditorState.create({ doc, extensions: [wrappedLineIndent, EditorState.tabSize.of(4)] });
  const cursor = state.field(wrappedLineIndent).iter();
  cursor.next();
  assert.equal(cursor.from, 0);
  assert.equal(cursor.to, 4);
  assert.match(cursor.value!.spec.attributes.style, /width: 6ch/);
  assert.match(cursor.value!.spec.attributes.style, /text-indent: 0/);
  assert.equal(state.sliceDoc(cursor.from, cursor.to), ' \t  ');
  assert.equal(state.doc.toString(), doc);
});

test('a new loaded snapshot replaces old indentation decorations', () => {
  let state = EditorState.create({ doc: '  role = "old"', extensions: [wrappedLineIndent] });
  state = state.update({ changes: { from: 0, to: state.doc.length, insert: 'role = "new"\n    tools = []' } }).state;
  assert.deepEqual(indents(state), [{ line: 2, style: '--cm-wrap-indent: 4ch' }]);
  const decorations = state.field(wrappedLineIndent);
  state = state.update({ selection: { anchor: 1 } }).state;
  assert.equal(state.field(wrappedLineIndent), decorations);
});
