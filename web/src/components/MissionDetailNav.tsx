import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import type { MissionInfo } from '@/api/types';
import { cn } from '@/lib/utils';

export function MissionDetailNav({ action, mission, workspaceId }: { action?: ReactNode; mission: MissionInfo; workspaceId: string }) {
  const base = `/w/${workspaceId}/missions/${encodeURIComponent(mission.name)}`;
  return <header className="mb-6">
    <Link className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground" to={`/w/${workspaceId}/missions`}><ArrowLeft className="size-3" />Missions</Link>
    <div className="mt-4 flex items-start justify-between gap-5"><div className="min-w-0"><p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Mission</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{mission.name}</h1>{mission.description && <p className="mt-2 max-w-3xl text-xs leading-5 text-muted-foreground">{mission.description}</p>}</div>{action && <div className="shrink-0">{action}</div>}</div>
    <nav aria-label="Mission detail" className="mt-5 flex gap-1 border-b">
      <NavLink className={({ isActive }) => cn('border-b-2 border-transparent px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground', isActive && 'border-primary text-foreground')} end to={base}>Definition</NavLink>
      <NavLink className={({ isActive }) => cn('border-b-2 border-transparent px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground', isActive && 'border-primary text-foreground')} to={`${base}/runs`}>Runs</NavLink>
    </nav>
  </header>;
}
