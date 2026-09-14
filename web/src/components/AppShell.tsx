import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeft,
  Bot,
  Boxes,
  Cable,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Command,
  FileCog,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Settings2,
  ShieldCheck,
  ScrollText,
  Target,
  UsersRound,
  WifiOff,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { getCurrentUser, listWorkspaces } from '@/api/client';
import type { Workspace } from '@/api/types';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export type AppContext = 'global' | 'workspace';

type NavigationItem = {
  icon: LucideIcon;
  label: string;
  to: string;
  end?: boolean;
};

export function AppShell({ context }: { context: AppContext }) {
  const { workspaceId } = useParams();
  const location = useLocation();
  const isAgentConversation = /^\/w\/[^/]+\/agents\/[^/]+(?:\/session)?\/?$/.test(location.pathname);
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem('sidebarCollapsed') === 'true');
  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
    refetchInterval: 2_000,
    refetchIntervalInBackground: false,
  });
  const user = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser });
  const routeWorkspace = workspaces.data?.find((candidate) => candidate.id === workspaceId);
  const lastWorkspaceID = window.localStorage.getItem('lastWorkspaceId');
  const lastWorkspace = workspaces.data?.find((candidate) => candidate.id === lastWorkspaceID);
  const workspace = routeWorkspace ?? lastWorkspace ?? workspaces.data?.[0];

  useEffect(() => {
    if (workspace) {
      window.localStorage.setItem('lastWorkspaceId', workspace.id);
    }
  }, [workspace]);

  useEffect(() => {
    window.localStorage.setItem('sidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (workspaces.isLoading) {
      return;
    }
    if (workspaces.data?.length === 0 && location.pathname !== '/workspaces') {
      navigate('/workspaces', { replace: true });
      return;
    }
    if (context === 'workspace' && !routeWorkspace && workspace) {
      navigate(`/w/${workspace.id}`, { replace: true });
    }
  }, [context, location.pathname, navigate, routeWorkspace, workspace, workspaces.data, workspaces.isLoading]);

  const desktopSidebar = (
    <Sidebar
      collapsed={sidebarCollapsed}
      context={context}
      onNavigate={() => setMobileOpen(false)}
      onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      user={user.data}
      workspace={workspace}
      workspaces={workspaces.data ?? []}
    />
  );
  const mobileSidebar = <Sidebar context={context} onNavigate={() => setMobileOpen(false)} user={user.data} workspace={workspace} workspaces={workspaces.data ?? []} />;

  return (
    <div className="min-h-svh bg-background">
      <aside className={cn('fixed inset-y-0 left-0 z-40 hidden border-r bg-muted/60 transition-[width] duration-200 md:block dark:bg-card', sidebarCollapsed ? 'w-14' : 'w-[17rem]')}>
        {desktopSidebar}
      </aside>

      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/90 px-4 backdrop-blur md:hidden">
        <button
          aria-label="Open navigation"
          className="flex size-9 items-center justify-center rounded-md border"
          onClick={() => setMobileOpen(true)}
          type="button"
        >
          <Menu className="size-4" />
        </button>
        <span className="flex items-center gap-2"><span className="brand-label text-xs">SQUADRON</span>{workspace && <RunnerStatusDot workspace={workspace} />}</span>
        <ThemeToggle />
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent className="w-[17rem] gap-0 p-0" showCloseButton={false} side="left">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {mobileSidebar}
        </SheetContent>
      </Sheet>

      <main className={cn('min-w-0 transition-[padding] duration-200', sidebarCollapsed ? 'md:pl-14' : 'md:pl-[17rem]')}>
        <div className={cn('mx-auto w-full', isAgentConversation ? 'h-[calc(100svh-3.5rem)] md:h-svh' : 'max-w-6xl px-5 py-8 sm:px-8 lg:px-10')}>
          <Outlet />
        </div>
      </main>

      {context === 'workspace' && workspace && workspace.worker?.status !== 'connected' && <WorkspaceOfflineNotice workspace={workspace} />}
    </div>
  );
}

