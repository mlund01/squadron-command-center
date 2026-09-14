import type { ComponentProps } from 'react';
import { GripVertical } from 'lucide-react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { cn } from '@/lib/utils';

export function ResizablePanelGroup({ className, ...props }: ComponentProps<typeof Group>) {
  return <Group className={cn('h-full w-full min-h-0 min-w-0', className)} {...props} />;
}

export const ResizablePanel = Panel;

export function ResizableHandle({ className, ...props }: ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cn('group relative z-10 flex w-1 shrink-0 items-center justify-center bg-border/70 outline-none hover:bg-ring/60 focus-visible:bg-ring focus-visible:ring-2 focus-visible:ring-ring', className)}
      {...props}
    >
      <span className="pointer-events-none flex h-8 w-3 items-center justify-center rounded-sm border bg-muted text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground">
        <GripVertical className="size-3" />
      </span>
    </Separator>
  );
}
