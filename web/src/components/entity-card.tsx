import type { ReactNode } from 'react';
import { MiniGraph, type MiniNode, type MiniEdge } from './mini-graph';
import { NodeChip } from './node-chip';
import { Badge } from './ui/badge';
import { cn } from '@/lib/utils';

interface EntityCardProps {
  name: string;
  description?: string;
  variant: 'mission' | 'agent' | 'skill' | 'plugin' | 'tool';
  badges?: { label: string; variant?: 'default' | 'secondary' | 'outline' }[];
  graph?: { nodes: MiniNode[]; edges: MiniEdge[] };
  action?: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function EntityCard({ name, description, variant, badges, graph, action, onClick, className }: EntityCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'group rounded-lg border bg-card overflow-hidden transition-all hover:shadow-md hover:border-foreground/20',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {/* Mini graph preview */}
      {graph && graph.nodes.length > 0 && (
        <div className="bg-gradient-to-b from-muted/60 to-muted/20 border-b border-border/50">
          <MiniGraph nodes={graph.nodes} edges={graph.edges} width={300} height={100} className="w-full" />
        </div>
      )}

      {/* Content */}
      <div className="p-4">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm truncate">{name}</span>
          <NodeChip variant={variant} />
          {action && <div className="ml-auto shrink-0">{action}</div>}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{description}</p>
        )}
        {badges && badges.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {badges.map((b) => (
              <Badge key={b.label} variant={b.variant ?? 'secondary'} className="text-[10px] px-1.5 py-0">
                {b.label}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
