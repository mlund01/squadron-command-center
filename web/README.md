# Command Center web

This is the fresh Command Center frontend: a deliberately small React application built with Vite, Tailwind CSS, and shadcn/ui.

The active application currently contains only the first-admin setup and workspace management flows. It supports a light theme and a single dark theme based on the former DEFCON 5 palette.

The previous frontend is preserved intact in [`../archive/frontend-legacy`](../archive/frontend-legacy) for reference and comparison. Generated dependencies and build output are intentionally not archived; run `npm install` in that directory if you need to launch it independently.

## Development

```sh
npm install
npm run dev
```

The production bundle is generated with `npm run build` and embedded by the Go server.

## UI primitives

Use the checked-in shadcn components in `src/components/ui` for menus, dialogs,
and other interactive primitives. Do not implement custom popup or dropdown
behavior when a shadcn primitive exists. Native `<select>` controls are also
disallowed; use the shadcn `Select` component so triggers, menus, focus states,
and themes remain consistent. ESLint enforces this convention.

## Configuration source editor

The configuration panel has a compact **View raw** header action opening a
read-only HCL source viewer with the filename and original line numbers. The
runner captures the exact agent block during configuration loading, including
comments, expressions, relative file path and original line numbers. It does
not reconstruct HCL from evaluated values or read arbitrary client-supplied
paths. The viewer represents the loaded snapshot, not un-reloaded disk edits.

The editor uses CodeMirror 6 with `codemirror-lang-hcl`, loaded lazily when the
source panel opens. It replaces the configuration inspector alongside the chat,
with a 50/50 default split and a draggable, keyboard-accessible divider powered
by `react-resizable-panels`. Switching between details and source preserves the
chosen split. Narrow screens use a full-width configuration drawer instead.
Both editor state and DOM editing are disabled; search,
selection, copy and folding remain available. Theme and language extensions
live in `src/lib/config-editor.ts`, separate from the panel and React wrapper.

For the planned review experience, reuse those extensions with
[`@codemirror/merge`](https://github.com/codemirror/merge) for split or unified
diffs. No diff controls or write actions are implemented here. The source
response includes `fileRevision`, a SHA-256 fingerprint of the full loaded
file, so a future apply endpoint can verify its base before writing. That
fingerprint is not a Git commit; branch creation, authorization and conflict
handling still belong in the eventual server-side review workflow.

### Wrapped indentation

The source editor keeps a small local CodeMirror decoration extension for
indent-preserving wrapping. We evaluated `codemirror-wrapped-line-indent@1.0.9`
against the same fixtures on 2026-08-31. In our empty-editor → loaded-snapshot
lifecycle its indentation appeared only after a subsequent resize, and its
fixed extra indentation level differs from preserving the original indent.
It is not installed. Reevaluate a newer release if those behaviors change.

The comparison also exposed a mixed-tabs/spaces rendering bug in our own
negative-text-indent approach. Leading tab whitespace now has a fixed-width
display span; the underlying HCL and copied whitespace remain intact.

Run the state tests with `node --experimental-strip-types --test tests/config-wrapping.test.ts`.
For actual browser-layout regression checks, start `npm run dev` and open
`/tests/config-wrapping.html`. This compares first and wrapped line positions
against an unwrapped baseline at two panel widths and tab sizes in both themes.
