import dagre from 'dagre';
import { useTheme } from '@/components/ThemeProvider';

export interface MiniNode {
  id: string;
  color: string;
  label?: string;
  size?: 'sm' | 'md';
  stacked?: boolean; // Render as overlapping layers (for iterated tasks)
}

export interface MiniEdge {
  source: string;
  target: string;
}

interface MiniGraphProps {
  nodes: MiniNode[];
  edges: MiniEdge[];
  width?: number;
  height?: number;
  className?: string;
  tone?: 'loud' | 'mid' | 'quiet';
  emphasizeId?: string;
}

const defaultColorMap: Record<string, { fill: string; stroke: string }> = {
  amber:  { fill: '#fbbf24', stroke: '#f59e0b' },
  teal:   { fill: '#2dd4bf', stroke: '#14b8a6' },
  blue:   { fill: '#60a5fa', stroke: '#3b82f6' },
  violet: { fill: '#a78bfa', stroke: '#8b5cf6' },
  slate:  { fill: '#94a3b8', stroke: '#64748b' },
  purple: { fill: '#c084fc', stroke: '#a855f7' },
  green:  { fill: '#4ade80', stroke: '#22c55e' },
};

const defcon5ColorMap: Record<string, { fill: string; stroke: string }> = {
  amber:  { fill: '#bef264', stroke: '#a3e635' },
  teal:   { fill: '#34d399', stroke: '#10b981' },
  blue:   { fill: '#22d3ee', stroke: '#06b6d4' },
  violet: { fill: '#86efac', stroke: '#4ade80' },
  slate:  { fill: '#6b8f71', stroke: '#4a7050' },
  purple: { fill: '#4ade80', stroke: '#22c55e' },
  green:  { fill: '#4ade80', stroke: '#22c55e' },
};

const NODE_W = { sm: 12, md: 16 };
const NODE_H = { sm: 8, md: 10 };

export function MiniGraph({
  nodes,
  edges,
  width = 200,
  height = 100,
  className,
  tone = 'loud',
  emphasizeId,
}: MiniGraphProps) {
  const { resolvedTheme } = useTheme();
  const colorMap = resolvedTheme === 'defcon5' ? defcon5ColorMap : defaultColorMap;
  const quiet = tone === 'quiet';

  if (nodes.length === 0) return null;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph(
    quiet
      ? { rankdir: 'LR', nodesep: 8, ranksep: 22, marginx: 12, marginy: 10 }
      : { rankdir: 'LR', nodesep: 12, ranksep: 30, marginx: 20, marginy: 16 },
  );

  for (const n of nodes) {
    const s = n.size ?? 'sm';
    const w = quiet ? 6 : NODE_W[s];
    const h = quiet ? 6 : NODE_H[s];
    g.setNode(n.id, { width: w, height: h });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const graphInfo = g.graph();
  const gw = graphInfo.width ?? 100;
  const gh = graphInfo.height ?? 50;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${gw} ${gh}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
    >
      <defs>
        {/* Soft glow filter for nodes */}
        <filter id="mini-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Edges — curved paths */}
      {edges.map((e) => {
        const sNode = g.node(e.source);
        const tNode = g.node(e.target);
        if (!sNode || !tNode) return null;
        const midX = (sNode.x + tNode.x) / 2;
        return (
          <path
            key={`${e.source}-${e.target}`}
            d={`M ${sNode.x} ${sNode.y} C ${midX} ${sNode.y}, ${midX} ${tNode.y}, ${tNode.x} ${tNode.y}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={quiet ? 1 : 1.2}
            className={quiet ? 'text-emerald-500/35' : 'text-muted-foreground/20'}
          />
        );
      })}

      {/* Quiet tone — soft mint dots + breathing halo on the emphasized node */}
      {quiet && nodes.map((n) => {
        const pos = g.node(n.id);
        if (!pos) return null;
        const isEmph = emphasizeId === n.id;
        return (
          <g key={n.id}>
            {isEmph && (
              <circle
                cx={pos.x}
                cy={pos.y}
                r={7}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.2}
                className="text-emerald-400 sqd-node-ring"
              />
            )}
            <circle
              cx={pos.x}
              cy={pos.y}
              r={isEmph ? 3.75 : 3}
              fill="currentColor"
              className={isEmph ? 'text-emerald-300' : 'text-emerald-400/70'}
            />
          </g>
        );
      })}

      {/* Loud / mid tone — rounded pills with stroke. Mid drops the glow. */}
      {!quiet && nodes.map((n) => {
        const pos = g.node(n.id);
        if (!pos) return null;
        const s = n.size ?? 'sm';
        const w = NODE_W[s];
        const h = NODE_H[s];
        const { fill, stroke } = colorMap[n.color] ?? colorMap.slate;
        const rx = h / 2;
        const x = pos.x - w / 2;
        const y = pos.y - h / 2;
        const glow = tone === 'loud' ? 'url(#mini-glow)' : undefined;
        const fillOpacity = tone === 'loud' ? 1 : 0.85;

        if (n.stacked) {
          return (
            <g key={n.id} filter={glow}>
              <rect x={x + 3} y={y + 3} width={w} height={h} rx={rx}
                fill={fill} stroke={stroke} strokeWidth={0.8} opacity={0.25} />
              <rect x={x + 1.5} y={y + 1.5} width={w} height={h} rx={rx}
                fill={fill} stroke={stroke} strokeWidth={0.8} opacity={0.45} />
              <rect x={x} y={y} width={w} height={h} rx={rx}
                fill={fill} stroke={stroke} strokeWidth={1} opacity={fillOpacity} />
            </g>
          );
        }

        return (
          <rect
            key={n.id}
            x={x}
            y={y}
            width={w}
            height={h}
            rx={rx}
            fill={fill}
            stroke={stroke}
            strokeWidth={1}
            opacity={fillOpacity}
            filter={glow}
          />
        );
      })}
    </svg>
  );
}
