import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Braces, Check, ChevronDown, File, FolderCode, Maximize2, Minimize2, Plug } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { getLocalPluginFile, getWorkspaceConfig, listLocalPluginFiles, listWorkspaces } from '@/api/client';
import type { PluginInfo } from '@/api/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const ConfigSourceEditor = lazy(() => import('@/components/ConfigSourceEditor'));

export function WorkspacePluginsPage() {
  const { workspaceId } = useParams();
  const [pluginName, setPluginName] = useState('');
  const [filePath, setFilePath] = useState('');
  const [expanded, setExpanded] = useState(false);
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: listWorkspaces });
  const workspace = workspaces.data?.find((candidate) => candidate.id === workspaceId);
  const snapshot = useQuery({
    queryKey: ['workspace-config', workspaceId],
    queryFn: () => getWorkspaceConfig(workspaceId!),
    enabled: Boolean(workspaceId),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const plugins = useMemo(() => localPlugins(snapshot.data?.config.plugins ?? []), [snapshot.data?.config.plugins]);
  const selectedPlugin = plugins.find((plugin) => plugin.name === pluginName) ?? plugins[0];
  const selectedPluginName = selectedPlugin?.name ?? '';
  const files = useQuery({
    queryKey: ['local-plugin-files', workspaceId, selectedPluginName],
    queryFn: () => listLocalPluginFiles(workspaceId!, selectedPluginName),
    enabled: Boolean(workspaceId && selectedPlugin && snapshot.data?.connected),
    retry: false,
  });
  const selectedFilePath = files.data?.some((file) => file.path === filePath)
    ? filePath
    : preferredFile(files.data?.map((file) => file.path) ?? []);
  const source = useQuery({
    queryKey: ['local-plugin-file', workspaceId, selectedPluginName, selectedFilePath],
    queryFn: () => getLocalPluginFile(workspaceId!, selectedPluginName, selectedFilePath),
    enabled: Boolean(workspaceId && selectedPlugin && selectedFilePath && snapshot.data?.connected),
    retry: false,
  });

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    function collapse(event: KeyboardEvent) {
      if (event.key === 'Escape') setExpanded(false);
    }
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', collapse);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', collapse);
    };
  }, [expanded]);

  return <div>
    <PageHeader
      eyebrow={workspace?.name ?? 'Workspace'}
      title="Plugins"
      description="Browse the source of local plugins configured for this workspace. Editing, building, and testing will arrive in the plugin IDE."
    />
    {snapshot.isLoading ? <PageState text="Loading local plugins…" />
      : snapshot.isError ? <PageState text="Connect the workspace runner to inspect local plugins." />
      : plugins.length === 0 ? <EmptyPlugins connected={Boolean(snapshot.data?.connected)} />
      : <div className={cn('overflow-hidden rounded-md border bg-card', expanded && 'fixed inset-0 z-50 rounded-none border-0 bg-background')}>
        <div className="flex h-12 items-center justify-between gap-3 border-b px-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="h-8 min-w-44 justify-between gap-3 px-2.5 text-xs" variant="outline">
                <span className="flex min-w-0 items-center gap-2"><Plug className="size-3.5 shrink-0" /><span className="truncate">{selectedPluginName}</span></span>
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56">
              {plugins.map((plugin) => <DropdownMenuItem key={plugin.name} onSelect={() => { setPluginName(plugin.name); setFilePath(''); }}>
                <Plug />
                <span className="min-w-0 flex-1 truncate">{plugin.name}</span>
                {plugin.name === selectedPluginName && <Check className="size-3.5" />}
              </DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button aria-label={expanded ? 'Exit full screen' : 'View plugin full screen'} className="size-8" onClick={() => setExpanded((value) => !value)} title={expanded ? 'Exit full screen (Esc)' : 'View full screen'} variant="ghost">
            {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
        </div>
        <div className={cn('grid min-h-[38rem] lg:grid-cols-[17rem_minmax(0,1fr)]', expanded && 'h-[calc(100svh-3rem)] min-h-0')}>
        <aside className="min-h-48 border-b lg:border-b-0 lg:border-r" aria-label={`${selectedPluginName} files`}>
          <div className="flex h-11 items-center gap-2 border-b px-4">
            <FolderCode className="size-4 text-muted-foreground" />
            <span className="truncate text-xs font-medium">Files</span>
            {files.data && <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{files.data.length}</span>}
          </div>
          <div className={cn('max-h-72 overflow-y-auto p-2 lg:max-h-[calc(38rem-2.75rem)]', expanded && 'h-[calc(100svh-5.75rem)] max-h-none')}>
            {files.isLoading && <p className="px-2 py-4 text-xs text-muted-foreground">Loading files…</p>}
            {files.isError && <p className="px-2 py-4 text-xs leading-5 text-destructive">{errorMessage(files.error)}</p>}
            {files.data?.map((file) => <button
              className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-accent', file.path === selectedFilePath && 'bg-accent text-accent-foreground')}
              key={file.path}
              onClick={() => setFilePath(file.path)}
              title={file.path}
              type="button"
            ><File className="size-3 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{file.path}</span><span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">{formatBytes(file.size)}</span></button>)}
            {files.data?.length === 0 && <p className="px-2 py-4 text-xs text-muted-foreground">No previewable source files.</p>}
          </div>
        </aside>
        <section className="min-h-[32rem] min-w-0">
          <div className="flex h-11 items-center gap-2 border-b px-4">
            <Braces className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{selectedFilePath || 'Select a file'}</span>
            {source.data && <span className="text-[10px] tabular-nums text-muted-foreground">{formatBytes(source.data.size)}</span>}
            <span className="rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">Read only</span>
          </div>
          <div className={cn('h-[calc(100%-2.75rem)] min-h-[29rem]', expanded && 'min-h-0')}>
            {!selectedFilePath ? <EditorState text="Select a file to inspect its source." />
              : source.isLoading ? <EditorState text="Loading source…" />
              : source.isError ? <EditorState text={errorMessage(source.error)} error />
              : source.data ? <Suspense fallback={<EditorState text="Opening source…" />}><ConfigSourceEditor content={source.data.content} filename={source.data.path} /></Suspense>
              : null}
          </div>
        </section>
        </div>
      </div>}
  </div>;
}

function localPlugins(plugins: PluginInfo[]) {
  return plugins.filter((plugin) => plugin.kind === 'plugin' && plugin.version === 'local' && Boolean(plugin.path)).sort((a, b) => a.name.localeCompare(b.name));
}

function preferredFile(paths: string[]) {
  return ['README.md', 'plugin.hcl', 'main.go', 'package.json', 'pyproject.toml'].find((candidate) => paths.includes(candidate)) ?? paths[0] ?? '';
}

function EmptyPlugins({ connected }: { connected: boolean }) {
  return <div className="grid min-h-80 place-items-center rounded-md border bg-card px-6 text-center">
    <div className="max-w-md"><span className="mx-auto grid size-10 place-items-center rounded-full border bg-muted"><Plug className="size-4 text-muted-foreground" /></span><h2 className="mt-4 text-sm font-semibold">{connected ? 'No local plugins configured' : 'Runner disconnected'}</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">{connected ? 'Plugins using a local source and version = “local” will appear here.' : 'Reconnect the workspace runner to discover and browse its local plugins.'}</p></div>
  </div>;
}

function PageState({ text }: { text: string }) { return <div className="grid min-h-80 place-items-center rounded-md border bg-card px-6 text-center text-sm text-muted-foreground">{text}</div>; }
function EditorState({ text, error = false }: { text: string; error?: boolean }) { return <div className={cn('grid h-full min-h-[29rem] place-items-center px-6 text-center text-xs text-muted-foreground', error && 'text-destructive')}>{text}</div>; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Unable to load plugin source.'; }
function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`; }
