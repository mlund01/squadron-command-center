import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ReactFlowRef } from '@/hooks/use-resizable-panel';

export function ZoomControls({ reactFlowRef }: { reactFlowRef: React.RefObject<ReactFlowRef | null> }) {
  return (
    <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-background/80 backdrop-blur-sm rounded-md border shadow-sm p-0.5">
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => reactFlowRef.current?.zoomIn()}>
        <ZoomIn className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => reactFlowRef.current?.zoomOut()}>
        <ZoomOut className="h-3.5 w-3.5" />
      </Button>
      <div className="w-px h-4 bg-border" />
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => reactFlowRef.current?.fitView()}>
        <Maximize className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
