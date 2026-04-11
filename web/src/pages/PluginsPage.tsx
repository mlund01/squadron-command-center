import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { ChevronRight, Info } from 'lucide-react';
import { getInstance } from '@/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { PageStats } from '@/components/page-stats';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PluginInfo, ToolInfo, ToolProperty } from '@/api/types';

type Kind = 'builtin' | 'plugin' | 'mcp';

const KIND_LABELS: Record<Kind, string> = {
  builtin: 'Built-in',
  plugin: 'Plugin',
  mcp: 'MCP',
};

const KIND_BADGE_CLASS: Record<Kind, string> = {
  builtin: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
  plugin: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  mcp: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
};

function pluginKind(p: PluginInfo): Kind {
  if (p.kind === 'mcp') return 'mcp';
  if (p.kind === 'plugin') return 'plugin';
  if (p.kind === 'builtin' || p.builtin) return 'builtin';
  return 'plugin';
}

export function PluginsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: instance, isLoading } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeTool, setActiveTool] = useState<{ tool: ToolInfo; pluginName: string } | null>(null);

  const plugins = instance?.config.plugins ?? [];
  const hasFolders = (instance?.config.sharedFolders?.length ?? 0) > 0;

  const sorted = useMemo(() => {
    const order: Record<Kind, number> = { builtin: 0, plugin: 1, mcp: 2 };
    return [...plugins].sort((a, b) => {
      const ka = pluginKind(a);
      const kb = pluginKind(b);
      if (ka !== kb) return order[ka] - order[kb];
      return a.name.localeCompare(b.name);
    });
  }, [plugins]);

  const stats = useMemo(() => {
    const counts: Record<Kind, number> = { builtin: 0, plugin: 0, mcp: 0 };
    let totalTools = 0;
    for (const p of plugins) {
      counts[pluginKind(p)]++;
      totalTools += p.tools?.length ?? 0;
    }
    return [
      { label: 'Built-ins', value: counts.builtin },
      { label: 'Plugins', value: counts.plugin },
      { label: 'MCP Servers', value: counts.mcp },
      { label: 'Total Tools', value: totalTools },
    ];
  }, [plugins]);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!instance) return <div className="p-8 text-muted-foreground">Instance not found</div>;

  function toggle(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div className="p-8 w-full max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Tools</h1>

      <PageStats stats={stats} />

      {hasFolders && (
        <Alert className="mb-4 border-blue-500/30 bg-blue-500/5 text-blue-200 [&>svg]:text-blue-400">
          <Info className="h-4 w-4" />
          <AlertDescription>
            File management tools are automatically available to commanders when shared folders are configured.
          </AlertDescription>
        </Alert>
      )}

      {sorted.length === 0 ? (
        <p className="text-muted-foreground">No tools configured.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead className="w-[200px]">Name</TableHead>
                <TableHead className="w-24">Type</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="w-24">Version</TableHead>
                <TableHead className="w-20 text-right">Tools</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((p) => {
                const kind = pluginKind(p);
                const isOpen = expanded.has(p.name);
                const toolCount = p.tools?.length ?? 0;
                return (
                  <PluginRow
                    key={p.name}
                    plugin={p}
                    kind={kind}
                    isOpen={isOpen}
                    toolCount={toolCount}
                    onToggle={() => toggle(p.name)}
                    onToolClick={(tool) => setActiveTool({ tool, pluginName: p.name })}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ToolDetailDialog
        info={activeTool}
        onClose={() => setActiveTool(null)}
      />
    </div>
  );
}

interface PluginRowProps {
  plugin: PluginInfo;
  kind: Kind;
  isOpen: boolean;
  toolCount: number;
  onToggle: () => void;
  onToolClick: (tool: ToolInfo) => void;
}

function PluginRow({ plugin, kind, isOpen, toolCount, onToggle, onToolClick }: PluginRowProps) {
  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/40"
        onClick={toolCount > 0 ? onToggle : undefined}
      >
        <TableCell>
          {toolCount > 0 && (
            <ChevronRight
              className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`}
            />
          )}
        </TableCell>
        <TableCell className="font-medium truncate">{plugin.name}</TableCell>
        <TableCell>
          <Badge variant="outline" className={`text-[10px] ${KIND_BADGE_CLASS[kind]}`}>
            {KIND_LABELS[kind]}
          </Badge>
        </TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground truncate">
          {plugin.path || '—'}
        </TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground truncate">
          {plugin.version || '—'}
        </TableCell>
        <TableCell className="text-right tabular-nums">{toolCount}</TableCell>
      </TableRow>
      {isOpen && toolCount > 0 && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={6} className="py-3 pl-12 pr-4">
            <div className="space-y-1">
              {plugin.tools!.map((t) => (
                <ToolRow key={t.name} tool={t} onClick={() => onToolClick(t)} />
              ))}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function ToolRow({ tool, onClick }: { tool: ToolInfo; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex items-baseline gap-3 w-full text-left rounded px-2 py-1 hover:bg-muted/60 transition-colors"
    >
      <code className="text-xs font-mono text-foreground shrink-0">{tool.name}</code>
      {tool.description && (
        <span className="text-xs text-muted-foreground truncate">{tool.description}</span>
      )}
    </button>
  );
}

function ToolDetailDialog({
  info,
  onClose,
}: {
  info: { tool: ToolInfo; pluginName: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={info !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        {info && (
          <>
            <DialogHeader>
              <DialogTitle className="font-mono text-base">
                {info.pluginName}.{info.tool.name}
              </DialogTitle>
              {info.tool.description && (
                <DialogDescription className="text-sm pt-2">
                  {info.tool.description}
                </DialogDescription>
              )}
            </DialogHeader>
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Parameters
              </h3>
              {info.tool.parameters && info.tool.parameters.properties && Object.keys(info.tool.parameters.properties).length > 0 ? (
                <div className="space-y-3">
                  {Object.entries(info.tool.parameters.properties).map(([name, prop]) => (
                    <ParamRow
                      key={name}
                      name={name}
                      prop={prop}
                      required={info.tool.parameters?.required?.includes(name) ?? false}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No parameters.</p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ParamRow({
  name,
  prop,
  required,
}: {
  name: string;
  prop: ToolProperty;
  required: boolean;
}) {
  return (
    <div className="border rounded-md p-3 bg-muted/20">
      <div className="flex items-center gap-2 flex-wrap">
        <code className="text-xs font-mono font-semibold">{name}</code>
        <Badge variant="outline" className="text-[10px] font-mono">
          {prop.type}
          {prop.type === 'array' && prop.items?.type ? `<${prop.items.type}>` : ''}
        </Badge>
        {required && (
          <Badge variant="outline" className="text-[10px] border-amber-500/40 bg-amber-500/10 text-amber-300">
            required
          </Badge>
        )}
      </div>
      {prop.description && (
        <p className="text-xs text-muted-foreground mt-1.5">{prop.description}</p>
      )}
      {prop.properties && Object.keys(prop.properties).length > 0 && (
        <div className="mt-2 pl-3 border-l-2 border-border space-y-2">
          {Object.entries(prop.properties).map(([childName, childProp]) => (
            <ParamRow
              key={childName}
              name={childName}
              prop={childProp}
              required={prop.required?.includes(childName) ?? false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
