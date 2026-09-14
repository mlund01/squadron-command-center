import type { AdminAccess, AdminUser, AgentInfo, AgentConversationContext, AgentConversationState, AgentConversationSummary, AuditEvent, CommandCenterRole, ConfigSource, CostSummaryResponse, HumanInputsResponse, LocalPluginFile, LocalPluginFileContent, MissionEventsResponse, MissionHistoryResponse, MissionRunDetail, MissionRunIdentity, MissionSchedule, MissionTaskDetail, ModelProviderKind, ResolveHumanInputResponse, RunMissionResponse, ServicePrincipal, UserStatus, Workspace, WorkspaceConfigSnapshot, WorkspaceModelConnection, WorkspaceRole, WorkspaceVariable, WorkspaceWorker } from './types';

const BASE_URL = '/api';

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, init);

  if (response.status === 401) {
    const next = window.location.pathname + window.location.search;
    window.location.href = `/auth/login?next=${encodeURIComponent(next)}`;
    throw new Error('unauthorized');
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }

  if (response.status === 204) return undefined as T;

  return response.json() as Promise<T>;
}

export interface WorkerEnrollment {
  worker: WorkspaceWorker;
  credential: string;
  commandCenterURL: string;
}

export interface CurrentUser {
  email: string;
  name: string;
  sub: string;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const response = await fetch('/auth/me');
  if (!response.ok) {
    return null;
  }
  return response.json() as Promise<CurrentUser>;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const response = await fetchJSON<{ workspaces: Workspace[] }>('/workspaces');
  return response.workspaces;
}

