import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { readBrowseFile, writeBrowseFile, listSharedFolders, getDownloadFileUrl } from '@/api/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrowLeft, Download, Save, Eye, EyeOff, Code } from 'lucide-react';
import { MarkdownPreview } from '@/components/MarkdownPreview';
import { useHorizontalResize } from '@/hooks/use-horizontal-resize';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import {
  editorStructuralTheme,
  getLanguageExtension,
  getThemeExtensions,
} from '@/lib/codemirror-setup';
import { useTheme } from '@/components/ThemeProvider';

function isMarkdownFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext === 'md' || ext === 'markdown';
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function FileViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();

  const browser = searchParams.get('browser') ?? '';
  const filePath = searchParams.get('path') ?? '';
  const fileName = filePath.split('/').pop() ?? '';
  const parentPath = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';

  const [pendingContent, setPendingContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isMd = isMarkdownFile(fileName);
  const [codeOpen, setCodeOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const { width: previewWidth, handleResizeStart } = useHorizontalResize({
    initialWidth: 480,
    minWidth: 200,
    maxWidth: 800,
  });

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const { data: browsersData } = useQuery({
    queryKey: ['sharedFolders', id],
    queryFn: () => listSharedFolders(id!),
    enabled: !!id,
  });

  const browserInfo = browsersData?.folders?.find((b) => b.name === browser);
  const editable = browserInfo?.editable ?? false;

  const { data: fileData, isLoading } = useQuery({
    queryKey: ['browseFile', id, browser, filePath],
    queryFn: () => readBrowseFile(id!, browser, filePath),
    enabled: !!id && !!browser && !!filePath,
  });

  const hasChanges = pendingContent !== null;

  // Create/update editor
  useEffect(() => {
    if (!editorRef.current || !fileData || fileData.isBinary) return;

    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      bracketMatching(),
      foldGutter(),
      indentOnInput(),
      highlightSelectionMatches(),
      getLanguageExtension(fileName),
      getThemeExtensions(resolvedTheme),
      editorStructuralTheme,
      history(),
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.editable.of(editable),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newContent = update.state.doc.toString();
          if (editable) {
            if (newContent !== fileData.content) {
              setPendingContent(newContent);
            } else {
              setPendingContent(null);
            }
          }
          setPreviewContent(newContent);
        }
      }),
    ];

    const state = EditorState.create({
      doc: fileData.content,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;
    setPreviewContent(fileData.content);
    setPreviewOpen(isMd);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [fileData, fileName, editable, resolvedTheme]);

  // Reset pending content when navigating to a different file
  useEffect(() => {
    setPendingContent(null);
  }, [browser, filePath]);

  const handleSave = useCallback(async () => {
    if (!id || !browser || !filePath || pendingContent === null || saving) return;
    setSaving(true);
    try {
      const result = await writeBrowseFile(id, browser, filePath, pendingContent);
      if (!result.success) {
        toast.error('Save failed', { description: result.error });
        return;
      }
      toast.success('File saved');
      setPendingContent(null);
      queryClient.invalidateQueries({ queryKey: ['browseFile', id, browser, filePath] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast.error('Save failed', { description: msg });
    } finally {
      setSaving(false);
    }
  }, [id, browser, filePath, pendingContent, saving, queryClient]);

  const handleBack = () => {
    navigate(`/instances/${id}/files?browser=${encodeURIComponent(browser)}&path=${encodeURIComponent(parentPath)}`);
  };

  if (isLoading) {
    return <div className="p-8 text-muted-foreground">Loading...</div>;
  }

  if (!fileData) {
    return <div className="p-8 text-muted-foreground">File not found.</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={handleBack}
            title="Back to browser"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium">{fileName}</span>
          <span className="text-xs text-muted-foreground">
            {formatFileSize(fileData.size)}
          </span>
          {editable && (
            <span className="text-xs text-muted-foreground">(editable)</span>
          )}
          {hasChanges && (
            <span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
              unsaved
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {isMd && (
            <>
              <Button
                variant={codeOpen ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => { if (!codeOpen || previewOpen) setCodeOpen(!codeOpen); }}
                title={codeOpen ? 'Hide code' : 'Show code'}
              >
                <Code className="h-3.5 w-3.5" />
                Code
              </Button>
              <Button
                variant={previewOpen ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => { if (!previewOpen || codeOpen) setPreviewOpen(!previewOpen); }}
                title={previewOpen ? 'Hide preview' : 'Show preview'}
              >
                {previewOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                Preview
              </Button>
            </>
          )}
          {editable && hasChanges && (
            <Button
              variant="default"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={handleSave}
              disabled={saving}
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5"
            asChild
          >
            <a
              href={getDownloadFileUrl(id!, browser, filePath)}
              download
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {fileData.isBinary ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
            <p className="text-sm">Binary file — download to view</p>
            <Button variant="outline" size="sm" asChild>
              <a href={getDownloadFileUrl(id!, browser, filePath)} download>
                <Download className="h-4 w-4 mr-2" />
                Download {fileName}
              </a>
            </Button>
          </div>
        ) : (
          <div className="flex h-full overflow-hidden">
            <div ref={editorRef} className={cn('h-full overflow-hidden flex-1 min-w-0', !codeOpen && 'hidden')} />
            {codeOpen && previewOpen && isMd && (
              <div
                onMouseDown={handleResizeStart}
                className="w-1 shrink-0 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors"
              />
            )}
            {previewOpen && isMd && (
              <div className={cn(
                'border-l overflow-hidden flex flex-col min-w-0',
                !codeOpen && 'flex-1',
              )} style={codeOpen ? { flexBasis: previewWidth, flexShrink: 1, flexGrow: 0 } : undefined}>
                <MarkdownPreview content={previewContent} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
