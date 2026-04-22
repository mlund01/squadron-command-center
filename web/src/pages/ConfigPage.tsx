import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { listConfigFiles, getConfigFile, writeConfigFile, reloadConfig, validateConfig, getInstance } from '@/api/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { buildNewFilePath, validateNewFileName } from '@/lib/config-files';
import { FileCode, FilePlus, Save, RefreshCw, Undo2, CheckCircle, X, ChevronRight, ChevronDown, Eye, EyeOff, Code } from 'lucide-react';
import { MarkdownPreview } from '@/components/MarkdownPreview';
import { useHorizontalResize } from '@/hooks/use-horizontal-resize';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, gutter, GutterMarker } from '@codemirror/view';
import { EditorState, RangeSet, StateField, StateEffect } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import {
  editorStructuralTheme,
  getLanguageExtension,
  getThemeExtensions,
} from '@/lib/codemirror-setup';
import { useTheme } from '@/components/ThemeProvider';

// --- Diff computation (Myers-like LCS diff) ---

type DiffLineType = 'same' | 'added' | 'removed';
interface DiffLine {
  type: DiffLineType;
  oldLine?: number;
  newLine?: number;
  content: string;
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = m, j = n;
  const stack: DiffLine[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: 'same', oldLine: i, newLine: j, content: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'added', newLine: j, content: newLines[j - 1] });
      j--;
    } else {
      stack.push({ type: 'removed', oldLine: i, content: oldLines[i - 1] });
      i--;
    }
  }
  for (let k = stack.length - 1; k >= 0; k--) {
    result.push(stack[k]);
  }
  return result;
}

/** For a given new text vs original, return a map of newLineNumber → 'added' | 'modified' */
function computeLineChanges(original: string, current: string): Map<number, 'added' | 'modified'> {
  const changes = new Map<number, 'added' | 'modified'>();
  if (original === current) return changes;

  const diff = computeDiff(original, current);

  // Walk the diff and classify new lines
  let lastRemovedBeforeAdd = false;
  for (let idx = 0; idx < diff.length; idx++) {
    const d = diff[idx];
    if (d.type === 'removed') {
      lastRemovedBeforeAdd = true;
    } else if (d.type === 'added') {
      // If there was a removed line right before, it's a modification
      changes.set(d.newLine!, lastRemovedBeforeAdd ? 'modified' : 'added');
      lastRemovedBeforeAdd = false;
    } else {
      lastRemovedBeforeAdd = false;
    }
  }

  return changes;
}

// --- CodeMirror gutter extension for change markers ---

const setChangeMarkers = StateEffect.define<Map<number, 'added' | 'modified'>>();

class ChangeGutterMarker extends GutterMarker {
  changeType: 'added' | 'modified';
  constructor(changeType: 'added' | 'modified') { super(); this.changeType = changeType; }
  toDOM() {
    const el = document.createElement('div');
    el.style.width = '3px';
    el.style.height = '100%';
    el.style.backgroundColor = this.changeType === 'added' ? '#22c55e' : '#3b82f6';
    el.style.borderRadius = '1px';
    el.style.cursor = 'pointer';
    return el;
  }
}

const addedMarker = new ChangeGutterMarker('added');
const modifiedMarker = new ChangeGutterMarker('modified');

const changeMarkersField = StateField.define<Map<number, 'added' | 'modified'>>({
  create() { return new Map(); },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setChangeMarkers)) return e.value;
    }
    return value;
  },
});

function createChangeGutter(onGutterClick: () => void) {
  return gutter({
    class: 'cm-change-gutter',
    markers(view) {
      const changes = view.state.field(changeMarkersField);
      const builder: { from: number; to: number; value: GutterMarker }[] = [];
      const doc = view.state.doc;
      for (const [lineNum, type] of changes) {
        if (lineNum >= 1 && lineNum <= doc.lines) {
          const line = doc.line(lineNum);
          builder.push({ from: line.from, to: line.from, value: type === 'added' ? addedMarker : modifiedMarker });
        }
      }
      builder.sort((a, b) => a.from - b.from);
      return RangeSet.of(builder.map(b => b.value.range(b.from)));
    },
    domEventHandlers: {
      click(view, line, _event) {
        const changes = view.state.field(changeMarkersField);
        const lineInfo = view.state.doc.lineAt(line.from);
        if (changes.has(lineInfo.number)) {
          onGutterClick();
          return true;
        }
        return false;
      },
    },
  });
}

