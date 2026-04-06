import { cn } from '@/lib/utils';

const colorMap = {
  mission: 'border-teal-500/40 text-teal-500',
  task: 'border-purple-500/40 text-purple-500',
  skill: 'border-amber-500/40 text-amber-500',
  agent: 'border-violet-500/40 text-violet-500',
  plugin: 'border-blue-500/40 text-blue-500',
  builtin: 'border-blue-500/40 text-blue-500',
  tool: 'border-slate-500/30 text-slate-400',
} as const;

type ChipVariant = keyof typeof colorMap;

interface NodeChipProps {
  variant: ChipVariant;
  label?: string;
  className?: string;
}

export function NodeChip({ variant, label, className }: NodeChipProps) {
  return (
    <span className={cn(
      'text-[9px] font-semibold uppercase tracking-wider px-1 py-0 rounded border shrink-0 leading-[16px] inline-flex items-center',
      colorMap[variant],
      className,
    )}>
      {label ?? variant}
    </span>
  );
}
