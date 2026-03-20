import { Badge } from '@/components/ui/badge';

export function StatusBadge({ status }: { status: string }) {
  const variant = status === 'completed' ? 'default' as const
    : status === 'failed' ? 'destructive' as const
    : status === 'stopped' ? 'outline' as const
    : 'secondary' as const;
  return <Badge variant={variant}>{status}</Badge>;
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function formatDuration(start: string, end: string): string {
  try {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remainSecs = secs % 60;
    return `${mins}m ${remainSecs}s`;
  } catch {
    return '\u2014';
  }
}