// Theme and language definitions imported from @/lib/codemirror-setup

// --- Inline Diff Viewer ---

function DiffViewer({ original, modified, onClose }: { original: string; modified: string; onClose: () => void }) {
  const diff = useMemo(() => computeDiff(original, modified), [original, modified]);

  return (
    <div className="absolute inset-0 z-10 bg-background flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30">
        <span className="text-xs font-medium">Diff View</span>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto font-mono text-xs leading-5">
        {diff.map((line, idx) => (
          <div
            key={idx}
            className={cn(
              'px-3 whitespace-pre',
              line.type === 'added' && 'bg-green-500/15 text-green-700 dark:text-green-400',
              line.type === 'removed' && 'bg-red-500/15 text-red-700 dark:text-red-400',
            )}
          >
            <span className="inline-block w-5 text-right mr-3 text-muted-foreground select-none">
              {line.type === 'removed' ? line.oldLine : ''}
            </span>
            <span className="inline-block w-5 text-right mr-3 text-muted-foreground select-none">
              {line.type === 'added' || line.type === 'same' ? line.newLine : ''}
            </span>
            <span className="inline-block w-4 text-center select-none">
              {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
            </span>
            {line.content}
          </div>
        ))}
      </div>
    </div>
  );
}

function isMarkdownFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext === 'md' || ext === 'markdown';
}

// --- Main ConfigPage ---

