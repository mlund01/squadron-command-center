import type { InstanceState, InstanceConfig, MissionHistoryResponse, RunMissionResponse, ChatMessageResponse, ChatHistoryResponse, ChatMessagesResponse, ReloadConfigResponse, GetMissionDetailResponse, GetMissionEventsResponse, TaskDetailResponse, GetDatasetsResponse, GetDatasetItemsResponse, ListConfigFilesResponse, GetConfigFileResponse, WriteConfigFileResponse, ValidateConfigResponse, ListSharedFoldersResponse, BrowseDirectoryResponse, ReadBrowseFileResponse, WriteBrowseFileResponse, GetVariablesResponse } from './types';

const BASE_URL = '/api';

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, init);
  if (res.status === 401) {
    // Session missing or expired. Full-page redirect so the backend's /auth/login
    // handler can run (it builds the IdP URL and sets the pending-state cookie).
    const next = window.location.pathname + window.location.search;
    window.location.href = '/auth/login?next=' + encodeURIComponent(next);
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface CurrentUser {
  email: string;
  name: string;
  sub: string;
}

// getCurrentUser returns the logged-in user, or null when auth is disabled
// (endpoint 404s) or the session is missing/invalid (401). Does not redirect.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const res = await fetch('/auth/me');
    if (!res.ok) return null;
    return (await res.json()) as CurrentUser;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  // /auth/logout is a GET on the backend — it clears the session cookie and
  // redirects through the IdP's end-session endpoint back to /.
  window.location.href = '/auth/logout';
}

export async function getServerInfo(): Promise<{ baseUrl: string }> {
  return fetchJSON<{ baseUrl: string }>('/info');
}

export async function listInstances(): Promise<InstanceState[]> {
  return fetchJSON<InstanceState[]>('/instances');
}

export async function getInstance(id: string): Promise<InstanceState> {
  return fetchJSON<InstanceState>(`/instances/${id}`);
}

export async function getInstanceConfig(id: string): Promise<InstanceConfig> {
  return fetchJSON<InstanceConfig>(`/instances/${id}/config`);
}

export async function runMission(instanceId: string, missionName: string, inputs: Record<string, string>): Promise<RunMissionResponse> {
  return fetchJSON<RunMissionResponse>(`/instances/${instanceId}/missions/${missionName}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs }),
  });
}

export async function stopMission(instanceId: string, missionId: string): Promise<{ status: string }> {
  return fetchJSON<{ status: string }>(`/instances/${instanceId}/missions/${missionId}/stop`, {
    method: 'POST',
  });
}

export async function resumeMission(instanceId: string, missionId: string, missionName: string): Promise<{ missionId: string; status: string }> {
  return fetchJSON<{ missionId: string; status: string }>(`/instances/${instanceId}/missions/${missionId}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ missionName }),
  });
}

export async function getMissionHistory(instanceId: string): Promise<MissionHistoryResponse> {
  return fetchJSON<MissionHistoryResponse>(`/instances/${instanceId}/history`);
}

