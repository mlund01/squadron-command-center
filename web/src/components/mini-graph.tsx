import dagre from 'dagre';

export interface MiniNode {
  id: string;
  color: string;
  label?: string;
  size?: 'sm' | 'md';
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

const colorMap: Record<string, string> = {
  amber: '#f59e0b',
  teal: '#14b8a6',
  blue: '#3b82f6',
  violet: '#8b5cf6',
  slate: '#94a3b8',
  purple: '#a855f7',
  green: '#22c55e',
};

const NODE_W = { sm: 10, md: 14 };
const NODE_H = { sm: 10, md: 12 };

export function MiniGraph({ nodes, edges, width = 200, height = 100, className }: MiniGraphProps) {
  if (nodes.length === 0) return null;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 10, ranksep: 28, marginx: 16, marginy: 16 });

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
      {/* Edges */}
      {edges.map((e) => {
        const sNode = g.node(e.source);
        const tNode = g.node(e.target);
        if (!sNode || !tNode) return null;
        return (
          <line
            key={`${e.source}-${e.target}`}
            x1={sNode.x}
            y1={sNode.y}
            x2={tNode.x}
            y2={tNode.y}
            stroke="currentColor"
            strokeWidth={1}
            className="text-muted-foreground/25"
          />
        );
      })}
      {/* Nodes */}
      {nodes.map((n) => {
        const pos = g.node(n.id);
        if (!pos) return null;
        const s = n.size ?? 'sm';
        const w = NODE_W[s];
        const h = NODE_H[s];
        const fill = colorMap[n.color] ?? colorMap.slate;
        return (
          <rect
            key={n.id}
            x={pos.x - w / 2}
            y={pos.y - h / 2}
            width={w}
            height={h}
            rx={3}
            fill={fill}
            opacity={0.7}
          />
        );
      })}
    </svg>
  );
}