export function listAdminUsers(): Promise<AdminUser[]> { return fetchJSON<{ users: AdminUser[] }>('/admin/users').then((value) => value.users); }
export function createAdminUser(input: { name: string; email: string; role: CommandCenterRole }): Promise<{ user: AdminUser; invitationToken: string }> { return fetchJSON('/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); }
export function updateAdminUser(id: string, input: { name: string; role: CommandCenterRole; status: UserStatus }): Promise<AdminUser> { return fetchJSON(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); }
export function listServicePrincipals(): Promise<ServicePrincipal[]> { return fetchJSON<{ servicePrincipals: ServicePrincipal[] }>('/admin/service-principals').then((value) => value.servicePrincipals); }
export function createServicePrincipal(input: { name: string; description: string }): Promise<{ servicePrincipal: ServicePrincipal; credential: string }> { return fetchJSON('/admin/service-principals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); }
export function updateServicePrincipalStatus(id: string, status: 'active' | 'disabled'): Promise<ServicePrincipal> { return fetchJSON(`/admin/service-principals/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); }
export function rotateServicePrincipalCredential(id: string): Promise<{ credential: string }> { return fetchJSON(`/admin/service-principals/${encodeURIComponent(id)}/rotate`, { method: 'POST' }); }
export function listAuditEvents(): Promise<AuditEvent[]> { return fetchJSON<{ events: AuditEvent[] }>('/admin/audit').then((value) => value.events); }
export function getAdminAccess(): Promise<AdminAccess> { return fetchJSON('/admin/access'); }
export function setWorkspaceUserAccess(workspaceId: string, userId: string, input: { role: WorkspaceRole; missions: string[] }): Promise<void> { return fetchJSON(`/admin/workspaces/${encodeURIComponent(workspaceId)}/users/${encodeURIComponent(userId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); }
export function setWorkspaceServicePrincipalAccess(workspaceId: string, servicePrincipalId: string, missions: string[], userIds: string[]): Promise<void> { return fetchJSON(`/admin/workspaces/${encodeURIComponent(workspaceId)}/service-principals/${encodeURIComponent(servicePrincipalId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ missions, userIds }) }); }
export function removeWorkspaceUserAccess(workspaceId:string,userId:string):Promise<void>{return fetchJSON(`/admin/workspaces/${encodeURIComponent(workspaceId)}/users/${encodeURIComponent(userId)}`,{method:'DELETE'})}
export function removeWorkspaceServicePrincipalAccess(workspaceId:string,servicePrincipalId:string):Promise<void>{return fetchJSON(`/admin/workspaces/${encodeURIComponent(workspaceId)}/service-principals/${encodeURIComponent(servicePrincipalId)}`,{method:'DELETE'})}

export function createWorkspace(name: string, repositoryUrl: string): Promise<Workspace> {
  return fetchJSON<Workspace>('/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, repositoryUrl }),
  });
}

export function provisionWorker(workspaceId: string): Promise<WorkerEnrollment> {
  return fetchJSON<WorkerEnrollment>(`/workspaces/${workspaceId}/worker-enrollment`, {
    method: 'POST',
  });
}

export function revealWorkerCredential(
  workspaceId: string,
): Promise<{ credential: string; commandCenterURL: string }> {
  return fetchJSON(`/workspaces/${workspaceId}/worker-credential`);
}

export function getWorkspaceConfig(workspaceId: string): Promise<WorkspaceConfigSnapshot> {
  return fetchJSON(`/workspaces/${workspaceId}/config`);
}

export function listWorkspaceVariables(workspaceId: string): Promise<WorkspaceVariable[]> {
  return fetchJSON<{ variables: WorkspaceVariable[] }>(`/workspaces/${encodeURIComponent(workspaceId)}/variables`).then((result) => result.variables);
}

export function createWorkspaceVariable(workspaceId: string, input: { name: string; value: string; secret: boolean }): Promise<void> {
  return fetchJSON(`/workspaces/${encodeURIComponent(workspaceId)}/variables`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}

export function updateWorkspaceVariable(workspaceId: string, name: string, input: { value: string; secret: boolean }): Promise<void> {
  return fetchJSON(`/workspaces/${encodeURIComponent(workspaceId)}/variables/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}

export function deleteWorkspaceVariable(workspaceId: string, name: string): Promise<void> {
  return fetchJSON(`/workspaces/${encodeURIComponent(workspaceId)}/variables/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export function revealWorkspaceVariable(workspaceId: string, name: string): Promise<{ value: string }> {
  return fetchJSON(`/workspaces/${encodeURIComponent(workspaceId)}/variables/${encodeURIComponent(name)}`);
}

export type WorkspaceModelConnectionInput = { name?: string; provider: ModelProviderKind; baseUrl: string; apiKey?: string; promptCaching: boolean };
export function listWorkspaceModelConnections(workspaceId: string): Promise<WorkspaceModelConnection[]> {
  return fetchJSON<{ connections: WorkspaceModelConnection[] }>(`/workspaces/${encodeURIComponent(workspaceId)}/model-connections`).then((result) => result.connections);
}
export function createWorkspaceModelConnection(workspaceId: string, input: WorkspaceModelConnectionInput): Promise<void> {
  return fetchJSON(`/workspaces/${encodeURIComponent(workspaceId)}/model-connections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}
export function updateWorkspaceModelConnection(workspaceId: string, name: string, input: WorkspaceModelConnectionInput): Promise<void> {
  return fetchJSON(`/workspaces/${encodeURIComponent(workspaceId)}/model-connections/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}
export function deleteWorkspaceModelConnection(workspaceId: string, name: string): Promise<void> {
  return fetchJSON(`/workspaces/${encodeURIComponent(workspaceId)}/model-connections/${encodeURIComponent(name)}`, { method: 'DELETE' });
}
export function revealWorkspaceModelConnectionKey(workspaceId: string, name: string): Promise<{ value: string }> {
  return fetchJSON(`/workspaces/${encodeURIComponent(workspaceId)}/model-connections/${encodeURIComponent(name)}/credential`);
}

export function getMissionDefinition(workspaceId: string, missionName: string): Promise<{ name: string; source?: ConfigSource | null }> {
  return fetchJSON(`/workspaces/${encodeURIComponent(workspaceId)}/missions/${encodeURIComponent(missionName)}/definition`);
}

function localPluginFilesPath(workspaceId: string, pluginName: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/plugins/${encodeURIComponent(pluginName)}/files`;
}

export function listLocalPluginFiles(workspaceId: string, pluginName: string): Promise<LocalPluginFile[]> {
  return fetchJSON<{ files: LocalPluginFile[] }>(localPluginFilesPath(workspaceId, pluginName)).then((result) => result.files);
}

export function getLocalPluginFile(workspaceId: string, pluginName: string, path: string): Promise<LocalPluginFileContent> {
  const query = new URLSearchParams({ path });
  return fetchJSON(`${localPluginFilesPath(workspaceId, pluginName)}?${query}`);
}

export function getMissionHistory(instanceId: string, limit = 500): Promise<MissionHistoryResponse> {
  return fetchJSON(`/instances/${instanceId}/history?limit=${limit}`);
}

export function listMissionRunIdentities(instanceId: string, missionName: string): Promise<MissionRunIdentity[]> {
  return fetchJSON<{ identities: MissionRunIdentity[] }>(`/instances/${encodeURIComponent(instanceId)}/missions/${encodeURIComponent(missionName)}/run-identities`).then((value) => value.identities);
}

export function runMission(instanceId: string, missionName: string, inputs: Record<string, string>, servicePrincipalId?: string): Promise<RunMissionResponse> {
  return fetchJSON(`/instances/${encodeURIComponent(instanceId)}/missions/${encodeURIComponent(missionName)}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs, servicePrincipalId }),
  });
}

export interface MissionScheduleInput {
  name: string;
  cronExpression: string;
  timezone: string;
  inputs: Record<string, string>;
  runAsKind: 'user' | 'service_principal';
  runAsId: string;
  status: 'active' | 'paused';
}

function missionSchedulesPath(workspaceId: string, missionName: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/missions/${encodeURIComponent(missionName)}/schedules`;
}

export function listMissionSchedules(workspaceId: string, missionName: string): Promise<MissionSchedule[]> {
  return fetchJSON<{ schedules: MissionSchedule[] }>(missionSchedulesPath(workspaceId, missionName)).then((value) => value.schedules);
}

export function listWorkspaceMissionSchedules(workspaceId: string): Promise<MissionSchedule[]> {
  return fetchJSON<{ schedules: MissionSchedule[] }>(`/workspaces/${encodeURIComponent(workspaceId)}/schedules`).then((value) => value.schedules);
}

export function createMissionSchedule(workspaceId: string, missionName: string, input: MissionScheduleInput): Promise<MissionSchedule> {
  return fetchJSON(missionSchedulesPath(workspaceId, missionName), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}

export function updateMissionSchedule(workspaceId: string, missionName: string, scheduleId: string, input: MissionScheduleInput): Promise<MissionSchedule> {
  return fetchJSON(`${missionSchedulesPath(workspaceId, missionName)}/${encodeURIComponent(scheduleId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}

export function deleteMissionSchedule(workspaceId: string, missionName: string, scheduleId: string): Promise<void> {
  return fetchJSON(`${missionSchedulesPath(workspaceId, missionName)}/${encodeURIComponent(scheduleId)}`, { method: 'DELETE' });
}

export function stopMission(instanceId: string, missionId: string): Promise<{ status: string }> {
  return fetchJSON(`/instances/${encodeURIComponent(instanceId)}/missions/${encodeURIComponent(missionId)}/stop`, { method: 'POST' });
}

export function listHumanInputs(instanceId: string, missionId: string, state: 'open' | 'resolved' = 'open'): Promise<HumanInputsResponse> {
  const query = new URLSearchParams({ missionId, state, order: 'oldest', limit: '100' });
  return fetchJSON(`/instances/${encodeURIComponent(instanceId)}/human-inputs?${query}`);
}

export function resolveHumanInput(instanceId: string, toolCallId: string, response: string): Promise<ResolveHumanInputResponse> {
  return fetchJSON(`/instances/${encodeURIComponent(instanceId)}/human-inputs/${encodeURIComponent(toolCallId)}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response }),
  });
}

export function getMissionRun(instanceId: string, runId: string): Promise<MissionRunDetail> {
  return fetchJSON(`/instances/${encodeURIComponent(instanceId)}/missions/${encodeURIComponent(runId)}/detail`);
}

export function getMissionRunEvents(instanceId: string, runId: string): Promise<MissionEventsResponse> {
  return fetchJSON(`/instances/${encodeURIComponent(instanceId)}/missions/${encodeURIComponent(runId)}/history-events`);
}

export function getMissionTaskDetail(instanceId: string, taskId: string): Promise<MissionTaskDetail> {
  return fetchJSON(`/instances/${encodeURIComponent(instanceId)}/tasks/${encodeURIComponent(taskId)}/detail`);
}

export function getCostSummary(instanceId: string, groupBy = 'model'): Promise<CostSummaryResponse> {
  const query = new URLSearchParams({ groupBy });
  return fetchJSON(`/instances/${encodeURIComponent(instanceId)}/costs?${query}`);
}

function agentApiPath(workspaceId: string, name: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(name)}`;
}

export function getAgentDefinition(workspaceId: string, name: string, mission?: string): Promise<AgentInfo> {
  const query = new URLSearchParams(mission ? { mission } : {});
  return fetchJSON(`${agentApiPath(workspaceId, name)}/definition?${query}`);
}

export function sendAgentConversation(workspaceId: string, name: string, context: AgentConversationContext, content: string, sessionId?: string): Promise<AgentConversationState> {
  return fetchJSON(`${agentApiPath(workspaceId, name)}/conversations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...context, content, sessionId }),
  });
}

export function listAgentConversations(workspaceId: string, name: string, context: AgentConversationContext): Promise<AgentConversationSummary[]> {
  const query = new URLSearchParams({ purpose: context.purpose, mode: context.mode });
  if (context.mission) query.set('mission', context.mission);
  return fetchJSON<{ conversations: AgentConversationSummary[] }>(agentApiPath(workspaceId, name) + '/conversations?' + query).then((result) => result.conversations);
}

export function getAgentConversation(workspaceId: string, name: string, context: AgentConversationContext, sessionId: string): Promise<AgentConversationState> {
  const query = new URLSearchParams({ purpose: context.purpose, mode: context.mode });
  if (context.mission) query.set('mission', context.mission);
  return fetchJSON(`${agentApiPath(workspaceId, name)}/conversations/${encodeURIComponent(sessionId)}?${query}`);
}

export function stopAgentConversation(workspaceId: string, name: string, context: AgentConversationContext, sessionId: string): Promise<AgentConversationState> {
  return fetchJSON(`${agentApiPath(workspaceId, name)}/conversations/${encodeURIComponent(sessionId)}/stop`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(context),
  });
}