export function ConfigPage() {
  const { id } = useParams<{ id: string }>();
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
  const [fileTreeWidth, setFileTreeWidth] = useState(192);
  const resizing = useRef(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [addingFile, setAddingFile] = useState<{ dir: string } | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [creatingFile, setCreatingFile] = useState(false);
  const [contextMenu, setContextMenu] = useState<
    | { x: number; y: number; type: 'root' }
    | { x: number; y: number; type: 'folder'; dir: string }
    | null
  >(null);
  const [codeOpen, setCodeOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const { width: previewWidth, handleResizeStart: handlePreviewResizeStart } = useHorizontalResize({
    initialWidth: 480,
    minWidth: 200,
    maxWidth: 800,
  });

  // Browser-only pending changes: filename → modified content
  const [pendingChanges, setPendingChanges] = useState<Map<string, string>>(new Map());

  // Original (server) content cache: filename → content
  const [originalContents, setOriginalContents] = useState<Map<string, string>>(new Map());

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const { data: instance } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
  });

  const { data: fileList, isLoading: filesLoading } = useQuery({
    queryKey: ['configFiles', id],
    queryFn: () => listConfigFiles(id!),
    enabled: !!id,
  });

  const { data: fileContent, isLoading: contentLoading } = useQuery({
    queryKey: ['configFile', id, selectedFile],
    queryFn: () => getConfigFile(id!, selectedFile!),
    enabled: !!id && !!selectedFile,
  });

  // Auto-select first file
  useEffect(() => {
    if (!selectedFile && fileList?.files?.length) {
      setSelectedFile(fileList.files[0].name);
    }
  }, [fileList, selectedFile]);

  // Auto-toggle preview when switching files
  useEffect(() => {
    if (selectedFile) {
      const md = isMarkdownFile(selectedFile);
      setPreviewOpen(md);
      setCodeOpen(true);
    }
  }, [selectedFile]);

  const allowEdit = fileList?.allowConfigEdit ?? false;

  // Cache original content when fetched
  useEffect(() => {
    if (fileContent?.name && fileContent?.content != null) {
      setOriginalContents(prev => {
        const next = new Map(prev);
        next.set(fileContent.name, fileContent.content);
        return next;
      });
    }
  }, [fileContent?.name, fileContent?.content]);

  const hasAnyChanges = pendingChanges.size > 0;
  const currentFileOriginal = selectedFile ? originalContents.get(selectedFile) ?? '' : '';
  const currentFilePending = selectedFile ? pendingChanges.get(selectedFile) : undefined;
  // Update change markers in editor when content or pending changes change
  const updateGutterMarkers = useCallback((view: EditorView, original: string) => {
    const current = view.state.doc.toString();
    const changes = computeLineChanges(original, current);
    view.dispatch({ effects: setChangeMarkers.of(changes) });
  }, []);

  // Create/update editor
  useEffect(() => {
    if (!editorRef.current || !selectedFile) return;
    if (fileContent?.content == null) return;

    const original = originalContents.get(selectedFile) ?? fileContent.content;
    const docContent = pendingChanges.get(selectedFile) ?? fileContent.content;

    // Destroy old editor
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const extensions = [
      changeMarkersField,
      createChangeGutter(() => setShowDiff(true)),
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      bracketMatching(),
      foldGutter(),
      indentOnInput(),
      highlightSelectionMatches(),
      getLanguageExtension(selectedFile),
      getThemeExtensions(resolvedTheme),
      editorStructuralTheme,
      history(),
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.editable.of(allowEdit),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newContent = update.state.doc.toString();
          // Update pending changes
          if (newContent !== original) {
            setPendingChanges(prev => {
              const next = new Map(prev);
              next.set(selectedFile, newContent);
              return next;
            });
          } else {
            // Content matches original — remove from pending
            setPendingChanges(prev => {
              const next = new Map(prev);
              next.delete(selectedFile);
              return next;
            });
          }
          // Update gutter markers
          updateGutterMarkers(update.view, original);
          // Update preview content
          setPreviewContent(newContent);
        }
      }),
    ];

    const state = EditorState.create({
      doc: docContent,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    // Set initial gutter markers
    const initialChanges = computeLineChanges(original, docContent);
    view.dispatch({ effects: setChangeMarkers.of(initialChanges) });

    // Set initial preview content
    setPreviewContent(docContent);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [fileContent?.content, fileContent?.name, selectedFile, allowEdit, originalContents, resolvedTheme]);

  const handleValidate = useCallback(async () => {
    if (!id || validating) return;
    setValidating(true);
    try {
      // Build the files map: start with originals, overlay pending changes
      const files: Record<string, string> = {};
      for (const [name, content] of pendingChanges) {
        files[name] = content;
      }
      const result = await validateConfig(id, files);
      if (result.valid) {
        toast.success('Validation passed');
      } else {
        toast.error('Validation failed', {
          description: result.errors?.join('\n') ?? 'Unknown error',
        });
      }
      return result.valid;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Validation failed';
      toast.error('Validation failed', { description: msg });
      return false;
    } finally {
      setValidating(false);
    }
  }, [id, validating, pendingChanges]);

  const handleSave = useCallback(async () => {
    if (!id || saving || !hasAnyChanges) return;

    // Validate first
    setSaving(true);
    try {
      const files: Record<string, string> = {};
      for (const [name, content] of pendingChanges) {
        files[name] = content;
      }
      const validation = await validateConfig(id, files);
      if (!validation.valid) {
        toast.error('Save aborted: validation failed', {
          description: validation.errors?.join('\n') ?? 'Unknown error',
        });
        return;
      }

      // Save all modified files
      for (const [name, content] of pendingChanges) {
        await writeConfigFile(id, name, content);
      }

      // Reload config after saving
      await reloadConfig(id);

      toast.success(`Saved ${pendingChanges.size} file${pendingChanges.size > 1 ? 's' : ''}`);

      // Clear pending changes and refresh
      setPendingChanges(new Map());
      queryClient.invalidateQueries({ queryKey: ['configFiles', id] });
      queryClient.invalidateQueries({ queryKey: ['instance', id] });
      queryClient.invalidateQueries({ queryKey: ['instances'] });
      for (const name of pendingChanges.keys()) {
        queryClient.invalidateQueries({ queryKey: ['configFile', id, name] });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast.error('Save failed', { description: msg });
    } finally {
      setSaving(false);
    }
  }, [id, saving, hasAnyChanges, pendingChanges, queryClient]);

  const handleUndoAll = useCallback(() => {
    setPendingChanges(new Map());
    // Force editor to reload original content
    if (selectedFile) {
      queryClient.invalidateQueries({ queryKey: ['configFile', id, selectedFile] });
    }
  }, [selectedFile, id, queryClient]);

  const handleReload = useCallback(async () => {
    if (!id || reloading) return;
    setReloading(true);
    try {
      await reloadConfig(id);
      toast.success('Config reloaded');
      setPendingChanges(new Map());
      queryClient.invalidateQueries({ queryKey: ['instance', id] });
      queryClient.invalidateQueries({ queryKey: ['instances'] });
      queryClient.invalidateQueries({ queryKey: ['configFiles', id] });
      if (selectedFile) {
        queryClient.invalidateQueries({ queryKey: ['configFile', id, selectedFile] });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Reload failed';
      toast.error('Reload failed', { description: msg });
    } finally {
      setReloading(false);
    }
  }, [id, reloading, selectedFile, queryClient]);

  const existingNames = useMemo(
    () => new Set((fileList?.files ?? []).map(f => f.name)),
    [fileList],
  );

  const trimmedNewName = newFileName.trim();
  const newFileFullPath = addingFile ? buildNewFilePath(addingFile.dir, newFileName) : '';
  const newFileErrorCode = addingFile
    ? validateNewFileName(addingFile.dir, newFileName, existingNames)
    : null;
  const newFileError =
    newFileErrorCode === 'invalid-path'
      ? 'Invalid path'
      : newFileErrorCode === 'already-exists'
        ? 'File already exists'
        : null;

  // Close context menu on any outside interaction
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [contextMenu]);

  const startAddingFile = useCallback((dir: string) => {
    setNewFileName('');
    setAddingFile({ dir });
    if (dir) {
      setOpenDirs(prev => {
        if (prev.has(dir)) return prev;
        const next = new Set(prev);
        next.add(dir);
        return next;
      });
    }
  }, []);

  const cancelAddingFile = useCallback(() => {
    setAddingFile(null);
    setNewFileName('');
  }, []);

  const handleCreateFile = useCallback(async () => {
    if (!id || creatingFile || !addingFile) return;
    if (!trimmedNewName || newFileError) return;
    const name = newFileFullPath;
    setCreatingFile(true);
    try {
      await writeConfigFile(id, name, '');
      toast.success(`Created ${name}`);
      setAddingFile(null);
      setNewFileName('');
      await queryClient.invalidateQueries({ queryKey: ['configFiles', id] });
      setSelectedFile(name);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create file';
      toast.error('Create failed', { description: msg });
    } finally {
      setCreatingFile(false);
    }
  }, [id, creatingFile, addingFile, newFileFullPath, trimmedNewName, newFileError, queryClient]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startWidth = fileTreeWidth;
    const onMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const newWidth = Math.max(120, Math.min(400, startWidth + e.clientX - startX));
      setFileTreeWidth(newWidth);
    };
    const onMouseUp = () => {
      resizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [fileTreeWidth]);

  if (filesLoading) return <div className="px-8 py-7 text-muted-foreground">Loading...</div>;
  if (!fileList) return <div className="px-8 py-7 text-muted-foreground">No config files found.</div>;

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Header — fixed above the file tree + editor */}
      <div className="px-8 pt-7 pb-3.5 shrink-0 border-b border-border/60 bg-background">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex flex-col gap-1 min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight leading-none">Config</h1>
            <span className="font-mono text-[11px] text-muted-foreground/70 tracking-[0.2px] truncate">
              {instance?.name ?? '—'} · <span className="text-muted-foreground/90">{fileList.path}</span>
            </span>
          </div>

          <span className="flex-1" />

          {hasAnyChanges && (
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-amber-400 px-2 py-[3px] rounded-sm border border-amber-500/40 bg-amber-500/10">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              {pendingChanges.size} unsaved
            </span>
          )}

          {hasAnyChanges && (
            <>
              <Button variant="ghost" size="sm" className="h-7 text-[12px] gap-1.5 font-mono" onClick={handleUndoAll}>
                <Undo2 className="h-3.5 w-3.5" />
                Undo all
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[12px] gap-1.5 font-mono border-border/60 rounded-sm"
                onClick={handleValidate}
                disabled={validating}
              >
                <CheckCircle className="h-3.5 w-3.5" />
                {validating ? 'Validating…' : 'Validate'}
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-7 text-[12px] gap-1.5 font-mono rounded-sm"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </>
          )}
          {selectedFile && isMarkdownFile(selectedFile) && (
            <div className="flex items-center gap-1 ml-1">
              <Button
                variant={codeOpen ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-[12px] gap-1.5 font-mono rounded-sm"
                onClick={() => { if (!codeOpen || previewOpen) setCodeOpen(!codeOpen); }}
                title={codeOpen ? 'Hide code' : 'Show code'}
              >
                <Code className="h-3.5 w-3.5" />
                Code
              </Button>
              <Button
                variant={previewOpen ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-[12px] gap-1.5 font-mono rounded-sm"
                onClick={() => { if (!previewOpen || codeOpen) setPreviewOpen(!previewOpen); }}
                title={previewOpen ? 'Hide preview' : 'Show preview'}
              >
                {previewOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                Preview
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[12px] gap-1.5 font-mono"
            onClick={handleReload}
            disabled={reloading}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', reloading && 'animate-spin')} />
            Reload
          </Button>
        </div>
      </div>


      {contextMenu && (
        <div
          className="fixed z-50 min-w-[180px] rounded-md border bg-popover text-popover-foreground shadow-md py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}
        >
          {contextMenu.type === 'root' && (
            <button
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
              onClick={() => { setContextMenu(null); startAddingFile(''); }}
            >
              <FilePlus className="h-3.5 w-3.5" />
              Add file
            </button>
          )}
          {contextMenu.type === 'folder' && (
            <>
              <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground font-mono truncate">
                {contextMenu.dir}
              </div>
              <button
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                onClick={() => { const d = contextMenu.dir; setContextMenu(null); startAddingFile(d); }}
              >
                <FilePlus className="h-3.5 w-3.5" />
                Add file to folder
              </button>
            </>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex flex-1 min-h-0">
        {/* File tree */}
        <div
          className="shrink-0 border-r border-border/60 overflow-y-auto bg-background"
          style={{ width: fileTreeWidth }}
          onContextMenu={e => {
            if (!allowEdit) return;
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, type: 'root' });
          }}
        >
          <div className="px-1.5 py-1.5 min-h-full">
            {(() => {
              // Sort files: root files first, then grouped by directory
              const sorted = [...fileList.files].sort((a, b) => {
                const aDir = a.name.includes('/') ? a.name.substring(0, a.name.lastIndexOf('/')) : '';
                const bDir = b.name.includes('/') ? b.name.substring(0, b.name.lastIndexOf('/')) : '';
                if (aDir === bDir) return a.name.localeCompare(b.name);
                if (aDir === '') return -1;
                if (bDir === '') return 1;
                return aDir.localeCompare(bDir);
              });

              // Group files by directory
              const rootFiles: typeof sorted = [];
              const dirGroups = new Map<string, typeof sorted>();
              for (const file of sorted) {
                const dir = file.name.includes('/') ? file.name.substring(0, file.name.lastIndexOf('/')) : '';
                if (!dir) {
                  rootFiles.push(file);
                } else {
                  if (!dirGroups.has(dir)) dirGroups.set(dir, []);
                  dirGroups.get(dir)!.push(file);
                }
              }

              const toggleDir = (dir: string) => {
                setOpenDirs(prev => {
                  const next = new Set(prev);
                  if (next.has(dir)) next.delete(dir);
                  else next.add(dir);
                  return next;
                });
              };

              const renderFile = (file: typeof sorted[0], _indented?: boolean) => {
                const isModified = pendingChanges.has(file.name);
                const basename = file.name.includes('/') ? file.name.substring(file.name.lastIndexOf('/') + 1) : file.name;
                return (
                  <button
                    key={file.name}
                    onClick={() => { setSelectedFile(file.name); setShowDiff(false); }}
                    onContextMenu={e => {
                      // No file-level actions available yet; suppress root menu but don't open anything.
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu(null);
                    }}
                    className={cn(
                      'flex items-center gap-1.5 w-full px-2 py-[3px] rounded-sm font-mono text-[12px] leading-tight text-left transition-colors',
                      selectedFile === file.name
                        ? 'bg-accent text-foreground font-semibold ring-1 ring-border'
                        : 'hover:bg-accent/25 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <FileCode className={cn('h-3 w-3 shrink-0', isModified ? 'text-amber-400' : selectedFile === file.name ? 'text-primary' : 'opacity-70')} />
                    <span className={cn('truncate', isModified && 'text-amber-400 font-semibold')}>
                      {basename}
                    </span>
                    {isModified && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400" />}
                  </button>
                );
              };

              const renderInlineInput = () => (
                <div className="flex items-center gap-2 px-2 py-1">
                  <FileCode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <input
                    autoFocus
                    type="text"
                    value={newFileName}
                    disabled={creatingFile}
                    placeholder="filename.md"
                    onChange={e => setNewFileName(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onContextMenu={e => e.stopPropagation()}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (trimmedNewName && !newFileError && !creatingFile) handleCreateFile();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelAddingFile();
                      }
                    }}
                    onBlur={() => {
                      // Small delay so click on the input doesn't insta-cancel
                      setTimeout(() => {
                        if (!creatingFile) cancelAddingFile();
                      }, 100);
                    }}
                    className={cn(
                      'flex-1 min-w-0 bg-background border rounded px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring',
                      newFileError && 'border-destructive focus:ring-destructive',
                    )}
                  />
                </div>
              );

              return (
                <>
                  {rootFiles.map(f => renderFile(f))}
                  {addingFile && addingFile.dir === '' && renderInlineInput()}
                  {[...dirGroups.entries()].map(([dir, files]) => {
                    const isOpen = openDirs.has(dir);
                    const isAddingHere = addingFile?.dir === dir;
                    return (
                      <div key={dir}>
                        <button
                          onClick={() => toggleDir(dir)}
                          onContextMenu={e => {
                            if (!allowEdit) return;
                            e.preventDefault();
                            e.stopPropagation();
                            setContextMenu({ x: e.clientX, y: e.clientY, type: 'folder', dir });
                          }}
                          className="flex items-center gap-1 w-full px-2 py-[3px] mt-1 first:mt-0 rounded-sm font-mono text-[10px] uppercase tracking-[0.1em] leading-tight text-left hover:bg-accent/25 text-muted-foreground/70 hover:text-foreground transition-colors"
                        >
                          {isOpen
                            ? <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-70" />
                            : <ChevronRight className="h-2.5 w-2.5 shrink-0 opacity-70" />
                          }
                          <span className="truncate">{dir}</span>
                        </button>
                        {(isOpen || isAddingHere) && (
                          <div className="ml-[13px] pl-px border-l border-border/60">
                            {files.map(f => renderFile(f, true))}
                            {isAddingHere && renderInlineInput()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={handleResizeStart}
          className="w-1 shrink-0 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors"
        />

        {/* Editor + Preview */}
        <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
          <div className={cn('flex-1 min-h-0 min-w-0 relative', !codeOpen && 'hidden')}>
            {contentLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading...</div>
            ) : !selectedFile ? (
              <div className="p-4 text-sm text-muted-foreground">Select a file to view.</div>
            ) : showDiff ? (
              <DiffViewer
                original={currentFileOriginal}
                modified={currentFilePending ?? currentFileOriginal}
                onClose={() => setShowDiff(false)}
              />
            ) : (
              <div ref={editorRef} className="absolute inset-0 overflow-hidden" />
            )}
          </div>

          {codeOpen && previewOpen && selectedFile && isMarkdownFile(selectedFile) && !showDiff && (
            <div
              onMouseDown={handlePreviewResizeStart}
              className="w-1 shrink-0 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors"
            />
          )}

          {previewOpen && selectedFile && isMarkdownFile(selectedFile) && !showDiff && (
            <div className={cn(
              'border-l overflow-hidden flex flex-col min-w-0',
              !codeOpen && 'flex-1',
            )} style={codeOpen ? { flexBasis: previewWidth, flexShrink: 1, flexGrow: 0 } : undefined}>
              <MarkdownPreview content={previewContent} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
