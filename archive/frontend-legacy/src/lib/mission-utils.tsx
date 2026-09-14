import { Badge } from '@/components/ui/badge';
import type { ScheduleInfo } from '@/api/types';

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

/** Short relative time ago: 34s / 12m / 3h / 2d. Returns "—" for invalid input. */
export function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Compact schedule label: `@every 6h`, `@daily 09:00`, `@weekly 09:00`, or the raw cron expression. */
export function formatSchedule(s: ScheduleInfo | undefined): string | null {
  if (!s) return null;
  if (s.every) return `@every ${s.every}`;
  if (s.at && s.at.length > 0) {
    const prefix = s.weekdays && s.weekdays.length > 0 ? '@weekly' : '@daily';
    return `${prefix} ${s.at[0]}`;
  }
  if (s.expression) return s.expression;
  return 'scheduled';
}
