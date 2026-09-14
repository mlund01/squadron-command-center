import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Check,
  ChevronDown,
  CircleUserRound,
  MoreHorizontal,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import {
  getAdminAccess,
  getWorkspaceConfig,
  listAdminUsers,
  listServicePrincipals,
  listWorkspaces,
  removeWorkspaceServicePrincipalAccess,
  removeWorkspaceUserAccess,
  setWorkspaceServicePrincipalAccess,
  setWorkspaceUserAccess,
} from '@/api/client';
import type {
  AdminUser,
  ServicePrincipal,
  WorkspaceRole,
  WorkspaceServicePrincipalGrant,
  WorkspaceUserGrant,
} from '@/api/types';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Selection =
  | { kind: 'user'; value: AdminUser }
  | { kind: 'servicePrincipal'; value: ServicePrincipal };

type AccessRow = {
  selection: Selection;
  grant: WorkspaceUserGrant | WorkspaceServicePrincipalGrant;
};

const roles: WorkspaceRole[] = ['reader', 'developer', 'manager', 'admin'];

export function AccessPage() {
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: listWorkspaces });
  const users = useQuery({ queryKey: ['admin-users'], queryFn: listAdminUsers });
  const principals = useQuery({ queryKey: ['service-principals'], queryFn: listServicePrincipals });
  const access = useQuery({ queryKey: ['admin-access'], queryFn: getAdminAccess });
  const [workspaceId, setWorkspaceId] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const selectedWorkspace = workspaces.data?.find(
    (workspace) => workspace.id === (workspaceId || workspaces.data?.[0]?.id),
  );
  const activeId = selectedWorkspace?.id ?? '';
  const config = useQuery({
    queryKey: ['workspace-config', activeId],
    queryFn: () => getWorkspaceConfig(activeId),
    enabled: Boolean(activeId),
    retry: false,
  });
  const missions = useMemo(
    () => config.data?.config.missions.map((mission) => mission.name).sort() ?? [],
    [config.data],
  );

  const rows = useMemo<AccessRow[]>(() => {
    if (!access.data) return [];
    const userById = new Map(users.data?.map((user) => [user.id, user]));
    const principalById = new Map(principals.data?.map((principal) => [principal.id, principal]));
    const userRows: AccessRow[] = access.data.users
      .filter((grant) => grant.workspaceId === activeId)
      .flatMap((grant) => {
        const user = userById.get(grant.userId);
        return user ? [{ selection: { kind: 'user' as const, value: user }, grant }] : [];
      });
    const principalRows: AccessRow[] = access.data.servicePrincipals
      .filter((grant) => grant.workspaceId === activeId)
      .flatMap((grant) => {
        const principal = principalById.get(grant.servicePrincipalId);
        return principal
          ? [{ selection: { kind: 'servicePrincipal' as const, value: principal }, grant }]
          : [];
      });
    return [...userRows, ...principalRows].sort((a, b) =>
      a.selection.value.name.localeCompare(b.selection.value.name),
    );
  }, [access.data, activeId, principals.data, users.data]);

  const assignedUsers = new Set(
    access.data?.users.filter((grant) => grant.workspaceId === activeId).map((grant) => grant.userId),
  );
  const assignedPrincipals = new Set(
    access.data?.servicePrincipals
      .filter((grant) => grant.workspaceId === activeId)
      .map((grant) => grant.servicePrincipalId),
  );
  const available: Selection[] = [
    ...(users.data ?? [])
      .filter(
        (user) =>
          (user.status === 'active' || user.status === 'invited') && !assignedUsers.has(user.id),
      )
      .map((value) => ({ kind: 'user' as const, value })),
    ...(principals.data ?? [])
      .filter((principal) => principal.status === 'active' && !assignedPrincipals.has(principal.id))
      .map((value) => ({ kind: 'servicePrincipal' as const, value })),
  ].sort((a, b) => a.value.name.localeCompare(b.value.name));

  const isLoading = workspaces.isLoading || users.isLoading || principals.isLoading || access.isLoading;
  const isError = workspaces.isError || users.isError || principals.isError || access.isError;

  return (
    <div>
      <PageHeader
        actions={
          <Button disabled={!activeId} onClick={() => setPickerOpen(true)} size="sm">
            <Plus />
            Add access
          </Button>
        }
        description="Manage the people and service principals that can access each workspace."
        eyebrow="Command Center"
        title="Access"
      />

      <div className="mb-5 flex items-center justify-between gap-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="min-w-64 justify-between" variant="outline">
              <span className="truncate">{selectedWorkspace?.name ?? 'Select workspace'}</span>
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-64">
            {workspaces.data?.map((workspace) => (
              <DropdownMenuItem key={workspace.id} onSelect={() => setWorkspaceId(workspace.id)}>
                {workspace.name}
                {workspace.id === activeId && <Check className="ml-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <p className="text-[11px] text-muted-foreground">{missions.length} configured missions</p>
      </div>

      <section className="overflow-hidden rounded-md border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Workspace access</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Managers and Admins can run every mission. Other identities require explicit mission grants.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-muted/35 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Principal</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Mission access</th>
                <th className="w-12 px-3 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const userGrant = row.selection.kind === 'user' ? row.grant as WorkspaceUserGrant : null;
                const implicit = userGrant?.role === 'manager' || userGrant?.role === 'admin';
                return (
                  <tr
                    className="cursor-pointer transition-colors hover:bg-accent/35"
                    key={`${row.selection.kind}:${row.selection.value.id}`}
                    onClick={() => setSelection(row.selection)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-background">
                          {row.selection.kind === 'user' ? (
                            <CircleUserRound className="size-4" />
                          ) : (
                            <Bot className="size-4" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{row.selection.value.name}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {row.selection.kind === 'user'
                              ? row.selection.value.email
                              : row.selection.value.description || 'Automation identity'}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.selection.kind === 'user' ? 'User' : 'Service principal'}
                    </td>
                    <td className="px-4 py-3">
                      {userGrant ? capitalize(userGrant.role) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {implicit ? 'All missions' : formatMissionCount(row.grant.missions.length)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Button
                        aria-label={`Edit access for ${row.selection.value.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelection(row.selection);
                        }}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <MoreHorizontal />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {isLoading && (
                <tr><td className="px-4 py-10 text-center text-muted-foreground" colSpan={5}>Loading access…</td></tr>
              )}
              {!isLoading && isError && (
                <tr><td className="px-4 py-10 text-center text-destructive" colSpan={5}>Unable to load workspace access.</td></tr>
              )}
              {!isLoading && !isError && rows.length === 0 && (
                <tr>
                  <td className="px-4 py-10 text-center" colSpan={5}>
                    <p className="font-medium">No one has access to this workspace</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">Add a user or service principal to get started.</p>
                    <Button className="mt-4" onClick={() => setPickerOpen(true)} size="sm" variant="outline">
                      <Plus />
                      Add access
                    </Button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {pickerOpen && (
        <PrincipalPickerDialog
          available={available}
          onClose={() => setPickerOpen(false)}
          onSelect={(nextSelection) => {
            setPickerOpen(false);
            setSelection(nextSelection);
          }}
          workspaceName={selectedWorkspace?.name ?? ''}
        />
      )}
      {selection && (
        <AccessDialog
          existing={
            selection.kind === 'user'
              ? access.data?.users.find(
                  (grant) => grant.workspaceId === activeId && grant.userId === selection.value.id,
                )
              : access.data?.servicePrincipals.find(
                  (grant) =>
                    grant.workspaceId === activeId && grant.servicePrincipalId === selection.value.id,
                )
          }
          key={`${selection.kind}:${selection.value.id}:${activeId}`}
          missions={missions}
          onClose={() => setSelection(null)}
          selection={selection}
          workspaceId={activeId}
          workspaceName={selectedWorkspace?.name ?? ''}
          workspaceUsers={(access.data?.users ?? []).filter((grant) => grant.workspaceId === activeId).flatMap((grant) => {
            const user = users.data?.find((candidate) => candidate.id === grant.userId);
            return user?.status === 'active' ? [user] : [];
          })}
        />
      )}
    </div>
  );
}

function PrincipalPickerDialog({
  available,
  workspaceName,
  onSelect,
  onClose,
}: {
  available: Selection[];
  workspaceName: string;
  onSelect: (selection: Selection) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add access</DialogTitle>
          <DialogDescription>Choose a principal to add to {workspaceName}.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[55svh] overflow-y-auto rounded-md border">
          {available.map((selection) => (
            <button
              className="flex w-full items-center gap-3 border-b px-3 py-3 text-left last:border-b-0 hover:bg-accent/40"
              key={`${selection.kind}:${selection.value.id}`}
              onClick={() => onSelect(selection)}
              type="button"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-md border">
                {selection.kind === 'user' ? <CircleUserRound className="size-4" /> : <Bot className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{selection.value.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {selection.kind === 'user' ? selection.value.email : selection.value.description || 'Automation identity'}
                </span>
              </span>
              <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                {selection.kind === 'user' ? 'User' : 'Service principal'}
              </span>
            </button>
          ))}
          {available.length === 0 && (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">
              Every available user and service principal already has access.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AccessDialog({
  selection,
  workspaceId,
  workspaceName,
  missions,
  existing,
  onClose,
  workspaceUsers,
}: {
  selection: Selection;
  workspaceId: string;
  workspaceName: string;
  missions: string[];
  existing: { role?: WorkspaceRole; missions: string[]; userIds?: string[] } | undefined;
  onClose: () => void;
  workspaceUsers: AdminUser[];
}) {
  const client = useQueryClient();
  const [role, setRole] = useState<WorkspaceRole>(existing?.role ?? 'reader');
  const [selected, setSelected] = useState<string[]>(existing?.missions ?? []);
  const [runAsUsers, setRunAsUsers] = useState<string[]>(selection.kind === 'servicePrincipal' ? (existing as WorkspaceServicePrincipalGrant | undefined)?.userIds ?? [] : []);
  const implicit = selection.kind === 'user' && (role === 'manager' || role === 'admin');
  const finish = () => {
    client.invalidateQueries({ queryKey: ['admin-access'] });
    client.invalidateQueries({ queryKey: ['workspaces'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () =>
      selection.kind === 'user'
        ? setWorkspaceUserAccess(workspaceId, selection.value.id, {
            role,
            missions: implicit ? [] : selected,
          })
        : setWorkspaceServicePrincipalAccess(workspaceId, selection.value.id, selected, runAsUsers),
    onSuccess: finish,
  });
  const remove = useMutation({
    mutationFn: () =>
      selection.kind === 'user'
        ? removeWorkspaceUserAccess(workspaceId, selection.value.id)
        : removeWorkspaceServicePrincipalAccess(workspaceId, selection.value.id),
    onSuccess: finish,
  });
  const mutationError = save.error ?? remove.error;

  function toggle(mission: string) {
    setSelected((value) =>
      value.includes(mission) ? value.filter((item) => item !== mission) : [...value, mission],
    );
  }

  function toggleRunAsUser(userId: string) {
    setRunAsUsers((value) => value.includes(userId) ? value.filter((item) => item !== userId) : [...value, userId]);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[85svh] flex-col gap-0 overflow-hidden">
        <DialogHeader className="shrink-0 pb-4">
          <DialogTitle>{selection.value.name}</DialogTitle>
          <DialogDescription>Access to {workspaceName}</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-4">
          {selection.kind === 'user' && (
            <div>
              <p className="mb-2 text-xs font-medium">Workspace role</p>
              <div className="grid grid-cols-2 gap-2">
                {roles.map((value) => (
                  <button
                    className={`rounded-md border px-3 py-2 text-left text-xs capitalize ${role === value ? 'border-primary bg-accent' : ''}`}
                    key={value}
                    onClick={() => setRole(value)}
                    type="button"
                  >
                    {value}
                    {role === value && <Check className="ml-2 inline size-3" />}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-xs font-medium">Mission execution</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {implicit
                ? 'This role can run every mission.'
                : missions.length
                  ? 'Choose each mission this principal may run.'
                  : 'No missions were reported by the workspace runner.'}
            </p>
            {!implicit && (
              <div className="mt-3 divide-y rounded-md border">
                {missions.map((mission) => (
                  <label className="flex items-center gap-3 px-3 py-2.5 text-xs" key={mission}>
                    <input
                      checked={selected.includes(mission)}
                      onChange={() => toggle(mission)}
                      type="checkbox"
                    />
                    <span className="font-mono">{mission}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          {selection.kind === 'servicePrincipal' && (
            <div>
              <p className="text-xs font-medium">Run-as access</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Choose the workspace users who may execute missions as this service principal.</p>
              <div className="mt-3 divide-y rounded-md border">
                {workspaceUsers.map((user) => (
                  <label className="flex items-center gap-3 px-3 py-2.5 text-xs" key={user.id}>
                    <input checked={runAsUsers.includes(user.id)} onChange={() => toggleRunAsUser(user.id)} type="checkbox" />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{user.name}</span><span className="block truncate text-[10px] text-muted-foreground">{user.email}</span></span>
                  </label>
                ))}
                {workspaceUsers.length === 0 && <p className="px-3 py-5 text-center text-[11px] text-muted-foreground">No active users have workspace access.</p>}
              </div>
            </div>
          )}
          {(save.isError || remove.isError) && (
            <p className="text-xs text-destructive">
              {mutationError instanceof Error ? mutationError.message : 'Unable to save access.'}
            </p>
          )}
        </div>
        <div className="-mx-6 -mb-6 flex shrink-0 gap-2 border-t bg-background px-6 py-4">
          {existing && (
            <Button
              className="flex-1"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              variant="outline"
            >
              Remove access
            </Button>
          )}
          <Button
            className="flex-1"
            disabled={!workspaceId || save.isPending}
            onClick={() => save.mutate()}
          >
            <ShieldCheck />
            {save.isPending ? 'Saving…' : 'Save access'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatMissionCount(count: number) {
  return `${count} ${count === 1 ? 'mission' : 'missions'}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
