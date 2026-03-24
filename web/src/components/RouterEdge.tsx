import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

export function RouterEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd,
}: EdgeProps) {
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const condition = (data?.condition as string) ?? '';

  const onMouseEnter = useCallback((e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  }, []);

  const onMouseLeave = useCallback(() => {
    setMousePos(null);
  }, []);

  return (
    <g
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} interactionWidth={20} />
      {mousePos && condition && createPortal(
        <div
          className="pointer-events-none fixed px-2.5 py-1.5 rounded bg-popover text-popover-foreground text-xs shadow-lg border max-w-[260px] leading-snug"
          style={{
            left: mousePos.x,
            top: mousePos.y - 8,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999,
          }}
        >
          <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">Run when</span>
          <p className="mt-0.5">{condition}</p>
        </div>,
        document.body,
      )}
    </g>
  );
}
