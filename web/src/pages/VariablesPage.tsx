import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { getInstance, getVariables, setVariable, deleteVariable } from '@/api/client';
import type { VariableDetail } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Lock, Pencil, Trash2, Check, X, Search } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type FilterKey = 'all' | 'override' | 'default' | 'unset' | 'secrets';

export function VariablesPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [editingVar, setEditingVar] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');

  const { data: instance } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['variables', id],
    queryFn: () => getVariables(id!),
    enabled: !!id,
    refetchInterval: 10000,
  });

  const setMutation = useMutation({
    mutationFn: ({ name, value }: { name: string; value: string }) => setVariable(id!, name, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variables', id] });
      setEditingVar(null);
      toast.success('Variable updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => deleteVariable(id!, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variables', id] });
      toast.success('Override removed');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const startEdit = (v: VariableDetail) => {
    setEditingVar(v.name);
    setEditValue(v.secret ? '' : v.source === 'override' ? v.value : '');
  };

  const cancelEdit = () => {
    setEditingVar(null);
    setEditValue('');
  };

  const saveEdit = (name: string) => {
    if (!editValue.trim()) return;
    setMutation.mutate({ name, value: editValue });
  };

  const handleKeyDown = (e: React.KeyboardEvent, name: string) => {
    if (e.key === 'Enter') saveEdit(name);
    if (e.key === 'Escape') cancelEdit();
  };

  const variables = useMemo(() => data?.variables ?? [], [data]);
  const total = variables.length;
  const overrides = variables.filter((v) => v.source === 'override').length;
  const unset = variables.filter((v) => v.source === 'unset').length;
  const secrets = variables.filter((v) => v.secret).length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return variables.filter((v) => {
      if (q && !v.name.toLowerCase().includes(q) && !v.value.toLowerCase().includes(q)) return false;
      switch (filter) {
        case 'override': return v.source === 'override';
        case 'default':  return v.source === 'default';
        case 'unset':    return v.source === 'unset';
        case 'secrets':  return v.secret;
        case 'all':      return true;
      }
    });
  }, [variables, filter, search]);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;

  return (
    <div className="px-8 py-7 w-full">
      <div className="flex items-end gap-4 mb-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight leading-none">Variables</h1>
          <span className="font-mono text-[11px] text-muted-foreground/70 tracking-[0.2px]">
            {instance?.name ?? '—'} · {total} defined
          </span>
        </div>
      </div>

      {total === 0 ? (
        <p className="text-muted-foreground">No variables defined in config.</p>
      ) : (
        <>
          <div className="flex items-center gap-6 pb-3.5 mb-4 border-b border-border/60 font-mono text-[11px] text-muted-foreground/80 flex-wrap">
            <Stat k="vars" v={total} />
            <Stat k="overridden" v={overrides} tone={overrides > 0 ? 'primary' : undefined} />
            <Stat k="secrets" v={secrets} />
            <Stat k="unset" v={unset} tone={unset > 0 ? 'warn' : undefined} />

            <span className="flex-1" />

            <div className="flex items-center gap-1">
              <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterChip>
              <FilterChip active={filter === 'override'} onClick={() => setFilter('override')}>Overridden</FilterChip>
              <FilterChip active={filter === 'default'} onClick={() => setFilter('default')}>Default</FilterChip>
              <FilterChip active={filter === 'unset'} onClick={() => setFilter('unset')}>Unset</FilterChip>
              <FilterChip active={filter === 'secrets'} onClick={() => setFilter('secrets')}>Secrets</FilterChip>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 border border-border/60 rounded-sm w-[200px] text-foreground/90">
              <Search className="h-3 w-3 text-muted-foreground/70" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search variables"
                className="flex-1 bg-transparent outline-none text-[11.5px] placeholder:text-muted-foreground/60 font-sans"
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="text-muted-foreground text-sm mt-10 text-center">No variables match.</p>
          ) : (
            <div className="rounded-sm border border-border/60 overflow-hidden bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border/60">
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">Name</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">Value</TableHead>
                    <TableHead className="w-28 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">Source</TableHead>
                    <TableHead className="w-[110px] font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((v) => (
                    <TableRow key={v.name} className="border-border/40 hover:bg-accent/20">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {v.secret && <Lock className="h-3 w-3 text-amber-400 shrink-0" />}
                          <span className="font-mono text-[13px]">{v.name}</span>
                          {v.secret && (
                            <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-amber-400/90 border border-amber-500/30 rounded-sm px-1 leading-[14px]">
                              secret
                            </span>
                          )}
                        </div>
                      </TableCell>

                      <TableCell>
                        {editingVar === v.name ? (
                          <Input
                            type={v.secret ? 'password' : 'text'}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, v.name)}
                            placeholder={v.secret ? 'Enter new value...' : 'Enter value...'}
                            className="h-7 max-w-xs font-mono text-[13px]"
                            autoFocus
                          />
                        ) : (
                          <span className="font-mono text-[13px] text-muted-foreground">
                            {v.hasValue ? v.value : <span className="italic text-muted-foreground/60">not set</span>}
                          </span>
                        )}
                      </TableCell>

                      <TableCell>
                        <SourceBadge source={v.source} />
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {editingVar === v.name ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground/80 hover:text-foreground"
                                onClick={() => saveEdit(v.name)}
                                disabled={setMutation.isPending}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground/80 hover:text-foreground"
                                onClick={cancelEdit}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground/80 hover:text-foreground"
                                onClick={() => startEdit(v)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              {v.source === 'override' && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-destructive/80 hover:text-destructive"
                                  onClick={() => deleteMutation.mutate(v.name)}
                                  disabled={deleteMutation.isPending}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: VariableDetail['source'] }) {
  const tone =
    source === 'override' ? 'border-primary/40 bg-primary/10 text-primary' :
    source === 'default' ? 'border-border bg-muted/40 text-muted-foreground' :
    'border-amber-500/40 bg-amber-500/10 text-amber-400';
  return (
    <Badge variant="outline" className={cn('font-mono text-[10px] font-medium uppercase tracking-wider', tone)}>
      {source}
    </Badge>
  );
}

function Stat({ k, v, tone }: { k: string; v: number; tone?: 'primary' | 'warn' }) {
  const cls =
    tone === 'primary' ? 'text-primary' :
    tone === 'warn' ? 'text-amber-400' :
    'text-foreground';
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn('tabular-nums text-[13px] font-medium', cls)}>{v}</span>
      <span className="tracking-[0.3px]">{k}</span>
    </span>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'font-sans text-[11.5px] px-2.5 py-[3px] rounded-sm border transition-colors cursor-pointer',
        active
          ? 'text-foreground bg-accent/40 border-border'
          : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-accent/20',
      )}
    >
      {children}
    </button>
  );
}
