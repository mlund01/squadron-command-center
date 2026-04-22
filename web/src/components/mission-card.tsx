import type { ReactNode } from 'react';
import { MiniGraph, type MiniNode, type MiniEdge } from './mini-graph';
import { cn } from '@/lib/utils';

interface MissionCardProps {
  name: string;
  description?: string;
  tasks: number;
  agents: number;
  inputs: number;
  schedule?: string | null;
  runningCount: number;
  lastRunAgo?: string | null;
  graph?: { nodes: MiniNode[]; edges: MiniEdge[]; emphasizeId?: string };
  action?: ReactNode;
  onClick?: () => void;
  className?: string;
}

function Dot() {
  return <span className="text-muted-foreground/50">·</span>;
}

export function MissionCard({
  name,
  description,
  tasks,
  agents,
  inputs,
  schedule,
  runningCount,
  lastRunAgo,
  graph,
  action,
  onClick,
  className,
}: MissionCardProps) {
  const isRunning = runningCount > 0;

  const statusText = isRunning
    ? `${runningCount} running`
    : lastRunAgo
      ? `last run ${lastRunAgo} ago`
      : 'never run';

  return (
    <div
      onClick={onClick}
      className={cn(
        'group rounded-sm border bg-card/60',
        'flex flex-col gap-3.5 p-4',
        'transition-colors hover:bg-card',
        isRunning
          ? 'border-primary/60 sqd-card-live hover:border-primary/80'
          : 'border-border/60 hover:border-foreground/25',
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

      {/* Mini-DAG — quiet hairline preview */}
      <div className="h-[58px] -mt-0.5 flex items-center justify-center">
        {graph && graph.nodes.length > 0 ? (
          <MiniGraph
            nodes={graph.nodes}
            edges={graph.edges}
            tone="quiet"
            emphasizeId={graph.emphasizeId}
            width={260}
            height={58}
            className="w-full"
          />
        ) : (
          <span className="text-[10px] text-muted-foreground/40 font-mono">—</span>
        )}
      </div>

      {/* Meta row — mono text, dot separators */}
      <div className="flex items-center gap-2.5 font-mono text-[10.5px] tabular-nums tracking-[0.2px] text-muted-foreground/80">
        <span>{tasks} task{tasks !== 1 ? 's' : ''}</span>
        <Dot />
        <span>{agents} agent{agents !== 1 ? 's' : ''}</span>
        {inputs > 0 && (
          <>
            <Dot />
            <span>{inputs} input{inputs !== 1 ? 's' : ''}</span>
          </>
        )}
        {schedule && (
          <>
            <Dot />
            <span className="truncate text-muted-foreground">{schedule}</span>
          </>
        )}
        <span className="flex-1" />
        <span className={cn('shrink-0', isRunning ? 'text-primary font-medium' : 'text-muted-foreground/80')}>
          {statusText}
        </span>
      </div>
    </div>
  );
}
