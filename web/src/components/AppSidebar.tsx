import { useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { listInstances, reloadConfig, getCurrentUser, logout, getMissionHistory, getServerInfo } from '@/api/client';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from '@/components/ui/sidebar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertTriangle, LogOut } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ThemeToggle } from '@/components/ThemeToggle';
import { cn } from '@/lib/utils';

type IconProps = { className?: string };

// Minimal hairline icons — 14×14, 1.3 stroke, matching the design bundle
function IconMission({ className }: IconProps) {
  return (
    <svg viewBox="0 0 14 14" className={cn('size-3.5', className)} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="3" cy="3" r="1.5" />
      <circle cx="11" cy="3" r="1.5" />
      <circle cx="7" cy="11" r="1.5" />
      <path d="M3 3 L7 11 M11 3 L7 11" />
    </svg>
  );
}
function IconAgent({ className }: IconProps) {
  return (
    <svg viewBox="0 0 14 14" className={cn('size-3.5', className)} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="5" r="2" />
      <path d="M3 12 C3 9 5 8 7 8 C9 8 11 9 11 12" />
    </svg>
  );
}
function IconSkill({ className }: IconProps) {
  return (
    <svg viewBox="0 0 14 14" className={cn('size-3.5', className)} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 7 L5 4 L8 7 L5 10 Z" />
      <path d="M9 3 L12 6" />
    </svg>
  );
}
function IconTool({ className }: IconProps) {
  return (
    <svg viewBox="0 0 14 14" className={cn('size-3.5', className)} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2 A3 3 0 0 0 6 5 L2 9 L4 11 L8 7 A3 3 0 0 0 11 4 L10 5 L9 4 L10 3 Z" />
    </svg>
  );
}
function IconCost({ className }: IconProps) {
  return (
    <svg viewBox="0 0 14 14" className={cn('size-3.5', className)} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 2 L7 12 M4 4 L10 4 Q10 7 7 7 Q4 7 4 9.5 L10 9.5" />
    </svg>
  );
}
function IconVar({ className }: IconProps) {
  return (
    <svg viewBox="0 0 14 14" className={cn('size-3.5', className)} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3 Q6 3 6 7 Q6 11 10 11 M4 6 L6 8 M4 8 L6 6" />
    </svg>
  );
}
function IconCfg({ className }: IconProps) {
  return (
    <svg viewBox="0 0 14 14" className={cn('size-3.5', className)} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="2" />
      <path d="M7 1 L7 3 M7 11 L7 13 M1 7 L3 7 M11 7 L13 7 M3 3 L4 4 M10 10 L11 11 M3 11 L4 10 M10 4 L11 3" />
    </svg>
  );
}
function IconFolder({ className }: IconProps) {
  return (
    <svg viewBox="0 0 14 14" className={cn('size-3.5', className)} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4 L6 4 L7 5 L12 5 L12 11 L2 11 Z" />
    </svg>
  );
}

function SquadronMark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 18 18" className={cn('size-[18px]', className)} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.4}>
      <path d="M3 5 L9 2 L15 5" className="stroke-primary" />
      <path d="M3 9 L9 6 L15 9" className="stroke-foreground" />
      <path d="M3 13 L9 10 L15 13" className="stroke-muted-foreground" />
    </svg>
  );
}

function StatusDot({ tone, live = false, size = 6 }: { tone: 'running' | 'completed' | 'failed' | 'idle'; live?: boolean; size?: number }) {
  const color =
    tone === 'running' ? 'bg-blue-500' :
    tone === 'completed' ? 'bg-green-500' :
    tone === 'failed' ? 'bg-red-500' :
    'bg-muted-foreground/60';
  return (
    <span className="relative inline-flex shrink-0" style={{ height: size, width: size }}>
      <span className={cn('absolute inset-0 rounded-full', color)} />
      {live && <span className={cn('absolute inset-0 rounded-full animate-ping opacity-60', color)} />}
    </span>
  );
}

