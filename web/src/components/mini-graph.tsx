import dagre from 'dagre';

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
}

const colorMap: Record<string, { fill: string; stroke: string }> = {
  amber:  { fill: '#fbbf24', stroke: '#f59e0b' },
  teal:   { fill: '#2dd4bf', stroke: '#14b8a6' },
  blue:   { fill: '#60a5fa', stroke: '#3b82f6' },
  violet: { fill: '#a78bfa', stroke: '#8b5cf6' },
  slate:  { fill: '#94a3b8', stroke: '#64748b' },
  purple: { fill: '#c084fc', stroke: '#a855f7' },
  green:  { fill: '#4ade80', stroke: '#22c55e' },
};

const NODE_W = { sm: 12, md: 16 };
const NODE_H = { sm: 8, md: 10 };

export function MiniGraph({ nodes, edges, width = 200, height = 100, className }: MiniGraphProps) {
  if (nodes.length === 0) return null;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 12, ranksep: 30, marginx: 20, marginy: 16 });

  for (const n of nodes) {
    const s = n.size ?? 'sm';
    g.setNode(n.id, { width: NODE_W[s], height: NODE_H[s] });
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
            strokeWidth={1.2}
            className="text-muted-foreground/20"
          />
        );
      })}

      {/* Nodes — rounded pills with stroke */}
      {nodes.map((n) => {
        const pos = g.node(n.id);
        if (!pos) return null;
        const s = n.size ?? 'sm';
        const w = NODE_W[s];
        const h = NODE_H[s];
        const { fill, stroke } = colorMap[n.color] ?? colorMap.slate;
        const rx = h / 2;
        const x = pos.x - w / 2;
        const y = pos.y - h / 2;

        if (n.stacked) {
          // Stacked look: 2 offset layers behind the main node
          return (
            <g key={n.id} filter="url(#mini-glow)">
              <rect x={x + 3} y={y + 3} width={w} height={h} rx={rx}
                fill={fill} stroke={stroke} strokeWidth={0.8} opacity={0.3} />
              <rect x={x + 1.5} y={y + 1.5} width={w} height={h} rx={rx}
                fill={fill} stroke={stroke} strokeWidth={0.8} opacity={0.5} />
              <rect x={x} y={y} width={w} height={h} rx={rx}
                fill={fill} stroke={stroke} strokeWidth={1} opacity={1} />
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
            opacity={1}
            filter="url(#mini-glow)"
          />
        );
      })}
    </svg>
  );
}
