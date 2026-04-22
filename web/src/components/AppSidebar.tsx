import { useState } from 'react';
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
import {
  RefreshCw,
  AlertTriangle,
  LogOut,
  Rocket,
  Bot,
  Sparkles,
  Puzzle,
  DollarSign,
  KeyRound,
  FileCode,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ThemeToggle } from '@/components/ThemeToggle';
import { cn } from '@/lib/utils';

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

const staticNavItems: { label: string; path: string; icon: LucideIcon }[] = [
  { label: 'Missions',  path: 'missions',  icon: Rocket },
  { label: 'Agents',    path: 'agents',    icon: Bot },
  { label: 'Skills',    path: 'skills',    icon: Sparkles },
  { label: 'Tools',     path: 'tools',     icon: Puzzle },
  { label: 'Costs',     path: 'costs',     icon: DollarSign },
  { label: 'Variables', path: 'variables', icon: KeyRound },
  { label: 'Config',    path: 'config',    icon: FileCode },
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
    refetchIntervalInBackground: false,
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
    ? [...staticNavItems, { label: 'Folders', path: 'files', icon: FolderOpen }]
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
      <SidebarHeader className="h-11 px-3.5 py-0 flex-row items-center justify-center gap-2 border-b border-sidebar-border">
        <img src="/squadron-logo.svg" alt="Squadron" className="size-[18px] shrink-0" />
        <span className="sqd-brand text-[14px] uppercase leading-none">Squadron</span>
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
                <Icon
                  className={cn('size-3.5', isActive ? 'text-sidebar-accent-foreground' : 'text-muted-foreground')}
                  strokeWidth={1.75}
                />
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