const staticNavItems: { label: string; path: string; icon: (p: IconProps) => ReactElement }[] = [
  { label: 'Missions',  path: 'missions',  icon: IconMission },
  { label: 'Agents',    path: 'agents',    icon: IconAgent },
  { label: 'Skills',    path: 'skills',    icon: IconSkill },
  { label: 'Tools',     path: 'tools',     icon: IconTool },
  { label: 'Costs',     path: 'costs',     icon: IconCost },
  { label: 'Variables', path: 'variables', icon: IconVar },
  { label: 'Config',    path: 'config',    icon: IconCfg },
];

export function AppSidebar() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [reloading, setReloading] = useState(false);

  const handleReload = async () => {
    if (!id || reloading) return;
    setReloading(true);
    try {
      await reloadConfig(id);
      toast.success('Config reloaded');
      queryClient.invalidateQueries({ queryKey: ['instances'] });
      queryClient.invalidateQueries({ queryKey: ['instance', id] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Reload failed';
      toast.error('Config reload failed', { description: msg });
    } finally {
      setReloading(false);
    }
  };

  const { data: instances } = useQuery({
    queryKey: ['instances'],
    queryFn: listInstances,
    refetchInterval: 5000,
  });

  const { data: currentUser } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: getCurrentUser,
    staleTime: Infinity,
  });

  const { data: serverInfo } = useQuery({
    queryKey: ['serverInfo'],
    queryFn: getServerInfo,
    staleTime: Infinity,
  });

  const connectedInstances = instances?.filter((i) => i.connected) ?? [];
  const currentInstance = instances?.find((i) => i.id === id);

  const { data: history } = useQuery({
    queryKey: ['history', id],
    queryFn: () => getMissionHistory(id!),
    enabled: !!id && !!currentInstance?.connected,
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  });

  const runningCount = (history?.missions ?? []).filter((m) => m.status === 'running').length;
  const queuedCount = (history?.missions ?? []).filter((m) => m.status === 'queued' || m.status === 'pending').length;

  const handleInstanceChange = (instanceId: string) => {
    navigate(`/instances/${instanceId}/missions`);
  };

  const navItems = currentInstance?.config?.sharedFolders?.length
    ? [...staticNavItems, { label: 'Folders', path: 'files', icon: IconFolder }]
    : staticNavItems;

  const activePath = location.pathname.split('/').at(-1) ?? '';
  const activeSection = location.pathname.includes('/missions/') && location.pathname.includes('/run')
    ? 'missions'
    : location.pathname.includes('/runs/')
    ? 'missions'
    : location.pathname.includes('/history')
    ? 'missions'
    : location.pathname.includes('/files')
    ? 'files'
    : location.pathname.includes('/skills/')
    ? 'skills'
    : activePath;

  return (
    <Sidebar>
      {/* Brand header */}
      <SidebarHeader className="h-11 px-3.5 py-0 flex-row items-center gap-2 border-b border-sidebar-border">
        <SquadronMark />
        <span className="font-mono text-[13px] font-semibold tracking-tight">Squadron</span>
      </SidebarHeader>

      {/* Workspace picker */}
      <div className="px-3 pt-3 pb-2 border-b border-sidebar-border">
        <Select value={id ?? ''} onValueChange={handleInstanceChange}>
          <SelectTrigger
            className="w-full min-w-0 h-auto py-[5px] px-2 rounded-sm border-sidebar-border shadow-none bg-transparent text-[11.5px] text-muted-foreground hover:text-foreground"
          >
            <span className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
              <StatusDot tone={currentInstance?.connected ? 'completed' : 'idle'} size={6} />
              <span className={cn('truncate text-left min-w-0 flex-1', !currentInstance && 'text-muted-foreground/60')}>
                {currentInstance?.name ?? 'Select instance…'}
              </span>
              {currentInstance && (
                <span className="font-mono text-[10px] text-muted-foreground/70 shrink-0">
                  v{currentInstance.version}
                </span>
              )}
            </span>
          </SelectTrigger>
          <SelectContent>
            {connectedInstances.map((instance) => (
              <SelectItem key={instance.id} value={instance.id}>
                <span className="truncate">{instance.name}</span>
              </SelectItem>
            ))}
            {connectedInstances.length === 0 && (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                No instances connected
              </div>
            )}
          </SelectContent>
        </Select>
        {currentInstance && (
          <div className="mt-1.5 flex items-center gap-1 pl-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground/80"
              onClick={handleReload}
              disabled={reloading || !currentInstance.connected}
              title="Reload config"
            >
              <RefreshCw className={cn('h-3 w-3', reloading && 'animate-spin')} />
            </Button>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <SidebarContent className="px-2 py-2">
        <nav className="flex flex-col">
          {navItems.map((item) => {
            const isActive = activeSection === item.path;
            const count = getNavCount(item.path, currentInstance?.config);
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={id ? `/instances/${id}/${item.path}` : '#'}
                aria-disabled={!id}
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-1.5 rounded-sm text-[12.5px] transition-colors mb-px',
                  isActive
                    ? 'bg-sidebar-accent/50 text-sidebar-accent-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/25',
                  !id && 'pointer-events-none opacity-50',
                )}
              >
                <Icon className={isActive ? 'text-sidebar-accent-foreground' : 'text-muted-foreground'} />
                <span className="flex-1 truncate">{item.label}</span>
                {count !== undefined && (
                  <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground/70">
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {currentInstance && currentInstance.connected && !currentInstance.configReady && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="mx-1 mt-3 rounded-sm border border-yellow-500/50 bg-yellow-500/10 px-2.5 py-2 cursor-default">
                <div className="flex items-center gap-1.5 text-yellow-600 dark:text-yellow-400">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  <span className="text-[11px] font-medium">Config Invalid</span>
                </div>
                <p className="mt-1 text-[10.5px] text-muted-foreground line-clamp-3 leading-snug">
                  {currentInstance.configError || 'Fix config errors or set missing variables to enable missions.'}
                </p>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-80">
              <p className="text-sm">
                {currentInstance.configError || 'Fix config errors or set missing variables to enable missions.'}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
        {serverInfo?.version && (
          <div
            className="px-3.5 pb-2 mt-auto font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/60 truncate"
            title="Command Center version"
          >
            command center · v{serverInfo.version}
          </div>
        )}
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="px-3.5 py-2.5 gap-1.5 border-t border-sidebar-border">
        <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground/80">
          <StatusDot
            tone={runningCount > 0 ? 'running' : currentInstance?.connected ? 'completed' : 'idle'}
            live={runningCount > 0}
            size={5}
          />
          <span className="truncate">
            {currentInstance?.connected
              ? `${runningCount} running · ${queuedCount} queued`
              : 'disconnected'}
          </span>
        </div>

        {currentUser && (
          <div className="flex items-center gap-2 min-w-0 pt-2 border-t border-sidebar-border">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium truncate" title={currentUser.name || currentUser.email}>
                {currentUser.name || currentUser.email}
              </div>
              {currentUser.name && (
                <div className="text-[10px] text-muted-foreground truncate" title={currentUser.email}>
                  {currentUser.email}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground/80"
              onClick={() => logout()}
              title="Log out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

function getNavCount(path: string, config?: { missions?: unknown[]; agents?: unknown[]; plugins?: unknown[]; variables?: unknown[]; skills?: unknown[]; sharedFolders?: unknown[] }): number | undefined {
  if (!config) return undefined;
  switch (path) {
    case 'missions': return config.missions?.length;
    case 'agents': return config.agents?.length;
    case 'skills': return config.skills?.length;
    case 'tools': return config.plugins?.length;
    case 'variables': return config.variables?.length;
    case 'files': return config.sharedFolders?.length;
    default: return undefined;
  }
}