function Sidebar({
  collapsed = false,
  context,
  onNavigate,
  onToggleCollapsed,
  user,
  workspace,
  workspaces,
}: {
  collapsed?: boolean;
  context: AppContext;
  onNavigate: () => void;
  onToggleCollapsed?: () => void;
  user: Awaited<ReturnType<typeof getCurrentUser>> | undefined;
  workspace: Workspace | undefined;
  workspaces: Workspace[];
}) {
  const workspaceBase = `/w/${workspace?.id ?? ''}`;
  const navigation: NavigationItem[] = context === 'global'
    ? [
        ...(workspace ? [{ icon: ArrowLeft, label: 'Back to workspace', to: workspaceBase, end: true }] : []),
        { icon: Boxes, label: 'Workspaces', to: '/workspaces', end: true },
        { icon: UsersRound, label: 'Users', to: '/users', end: true },
        { icon: Bot, label: 'Service principals', to: '/service-principals', end: true },
        { icon: ShieldCheck, label: 'Access', to: '/access', end: true },
        { icon: ScrollText, label: 'Audit log', to: '/audit', end: true },
        { icon: Settings2, label: 'Settings', to: '/settings', end: true },
      ]
    : [
        { icon: LayoutDashboard, label: 'Home', to: workspaceBase, end: true },
        { icon: Target, label: 'Missions', to: `${workspaceBase}/missions` },
        { icon: Bot, label: 'Agents', to: `${workspaceBase}/agents` },
        { icon: Activity, label: 'Runs', to: `${workspaceBase}/runs` },
        { icon: Cable, label: 'Connections', to: `${workspaceBase}/connections` },
        { icon: Plug, label: 'Plugins', to: `${workspaceBase}/plugins` },
        { icon: FileCog, label: 'Config', to: `${workspaceBase}/config` },
        { icon: Settings2, label: 'Settings', to: `${workspaceBase}/settings` },
        { icon: ShieldCheck, label: 'Admin', to: '/settings' },
      ];

  return (
    <div className={cn('flex h-full min-h-0 flex-col', collapsed ? 'p-1' : 'p-3')}>
      <div className={cn('flex h-10 items-center', collapsed ? 'justify-center' : 'px-2')}>
        {!collapsed && <><Command className="mr-2 size-5 text-primary" /><span className="brand-label text-sm">SQUADRON</span></>}
        {onToggleCollapsed && <button aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} className={cn('grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground', !collapsed && 'ml-auto')} onClick={onToggleCollapsed} title={collapsed ? 'Expand navigation' : 'Collapse navigation'} type="button">{collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</button>}
      </div>

      <WorkspaceSwitcher collapsed={collapsed} onNavigate={onNavigate} workspace={workspace} workspaces={workspaces} />

      <nav className="mt-3 grid gap-0">
        {navigation.map((item) => (
          <NavLink
            aria-label={collapsed ? item.label : undefined}
            className={({ isActive }) => cn(
              'flex cursor-pointer items-center rounded-md py-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&>*]:pointer-events-none',
              collapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5',
              isActive && 'bg-accent text-accent-foreground',
            )}
            end={item.end}
            key={item.to}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            to={item.to}
          >
            <item.icon className="size-4" />
            {!collapsed && item.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto space-y-2 border-t pt-3">
        <div className={cn('flex rounded-md py-2', collapsed ? 'flex-col items-center gap-2 px-1' : 'items-center gap-3 px-2')}>
          <AccountMenu collapsed={collapsed} user={user} />
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

function AccountMenu({ collapsed, user }: { collapsed: boolean; user: Awaited<ReturnType<typeof getCurrentUser>> | undefined }) {
  const displayName = user?.name || user?.email || 'Command Center user';
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button aria-label={collapsed ? `Account menu for ${displayName}` : undefined} className={cn('flex min-w-0 items-center rounded-md text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', collapsed ? 'size-8 justify-center' : '-ml-1 flex-1 gap-3 px-1 py-1')} title={collapsed ? displayName : undefined} type="button">
        {collapsed && <span className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-background"><CircleUserRound className="size-4" /></span>}
        {!collapsed && <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{displayName}</span>{user?.name && <span className="block truncate text-xs text-muted-foreground">{user.email}</span>}</span>}
        {!collapsed && <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />}
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-60" side="top" sideOffset={6}>
      <DropdownMenuLabel className="min-w-0"><span className="block truncate text-xs font-medium">{displayName}</span>{user?.name && <span className="mt-0.5 block truncate text-[10px] font-normal text-muted-foreground">{user.email}</span>}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild><a href="/auth/logout"><LogOut />Log out</a></DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

function WorkspaceSwitcher({
  collapsed = false,
  onNavigate,
  workspace,
  workspaces,
}: {
  collapsed?: boolean;
  onNavigate: () => void;
  workspace: Workspace | undefined;
  workspaces: Workspace[];
}) {
  const navigate = useNavigate();

  function select(path: string) {
    navigate(path);
    onNavigate();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={collapsed ? `Switch workspace: ${workspace?.name ?? 'none selected'}` : undefined} className={cn('relative mt-1 h-10 text-[13px]', collapsed ? 'w-full justify-center px-0' : 'w-full justify-between px-2.5')} title={collapsed ? workspace?.name ?? 'Select workspace' : undefined} variant="outline">
          <span className="flex min-w-0 items-center gap-2">
            <Boxes className="size-4 shrink-0" />
            {!collapsed && <span className="truncate">{workspace?.name ?? 'Select workspace'}</span>}
          </span>
          {collapsed ? workspace && <span className="absolute bottom-1.5 right-1.5"><RunnerStatusDot workspace={workspace} /></span> : <span className="flex shrink-0 items-center gap-2">{workspace && <RunnerStatusDot workspace={workspace} />}<ChevronDown className="size-4 text-muted-foreground" /></span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[15.5rem]" sideOffset={6}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
        {workspaces.map((candidate) => (
          <DropdownMenuItem key={candidate.id} onSelect={() => select(`/w/${candidate.id}`)}>
            <Boxes />
            <span className="truncate">{candidate.name}</span>
          </DropdownMenuItem>
        ))}
        {workspaces.length === 0 && (
          <DropdownMenuItem disabled>No workspaces yet</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => select('/workspaces')}>
          <Command />
          Manage workspaces
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RunnerStatusDot({ workspace }: { workspace: Workspace }) {
  const status = workspace.worker?.status;
  const label = status === 'connected' ? 'Runner connected' : status === 'disconnected' ? 'Runner offline' : 'Runner not connected';
  return <span aria-label={label} className={cn('size-2 rounded-full', status === 'connected' ? 'bg-emerald-500' : status === 'disconnected' ? 'bg-destructive' : 'bg-amber-500')} role="status" title={label} />;
}

function WorkspaceOfflineNotice({ workspace }: { workspace: Workspace }) {
  const pending = workspace.worker?.status !== 'disconnected';
  return <aside aria-live="polite" className="fixed bottom-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm items-start gap-3 rounded-lg border bg-popover p-4 text-popover-foreground shadow-xl md:bottom-6 md:right-6" role="status">
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-amber-500/10"><WifiOff className="size-4 text-amber-700 dark:text-amber-300" /></span>
    <div className="min-w-0 flex-1"><p className="text-xs font-semibold">{pending ? 'Connect a workspace runner' : 'Workspace runner offline'}</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{pending ? 'A runner is required for live workspace features.' : lastSeenLabel(workspace)}</p><Button asChild className="mt-3 h-7 px-2.5 text-[10px]" variant="outline"><Link to={`/w/${workspace.id}/settings`}>View workspace<ChevronRight className="size-3" /></Link></Button></div>
  </aside>;
}

function lastSeenLabel(workspace: Workspace) {
  const timestamp = workspace.worker?.lastSeenAt;
  if (!timestamp) return 'Live workspace features are unavailable.';
  const elapsed = Date.now() - Date.parse(timestamp);
  if (!Number.isFinite(elapsed) || elapsed < 0) return 'Live workspace features are unavailable.';
  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `Last seen ${minutes}m ago.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen ${hours}h ago.`;
  return `Last seen ${Math.floor(hours / 24)}d ago.`;
}
