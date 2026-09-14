import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { configEditorExtensions } from '../src/lib/config-editor';
import { wrappedLineIndent } from '../src/lib/wrapped-line-indent';
import '../src/index.css';

// Run in the browser: npm run dev, then /tests/config-wrapping.html.
// Real layout is essential: state-only tests cannot catch shifted tab stops.
const description = 'A long description that wraps while preserving the exact loaded configuration. '.repeat(3);
const fixture = [
  'agent "example" {',
  `  spaces = "${description}"`,
  `    nested = "${description}"`,
  `\ttab = "${description}"`,
  ` \t  mixed = "${description}"`,
  '}',
].join('\n');
const root = document.querySelector<HTMLDivElement>('#editors')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const results = document.querySelector<HTMLPreElement>('#results')!;
const run = document.querySelector<HTMLButtonElement>('#run')!;
let views: EditorView[] = [];

async function settle() {
  // Allow CodeMirror's asynchronous measurement and resize observers to settle.
  for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
}

function rowOffsets(line: Element): number[] {
  const rows = new Map<number, number>();
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    for (let i = 0; i < (node.textContent?.length ?? 0); i++) {
      if (/\s/.test(node.textContent![i])) continue;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const box = range.getBoundingClientRect();
      const top = Math.round(box.top);
      if (box.width && box.height && !rows.has(top)) rows.set(top, box.left - line.getBoundingClientRect().left);
    }
  }
  return [...rows.values()];
}

run.addEventListener('click', async () => {
  run.disabled = true;
  status.textContent = 'Running';
  const checks: string[] = [];
  const failures: string[] = [];
  try {
    for (const tabSize of [4, 8]) {
      for (const dark of [false, true]) {
        views.forEach(view => view.destroy());
        views = [];
        root.replaceChildren();
        document.documentElement.classList.toggle('dark', dark);
        for (const baseline of [true, false]) {
          const host = document.createElement('div');
          host.style.cssText = 'width:620px;height:600px;border:1px solid var(--border);margin:16px';
          root.append(host);
          let extensions = configEditorExtensions({ dark, startLine: 1, label: baseline ? 'Unwrapped baseline' : 'Wrapped configuration' });
          if (baseline) extensions = extensions.filter(extension => extension !== wrappedLineIndent && extension !== EditorView.lineWrapping);
          extensions.push(EditorState.tabSize.of(tabSize));
          const view = new EditorView({ parent: host, state: EditorState.create({ extensions }) });
          view.dispatch({ changes: { from: 0, insert: fixture } });
          views.push(view);
        }
        await document.fonts.ready;
        for (const width of [620, 330]) {
          for (const host of root.children) (host as HTMLElement).style.width = `${width}px`;
          await settle();
          const label = `${dark ? 'dark' : 'light'}, tab size ${tabSize}, width ${width}`;
          const expected = [...views[0].contentDOM.querySelectorAll('.cm-line')].map(rowOffsets);
          const actual = [...views[1].contentDOM.querySelectorAll('.cm-line')];
          actual.forEach((line, index) => {
            rowOffsets(line).forEach((offset, row) => {
              if (Math.abs(offset - expected[index][0]) > 1) failures.push(`${label}: line ${index + 1}, row ${row + 1} has incorrect indentation`);
            });
            if (line.textContent !== views[1].state.doc.line(index + 1).text) failures.push(`${label}: displayed source changed`);
          });
          if (views[1].state.doc.toString() !== fixture) failures.push(`${label}: document changed`);
          if (!views[1].state.readOnly || views[1].contentDOM.contentEditable === 'true') failures.push(`${label}: editor is writable`);
          if (views[1].scrollDOM.scrollWidth > views[1].scrollDOM.clientWidth + 1) failures.push(`${label}: horizontal overflow`);
          checks.push(label);
        }
      }
    }
    results.textContent = JSON.stringify({ checks, failures }, null, 2);
    status.textContent = failures.length ? `FAIL: ${failures.length} failures` : `PASS: ${checks.length} layout cases`;
  } catch (error) {
    status.textContent = `FAIL: ${String(error)}`;
  } finally {
    run.disabled = false;
  }
});