export async function sendChatMessage(instanceId: string, agentName: string, message: string, sessionId?: string): Promise<ChatMessageResponse> {
  return fetchJSON<ChatMessageResponse>(`/instances/${instanceId}/agents/${agentName}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message }),
  });
}

export async function getChatHistory(instanceId: string, agentName: string): Promise<ChatHistoryResponse> {
  return fetchJSON<ChatHistoryResponse>(`/instances/${instanceId}/agents/${agentName}/chats`);
}

export async function getChatMessages(instanceId: string, sessionId: string): Promise<ChatMessagesResponse> {
  return fetchJSON<ChatMessagesResponse>(`/instances/${instanceId}/chats/${sessionId}/messages`);
}

export async function archiveChat(instanceId: string, sessionId: string): Promise<void> {
  await fetchJSON(`/instances/${instanceId}/chats/${sessionId}`, { method: 'DELETE' });
}

export async function reloadConfig(instanceId: string): Promise<ReloadConfigResponse> {
  return fetchJSON<ReloadConfigResponse>(`/instances/${instanceId}/reload`, { method: 'POST' });
}

export async function getMissionDetail(instanceId: string, missionId: string): Promise<GetMissionDetailResponse> {
  return fetchJSON<GetMissionDetailResponse>(`/instances/${instanceId}/missions/${missionId}/detail`);
}

export async function getMissionEvents(instanceId: string, missionId: string): Promise<GetMissionEventsResponse> {
  return fetchJSON<GetMissionEventsResponse>(`/instances/${instanceId}/missions/${missionId}/history-events`);
}

export async function getTaskDetail(instanceId: string, taskId: string): Promise<TaskDetailResponse> {
  return fetchJSON<TaskDetailResponse>(`/instances/${instanceId}/tasks/${taskId}/detail`);
}

export async function getRunDatasets(instanceId: string, missionId: string): Promise<GetDatasetsResponse> {
  return fetchJSON<GetDatasetsResponse>(`/instances/${instanceId}/missions/${missionId}/datasets`);
}

export async function getDatasetItems(instanceId: string, datasetId: string, offset = 0, limit = 50): Promise<GetDatasetItemsResponse> {
  return fetchJSON<GetDatasetItemsResponse>(`/instances/${instanceId}/datasets/${datasetId}/items?offset=${offset}&limit=${limit}`);
}

export async function listConfigFiles(instanceId: string): Promise<ListConfigFilesResponse> {
  return fetchJSON<ListConfigFilesResponse>(`/instances/${instanceId}/config/files`);
}

export async function getConfigFile(instanceId: string, name: string): Promise<GetConfigFileResponse> {
  return fetchJSON<GetConfigFileResponse>(`/instances/${instanceId}/config/files/${name}`);
}

export async function writeConfigFile(instanceId: string, name: string, content: string): Promise<WriteConfigFileResponse> {
  return fetchJSON<WriteConfigFileResponse>(`/instances/${instanceId}/config/files/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

export async function validateConfig(instanceId: string, files: Record<string, string>): Promise<ValidateConfigResponse> {
  return fetchJSON<ValidateConfigResponse>(`/instances/${instanceId}/config/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
}

// Variables API

export async function getVariables(instanceId: string): Promise<GetVariablesResponse> {
  return fetchJSON<GetVariablesResponse>(`/instances/${instanceId}/variables`);
}

export async function setVariable(instanceId: string, name: string, value: string): Promise<void> {
  await fetchJSON(`/instances/${instanceId}/variables/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
}

export async function deleteVariable(instanceId: string, name: string): Promise<void> {
  await fetchJSON(`/instances/${instanceId}/variables/${name}`, { method: 'DELETE' });
}

// Shared folder API

export async function listSharedFolders(instanceId: string): Promise<ListSharedFoldersResponse> {
  return fetchJSON<ListSharedFoldersResponse>(`/instances/${instanceId}/browsers`);
}

export async function browseDirectory(instanceId: string, browser: string, relPath: string): Promise<BrowseDirectoryResponse> {
  return fetchJSON<BrowseDirectoryResponse>(`/instances/${instanceId}/browsers/${browser}/browse?path=${encodeURIComponent(relPath)}`);
}

export async function readBrowseFile(instanceId: string, browser: string, relPath: string): Promise<ReadBrowseFileResponse> {
  return fetchJSON<ReadBrowseFileResponse>(`/instances/${instanceId}/browsers/${browser}/read?path=${encodeURIComponent(relPath)}`);
}

export async function writeBrowseFile(instanceId: string, browser: string, relPath: string, content: string): Promise<WriteBrowseFileResponse> {
  return fetchJSON<WriteBrowseFileResponse>(`/instances/${instanceId}/browsers/${browser}/write?path=${encodeURIComponent(relPath)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

export function getDownloadFileUrl(instanceId: string, browser: string, relPath: string): string {
  return `${BASE_URL}/instances/${instanceId}/browsers/${browser}/download?path=${encodeURIComponent(relPath)}`;
}

export function getDownloadDirUrl(instanceId: string, browser: string, relPath: string): string {
  return `${BASE_URL}/instances/${instanceId}/browsers/${browser}/download-dir?path=${encodeURIComponent(relPath)}`;
}

export interface CostSummaryResponse {
  totals: {
    totalCost: number;
    inputCost: number;
    outputCost: number;
    cacheReadCost: number;
    cacheWriteCost: number;
    totalTurns: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  byGroup: Array<{
    groupKey: string;
    turns: number;
    totalCost: number;
    inputCost: number;
    outputCost: number;
    cacheReadCost: number;
    cacheWriteCost: number;
  }>;
  byDateAndField?: Array<{
    date: string;
    fieldKey: string;
    totalCost: number;
  }>;
  recentMissions: Array<{
    missionId: string;
    missionName: string;
    status: string;
    turns: number;
    totalCost: number;
    startedAt: string;
  }>;
}

// startMcpOauth asks commander to ask the squadron to kick off an OAuth
// login for the named MCP server. Returns the authorization URL — the
// caller is expected to open it in a new tab. The IdP redirect will land
// on commander's /oauth/callback and complete the flow back over WS.
export async function startMcpOauth(instanceId: string, mcpName: string): Promise<{ authUrl: string }> {
  return fetchJSON<{ authUrl: string }>(`/instances/${instanceId}/mcp/${encodeURIComponent(mcpName)}/oauth/start`, {
    method: 'POST',
  });
}

export async function getCostSummary(instanceId: string, from?: string, to?: string, groupBy?: string, breakdownField?: string): Promise<CostSummaryResponse> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (groupBy) params.set('groupBy', groupBy);
  if (breakdownField) params.set('breakdownField', breakdownField);
  const qs = params.toString();
  return fetchJSON<CostSummaryResponse>(`/instances/${instanceId}/costs${qs ? '?' + qs : ''}`);
}
