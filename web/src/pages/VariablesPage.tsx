import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { getVariables, setVariable, deleteVariable } from '@/api/client';
import type { VariableDetail } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { KeyRound, Lock, Pencil, Trash2, Check, X } from 'lucide-react';
import { toast } from 'sonner';

export function VariablesPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [editingVar, setEditingVar] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['variables', id],
    queryFn: () => getVariables(id!),
    enabled: !!id,
    refetchInterval: 10000,
  });

  const setMutation = useMutation({
    mutationFn: ({ name, value }: { name: string; value: string }) =>
      setVariable(id!, name, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variables', id] });
      setEditingVar(null);
      toast.success('Variable updated');
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => deleteVariable(id!, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variables', id] });
      toast.success('Override removed');
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const startEdit = (v: VariableDetail) => {
    setEditingVar(v.name);
    setEditValue(v.secret ? '' : (v.source === 'override' ? v.value : ''));
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

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;

  const variables = data?.variables ?? [];

  return (
    <div className="p-8 w-full max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Variables</h1>

      {variables.length === 0 ? (
        <p className="text-muted-foreground">No variables defined in config.</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
          <TableBody>
            {variables.map((v) => (
              <TableRow key={v.name}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {v.secret ? (
                      <Lock className="h-3.5 w-3.5 text-amber-500" />
                    ) : (
                      <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span className="font-mono text-sm">{v.name}</span>
                    {v.secret && (
                      <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30">
                        secret
                      </Badge>
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
                      className="h-8 max-w-xs font-mono text-sm"
                      autoFocus
                    />
                  ) : (
                    <span className="font-mono text-sm text-muted-foreground">
                      {v.hasValue ? v.value : <span className="italic">not set</span>}
                    </span>
                  )}
                </TableCell>

                <TableCell>
                  <Badge
                    variant={v.source === 'override' ? 'default' : 'secondary'}
                    className="text-[10px]"
                  >
                    {v.source}
                  </Badge>
                </TableCell>

                <TableCell>
                  <div className="flex items-center gap-1">
                    {editingVar === v.name ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => saveEdit(v.name)}
                          disabled={setMutation.isPending}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
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
                          className="h-7 w-7"
                          onClick={() => startEdit(v)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {v.source === 'override' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
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
    </div>
  );
}
