import { useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listSharedFolders, browseDirectory, getDownloadFileUrl, getDownloadDirUrl, getInstance } from '@/api/client';
import type { BrowseEntryInfo } from '@/api/types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  Folder,
  File,
  Download,
  ChevronRight,
  ArrowUpDown,
} from 'lucide-react';

type SortKey = 'name' | 'size' | 'modTime';
type SortDir = 'asc' | 'desc';

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

function SortButton({
  field,
  current,
  onToggle,
  children,
}: {
  field: SortKey;
  current: SortKey;
  onToggle: (k: SortKey) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={() => onToggle(field)}
      className="flex items-center gap-1 hover:text-foreground transition-colors font-mono text-[10px] uppercase tracking-wider"
    >
      {children}
      <ArrowUpDown className={cn('h-3 w-3', current === field ? 'opacity-100' : 'opacity-30')} />
    </button>
  );
}

export function FileBrowserPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const browserParam = searchParams.get('browser') ?? '';
  const pathParam = searchParams.get('path') ?? '';

  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const { data: instance } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
  });

  const { data: browsersData, isLoading: browsersLoading } = useQuery({
    queryKey: ['sharedFolders', id],
    queryFn: () => listSharedFolders(id!),
    enabled: !!id,
  });

  const browsers = browsersData?.folders ?? [];
  const selectedBrowser = browserParam || browsers[0]?.name || '';
  const browserInfo = browsers.find((b) => b.name === selectedBrowser);

  const { data: dirData, isLoading: dirLoading } = useQuery({
    queryKey: ['browseDirectory', id, selectedBrowser, pathParam],
    queryFn: () => browseDirectory(id!, selectedBrowser, pathParam),
    enabled: !!id && !!selectedBrowser,
  });

  if (browsers.length > 0 && !browserParam) {
    setTimeout(() => {
      setSearchParams({ browser: browsers[0].name, path: '' }, { replace: true });
    }, 0);
  }

  const handleBrowserChange = (name: string) => {
    setSearchParams({ browser: name, path: '' });
  };

  const handleNavigate = (entry: BrowseEntryInfo) => {
    const newPath = pathParam ? `${pathParam}/${entry.name}` : entry.name;
    if (entry.isDir) {
      setSearchParams({ browser: selectedBrowser, path: newPath });
    } else {
      navigate(`/instances/${id}/files/view?browser=${encodeURIComponent(selectedBrowser)}&path=${encodeURIComponent(newPath)}`);
    }
  };

  const handleBreadcrumb = (index: number) => {
    const parts = pathParam.split('/').filter(Boolean);
    const newPath = parts.slice(0, index).join('/');
    setSearchParams({ browser: selectedBrowser, path: newPath });
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedEntries = useMemo(() => {
    if (!dirData?.entries) return [];
    const entries = [...dirData.entries];
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      let cmp = 0;
      switch (sortKey) {
        case 'name':    cmp = a.name.localeCompare(b.name); break;
        case 'size':    cmp = a.size - b.size; break;
        case 'modTime': cmp = new Date(a.modTime).getTime() - new Date(b.modTime).getTime(); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return entries;
  }, [dirData?.entries, sortKey, sortDir]);

  const pathParts = pathParam.split('/').filter(Boolean);

  if (browsersLoading) {
    return <div className="px-8 py-7 text-muted-foreground">Loading...</div>;
  }

  if (browsers.length === 0) {
    return (
      <div className="px-8 py-7 text-muted-foreground">
        No folders available. Add a <code className="text-xs bg-muted px-1 py-0.5 rounded">shared_folder</code> block or a mission <code className="text-xs bg-muted px-1 py-0.5 rounded">folder</code> block to your config.
      </div>
    );
  }

  const dirCount = dirData?.entries?.filter((e) => e.isDir).length ?? 0;
  const fileCount = dirData?.entries?.filter((e) => !e.isDir).length ?? 0;

  return (
    <div className="flex flex-col h-full w-full">
      {/* Header */}
      <div className="px-8 pt-7 pb-4 shrink-0">
        <div className="flex items-end gap-4 mb-5">
          <div className="flex flex-col gap-1">
            <h1 className="text-[22px] font-semibold tracking-tight leading-none">Folders</h1>
            <span className="font-mono text-[11px] text-muted-foreground/70 tracking-[0.2px]">
              {instance?.name ?? '—'} · {browsers.length} source{browsers.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Toolbar: browser picker + breadcrumbs + stats + download */}
        <div className="flex items-center gap-4 pb-3.5 border-b border-border/60 flex-wrap">
          {/* Browser picker */}
          {browsers.length > 1 ? (
            <Select value={selectedBrowser} onValueChange={handleBrowserChange}>
              <SelectTrigger className="h-7 w-[200px] text-[12px] rounded-sm border-border/60 bg-transparent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {browsers.map((b) => (
                  <SelectItem key={b.name} value={b.name}>
                    <span className="flex items-center gap-2">
                      {b.label}
                      {b.isShared && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-sm border border-primary/40 bg-primary/10 text-primary font-medium">shared</span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : browserInfo ? (
            <span className="font-mono text-[12px] font-medium">{browserInfo.label}</span>
          ) : null}

          {browserInfo && browserInfo.missions && browserInfo.missions.length > 0 && (
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground/80">
              <span className="uppercase tracking-wider text-muted-foreground/60">missions</span>
              {browserInfo.missions.map((m) => (
                <span
                  key={m}
                  className="px-1.5 py-[1px] rounded-sm border border-border/60 bg-muted/40 text-foreground/80"
                >
                  {m}
                </span>
              ))}
            </span>
          )}

          <span className="font-mono text-[11px] text-muted-foreground/80">
            <span className="tabular-nums text-foreground font-medium">{dirCount}</span> dir{dirCount !== 1 ? 's' : ''} ·{' '}
            <span className="tabular-nums text-foreground font-medium">{fileCount}</span> file{fileCount !== 1 ? 's' : ''}
          </span>

          <span className="flex-1" />

          {pathParam && (
            <Button variant="ghost" size="sm" className="h-7 text-[12px] gap-1.5 font-mono" asChild>
              <a href={getDownloadDirUrl(id!, selectedBrowser, pathParam)} download>
                <Download className="h-3.5 w-3.5" />
                Download folder
              </a>
            </Button>
          )}
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 pt-3 font-mono text-[11.5px] text-muted-foreground/80 overflow-x-auto">
          <button
            onClick={() => handleBreadcrumb(0)}
            className={cn(
              'hover:text-foreground transition-colors',
              pathParts.length === 0 && 'text-foreground font-semibold',
            )}
          >
            {browserInfo?.label ?? selectedBrowser}
          </button>
          {pathParts.map((part, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
              <button
                onClick={() => handleBreadcrumb(i + 1)}
                className={cn(
                  'hover:text-foreground transition-colors',
                  i === pathParts.length - 1 && 'text-foreground font-semibold',
                )}
              >
                {part}
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* File listing */}
      <div className="flex-1 overflow-auto px-8 pb-8">
        <div className="rounded-sm border border-border/60 overflow-hidden bg-card">
          {dirLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/60">
                  <TableHead className="w-[55%] text-muted-foreground/80">
                    <SortButton field="name" current={sortKey} onToggle={handleSort}>Name</SortButton>
                  </TableHead>
                  <TableHead className="w-[15%] text-muted-foreground/80">
                    <SortButton field="size" current={sortKey} onToggle={handleSort}>Size</SortButton>
                  </TableHead>
                  <TableHead className="w-[20%] text-muted-foreground/80">
                    <SortButton field="modTime" current={sortKey} onToggle={handleSort}>Modified</SortButton>
                  </TableHead>
                  <TableHead className="w-[10%]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedEntries.length === 0 && (
                  <TableRow className="hover:bg-transparent border-border/40">
                    <TableCell colSpan={4} className="text-center text-muted-foreground/60 py-10 font-mono text-[12px]">
                      empty directory
                    </TableCell>
                  </TableRow>
                )}
                {sortedEntries.map((entry) => (
                  <TableRow
                    key={entry.name}
                    className="cursor-pointer border-border/40 hover:bg-accent/20"
                    onClick={() => handleNavigate(entry)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {entry.isDir ? (
                          <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                        ) : (
                          <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className={cn('truncate font-mono text-[13px]', entry.isDir && 'font-medium')}>
                          {entry.name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-[11.5px] text-muted-foreground tabular-nums">
                      {entry.isDir ? '—' : formatFileSize(entry.size)}
                    </TableCell>
                    <TableCell className="font-mono text-[11.5px] text-muted-foreground">
                      {formatRelativeTime(entry.modTime)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground/80 hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          const entryPath = pathParam ? `${pathParam}/${entry.name}` : entry.name;
                          const url = entry.isDir
                            ? getDownloadDirUrl(id!, selectedBrowser, entryPath)
                            : getDownloadFileUrl(id!, selectedBrowser, entryPath);
                          window.open(url, '_blank');
                        }}
                        title="Download"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
