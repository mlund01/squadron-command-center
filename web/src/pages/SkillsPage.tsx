import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { getInstance } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { MarkdownPreview } from '@/components/MarkdownPreview';
import { cn } from '@/lib/utils';
import type { SkillInfo } from '@/api/types';

export function SkillsPage() {
  const { id } = useParams<{ id: string }>();
  const [selected, setSelected] = useState<SkillInfo | null>(null);

  const { data: instance, isLoading } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const skills = useMemo(() => {
    const raw = instance?.config.skills ?? [];
    return [...raw].sort((a, b) => a.name.localeCompare(b.name));
  }, [instance?.config.skills]);

  useEffect(() => {
    if (!selected && skills.length) setSelected(skills[0]);
  }, [skills, selected]);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!instance) return <div className="p-8 text-muted-foreground">Instance not found</div>;

  if (skills.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-6">Skills</h1>
        <p className="text-muted-foreground">No skills configured.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="w-64 shrink-0 border-r overflow-y-auto">
        <div className="p-3 border-b">
          <h2 className="text-sm font-semibold text-muted-foreground">Skills</h2>
        </div>
        <div className="py-1">
          {skills.map((s) => {
            const key = `${s.agent ?? 'global'}-${s.name}`;
            const isActive = selected?.name === s.name && selected?.agent === s.agent;
            return (
              <button
                key={key}
                onClick={() => setSelected(s)}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors',
                  isActive && 'bg-muted font-medium',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate">{s.name}</span>
                  {s.agent && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                      {s.agent}
                    </Badge>
                  )}
                </div>
                {s.description && (
                  <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{s.description}</div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {selected ? (
          <>
            <div className="p-4 border-b shrink-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">{selected.name}</h2>
                {selected.agent ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">{selected.agent}</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">Global</span>
                )}
              </div>
              {selected.description && (
                <p className="text-sm text-muted-foreground mt-1">{selected.description}</p>
              )}
              {selected.tools && selected.tools.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {selected.tools.map((t) => (
                    <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-auto bg-muted/30 p-8">
              <div className="max-w-4xl bg-background rounded-lg border shadow-sm">
                <MarkdownPreview content={selected.instructions} />
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select a skill to view its instructions
          </div>
        )}
      </div>
    </div>
  );
}
