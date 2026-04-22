import type { ReactNode } from 'react';
import { MiniGraph, type MiniNode, type MiniEdge } from './mini-graph';
import { Dot } from './ui-shell';
import { cn } from '@/lib/utils';

interface SkillCardProps {
  name: string;
  description?: string;
  tools: number;
  usedBy: number;
  agent?: string | null;
  graph?: { nodes: MiniNode[]; edges: MiniEdge[] };
  action?: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function SkillCard({
  name,
  description,
  tools,
  usedBy,
  agent,
  graph,
  action,
  onClick,
  className,
}: SkillCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'group rounded-sm border border-border/60 bg-card',
        'flex flex-col gap-3.5 p-4',
        'transition-colors hover:border-foreground/25 hover:bg-accent/30',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {/* Header: name + overflow */}
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate font-mono text-[13px] font-semibold tracking-tight">
          {name}
        </span>
        {action && <div className="shrink-0" onClick={(e) => e.stopPropagation()}>{action}</div>}
      </div>

      {/* Description */}
      {description ? (
        <p className="text-[12.5px] leading-[1.5] text-muted-foreground line-clamp-2 min-h-[38px]">
          {description}
        </p>
      ) : (
        <p className="text-[12.5px] leading-[1.5] text-muted-foreground/60 italic min-h-[38px]">
          No description
        </p>
      )}

      {/* Mini-DAG */}
      <div className="h-[58px] -mt-0.5 flex items-center justify-center">
        {graph && graph.nodes.length > 0 ? (
          <MiniGraph
            nodes={graph.nodes}
            edges={graph.edges}
            tone="mid"
            width={260}
            height={58}
            className="w-full"
          />
        ) : (
          <span className="text-[10px] text-muted-foreground/40 font-mono">—</span>
        )}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2.5 font-mono text-[10.5px] tabular-nums tracking-[0.2px] text-muted-foreground/80">
        <span>{tools} tool{tools !== 1 ? 's' : ''}</span>
        <Dot />
        <span>
          {usedBy === 0 ? 'unused' : `used by ${usedBy} agent${usedBy !== 1 ? 's' : ''}`}
        </span>
        <span className="flex-1" />
        {agent ? (
          <span className="truncate rounded-sm border border-border px-1.5 py-[1px] text-muted-foreground">
            {agent}
          </span>
        ) : (
          <span className="text-muted-foreground/70">global</span>
        )}
      </div>
    </div>
  );
}
