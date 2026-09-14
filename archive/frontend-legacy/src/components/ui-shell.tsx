/**
 * Shared building blocks for the list-page shell used across Missions,
 * Agents, Skills, Tools, Variables, Costs, and History views:
 *   - FilterChip: small pill button used in the stats/filter strip
 *   - SearchBox:  magnifier icon + single-line input with muted placeholder
 *   - InlineStat: `<value> <label>` pair for the mono stats row
 *   - Dot:        dot separator used inside card meta rows
 */

import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// FilterChip
// ─────────────────────────────────────────────────────────────────────────────
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'font-sans text-[11.5px] px-2.5 py-[3px] rounded-sm border transition-colors cursor-pointer',
        active
          ? 'text-foreground bg-accent/40 border-border'
          : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-accent/20',
      )}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SearchBox
// ─────────────────────────────────────────────────────────────────────────────
export function SearchBox({
  value,
  onChange,
  placeholder,
  width = 200,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  width?: number;
}) {
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 border border-border/60 rounded-sm text-foreground/90"
      style={{ width }}
    >
      <Search className="h-3 w-3 text-muted-foreground/70" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-transparent outline-none text-[11.5px] placeholder:text-muted-foreground/60 font-sans"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InlineStat — `N label` on the mono stats strip
// ─────────────────────────────────────────────────────────────────────────────
// Map of supported accent tones → text class. Extend here when pages need a new
// accent; all callers stay stringly-typed via `keyof typeof STAT_TONES`.
const STAT_TONES = {
  running:  'text-blue-400',
  failed:   'text-red-400',
  primary:  'text-primary',
  warn:     'text-amber-400',
  blue:     'text-blue-400',
  emerald:  'text-emerald-400',
} as const;

export type StatTone = keyof typeof STAT_TONES;

export function InlineStat({
  k,
  v,
  tone,
  emphasize,
}: {
  k: string;
  v: number | string;
  tone?: StatTone;
  emphasize?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className={cn(
          'tabular-nums text-[13px]',
          emphasize ? 'font-semibold' : 'font-medium',
          tone ? STAT_TONES[tone] : 'text-foreground',
        )}
      >
        {v}
      </span>
      <span className="tracking-[0.3px]">{k}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dot — muted `·` separator for card meta rows
// ─────────────────────────────────────────────────────────────────────────────
export function Dot() {
  return <span className="text-muted-foreground/50">·</span>;
}
