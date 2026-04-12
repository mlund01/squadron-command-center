import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { listInstances, reloadConfig, getCurrentUser, logout } from '@/api/client';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
  SidebarGroup,
  SidebarGroupContent,
} from '@/components/ui/sidebar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Rocket, Bot, Puzzle, RefreshCw, History, FileCode, FolderOpen, KeyRound, AlertTriangle, DollarSign, Sparkles, LogOut } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ThemeToggle } from '@/components/ThemeToggle';

const staticNavItems = [
  { label: 'Missions', path: 'missions', icon: Rocket },
  { label: 'History', path: 'history', icon: History },
  { label: 'Agents', path: 'agents', icon: Bot },
  { label: 'Skills', path: 'skills', icon: Sparkles },
  { label: 'Tools', path: 'tools', icon: Puzzle },
  { label: 'Costs', path: 'costs', icon: DollarSign },
  { label: 'Variables', path: 'variables', icon: KeyRound },
  { label: 'Config', path: 'config', icon: FileCode },
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

  // Current user — null when auth is disabled (endpoint 404s) or unauthenticated.
  // Loaded once per mount; no refetch interval since identity doesn't change.
  const { data: currentUser } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: getCurrentUser,
    staleTime: Infinity,
  });

  const connectedInstances = instances?.filter((i) => i.connected) ?? [];
  const currentInstance = instances?.find((i) => i.id === id);

  const handleInstanceChange = (instanceId: string) => {
    navigate(`/instances/${instanceId}/missions`);
  };

  // Build nav items — add "Files" when file browsers are configured
  const navItems = currentInstance?.config?.sharedFolders?.length
    ? [...staticNavItems, { label: 'Folders', path: 'files', icon: FolderOpen }]
    : staticNavItems;

  // Determine active nav item from URL
  const activePath = location.pathname.split('/').at(-1) ?? '';
  // Handle nested paths like /missions/:name/run, /runs/:mid, and /files/view
  const activeSection = location.pathname.includes('/missions/') && location.pathname.includes('/run')
    ? 'missions'
    : location.pathname.includes('/runs/')
    ? 'history'
    : location.pathname.includes('/files')
    ? 'files'
    : location.pathname.includes('/skills/')
    ? 'skills'
    : activePath;

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="text-sm font-semibold text-muted-foreground mb-2">Squadron</div>
        <Select value={id ?? ''} onValueChange={handleInstanceChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select instance..." />
          </SelectTrigger>
          <SelectContent>
            {connectedInstances.map((instance) => (
              <SelectItem key={instance.id} value={instance.id}>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                  <span>{instance.name}</span>
                </div>
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
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">v{currentInstance.version}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={handleReload}
              disabled={reloading || !currentInstance.connected}
              title="Reload config"
            >
              <RefreshCw className={`h-3 w-3 ${reloading ? 'animate-spin' : ''}`} />
            </Button>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </div>
        )}
      </SidebarHeader>

      <SidebarSeparator className="!w-auto" />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = activeSection === item.path;
                const count = getNavCount(item.path, currentInstance?.config);
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      disabled={!id}
                    >
                      <Link to={id ? `/instances/${id}/${item.path}` : '#'}>
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                        {count !== undefined && (
                          <Badge variant="secondary" className="ml-auto text-xs">
                            {count}
                          </Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {currentInstance && currentInstance.connected && !currentInstance.configReady && (
          <SidebarGroup>
            <SidebarGroupContent>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="mx-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 cursor-default">
                    <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
                      <AlertTriangle className="size-4 flex-shrink-0" />
                      <span className="text-xs font-medium">Config Invalid</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-3">
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
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {currentUser && (
        <SidebarFooter className="p-3 border-t">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate" title={currentUser.name || currentUser.email}>
                {currentUser.name || currentUser.email}
              </div>
              {currentUser.name && (
                <div className="text-xs text-muted-foreground truncate" title={currentUser.email}>
                  {currentUser.email}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0"
              onClick={() => logout()}
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </SidebarFooter>
      )}
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
