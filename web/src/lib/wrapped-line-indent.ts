import { countColumn, EditorState, RangeSetBuilder, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';

function lineIndents(state: EditorState): DecorationSet {
  const decorations = new RangeSetBuilder<Decoration>();
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    const whitespace = /^[\t ]*/.exec(line.text)![0];
    if (!whitespace.length || whitespace.length === line.length) continue;

    const columns = countColumn(whitespace, state.tabSize);
    decorations.add(line.from, line.from, Decoration.line({
      attributes: { style: `--cm-wrap-indent: ${columns}ch` },
    }));
    if (whitespace.includes('\t')) {
      // Negative text-indent shifts browser tab stops. Give leading whitespace
      // its own measured box so mixed tabs/spaces keep their original width.
      decorations.add(line.from, line.from + whitespace.length, Decoration.mark({
        attributes: { style: `display: inline-block; width: ${columns}ch; text-indent: 0; white-space: pre` },
      }));
    }
  }
  return decorations.finish();
}

// Offset continuation lines visually; leave document bytes and copying intact.
// State decorations are available before CodeMirror measures wrapped heights.
export const wrappedLineIndent = StateField.define<DecorationSet>({
  create: lineIndents,
  update(decorations, transaction) {
    return transaction.docChanged || transaction.startState.tabSize !== transaction.state.tabSize
      ? lineIndents(transaction.state)
      : decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});
