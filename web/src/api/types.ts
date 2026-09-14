export interface Workspace {
  id: string;
  name: string;
  repositoryUrl?: string;
  defaultBranch: string;
  createdBy: string;
  createdAt: string;
  worker?: WorkspaceWorker;
}

export interface WorkspaceWorker {
  id: string;
  workspaceId: string;
  status: 'pending' | 'connected' | 'disconnected';
  createdAt: string;
  enrolledAt?: string;
  lastSeenAt?: string;
}

export type CommandCenterRole = 'admin' | 'member';
export type UserStatus = 'invited' | 'active' | 'suspended' | 'deactivated';
export type WorkspaceRole = 'reader' | 'developer' | 'manager' | 'admin';
export interface AdminUser { id: string; email: string; name: string; role: CommandCenterRole; status: UserStatus; createdAt: string; updatedAt: string }
export interface ServicePrincipal { id: string; name: string; description: string; status: 'active' | 'disabled'; createdBy: string; createdAt: string; updatedAt: string; lastUsedAt?: string }
export interface AuditEvent { id: string; actorId?: string; actorEmail?: string; eventType: string; data: Record<string, unknown>; createdAt: string }
export interface WorkspaceUserGrant { workspaceId: string; userId: string; role: WorkspaceRole; missions: string[] }
export interface WorkspaceServicePrincipalGrant { workspaceId: string; servicePrincipalId: string; missions: string[]; userIds: string[] }
export interface AdminAccess { users: WorkspaceUserGrant[]; servicePrincipals: WorkspaceServicePrincipalGrant[] }

export interface WorkspaceConfigSnapshot {
  instanceId: string;
  connected: boolean;
  configReady: boolean;
  configError?: string;
  config: InstanceConfig;
}

export interface InstanceConfig {
  agents: AgentInfo[];
  missions: MissionInfo[];
  models?: ModelInfo[];
  skills?: SkillInfo[];
  plugins?: PluginInfo[];
  variables?: VariableInfo[];
  sharedFolders?: SharedFolderInfo[];
}

export interface ModelInfo { name: string; provider: string; model: string }
export interface SkillInfo { name: string; description?: string; instructions?: string; tools?: string[]; agent?: string }
export interface ToolInfo { name: string; description?: string; parameters?: { type: string; properties?: Record<string, unknown>; required?: string[] } }
export interface PluginInfo { name: string; path: string; version?: string; builtin?: boolean; kind?: 'builtin' | 'plugin' | 'mcp' | string; tools?: ToolInfo[] }
export interface LocalPluginFile { path: string; size: number }
export interface LocalPluginFileContent { pluginName: string; path: string; content: string; size: number }
export interface VariableInfo { name: string; secret: boolean }
export interface WorkspaceVariable {
  name: string;
  secret: boolean;
  hasValue: boolean;
  value: string;
  updatedAt?: string;
}
export type ModelProviderKind = 'anthropic' | 'openai' | 'gemini' | 'openai_compatible';
export interface WorkspaceModelConnection {
  name: string;
  provider: ModelProviderKind;
  baseUrl?: string;
  hasApiKey: boolean;
  promptCaching: boolean;
  updatedAt?: string;
}
export interface SharedFolderInfo { name: string; path: string; label: string; description?: string; editable: boolean; isShared: boolean; missions?: string[] }

export interface AgentInfo {
  name: string;
  description?: string;
  role?: string;
  model: string;
  tools?: string[];
  skills?: string[];
  mission?: string;
  reasoning?: string;
  pruning?: { PruneOn: number; PruneTo: number } | null;
  compaction?: { TokenLimit: number; TurnRetention: number } | null;
  toolResponse?: { MaxTokens: number } | null;
  localSkills?: Array<{ name: string; description: string }>;
  source?: ConfigSource | null;
  lineage?: { missions: Array<{ name: string }> };
}

export interface ConfigSource {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  fileRevision: string;
}

export type SessionMode = 'interactive' | 'task';
export interface AgentConversationContext {
  mission?: string;
  purpose: 'authoring' | 'session';
  mode: SessionMode;
}
export interface AgentConversationState {
  sessionId: string;
  running: boolean;
  partialAnswer?: string;
  error?: string;
  messages?: Array<{ id: number; role: string; content: string; createdAt: string }>;
}
export interface AgentConversationSummary {
  sessionId: string;
  startedAt: string;
  mode: SessionMode;
}

export interface MissionInfo {
  name: string;
  description?: string;
  source?: ConfigSource | null;
  commander?: string;
  agents?: string[];
  inputs?: MissionInputInfo[];
  datasets?: DatasetInfo[];
  tasks?: TaskInfo[];
  schedules?: ScheduleInfo[];
  trigger?: TriggerInfo;
  maxParallel?: number;
}

export interface MissionInputInfo {
  name: string;
  description?: string;
  type?: string;
  required: boolean;
  protected?: boolean;
  items?: MissionInputInfo;
  properties?: MissionInputInfo[];
}

export interface DatasetInfo { name: string; description?: string; bindTo?: string; schema?: Array<{ name: string; type: string; required?: boolean }> }
export interface TriggerInfo { type: string; webhookPath?: string; hasSecret?: boolean }

export interface TaskInfo {
  name: string;
  description?: string;
  objective?: string;
  agent?: string;
  commander?: string;
  dependsOn?: string[];
  sendTo?: string[];
  iterator?: {
    dataset: string;
    parallel: boolean;
    maxRetries?: number;
    concurrencyLimit?: number;
  };
  router?: { routes: Array<{ target: string; condition?: string; isMission?: boolean }> };
}

export interface ScheduleInfo {
  expression: string;
  at?: string[];
  every?: string;
  weekdays?: string[];
  timezone?: string;
}

export interface MissionRun {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | string;
  inputsJson?: string;
  configJson?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface MissionHistoryResponse {
  missions: MissionRun[];
  total: number;
}

export interface RunMissionResponse {
  missionId: string;
  status: string;
}
export interface MissionRunIdentity { kind: 'user' | 'service_principal'; id: string; name: string }
export interface MissionSchedule {
  id: string;
  workspaceId: string;
  missionName: string;
  name: string;
  cronExpression: string;
  timezone: string;
  inputs: Record<string, string>;
  runAsUserId?: string;
  runAsServicePrincipalId?: string;
  status: 'active' | 'paused';
  nextRunAt: string;
  lastRunAt?: string;
  lastRunStatus?: 'started' | 'failed' | 'skipped';
  lastError?: string;
}

export interface HumanInputRequest {
  id: string;
  missionId?: string;
  missionName?: string;
  taskId?: string;
  taskName?: string;
  toolCallId: string;
  question: string;
  shortSummary?: string;
  additionalContext?: string;
  choices?: string[];
  multiSelect?: boolean;
  state: 'open' | 'resolved';
  requestedAt: string;
  resolvedAt?: string;
  response?: string;
  responderUserId?: string;
}

export interface HumanInputsResponse {
  humanInputs: HumanInputRequest[];
  total: number;
}

export interface ResolveHumanInputResponse {
  humanInput: HumanInputRequest;
}

export interface MissionTaskRun {
  id: string;
  missionId: string;
  taskName: string;
  status: string;
  configJson?: string;
  startedAt?: string;
  finishedAt?: string;
  outputJson?: string;
  summary?: string;
  error?: string;
}

export interface MissionRunDetail { mission: MissionRun; tasks: MissionTaskRun[] }
export interface MissionTaskDetail {
  task: MissionTaskRun;
  outputs: Array<{ id: string; taskId: string; datasetName?: string; datasetIndex?: number; itemId?: string; outputJson: string; createdAt: string }>;
  sessions: Array<{ id: string; taskId: string; role: string; agentName?: string; model?: string; status: string; startedAt: string; finishedAt?: string; iterationIndex?: number }>;
  toolResults: Array<{ id: string; sessionId: string; toolCallId?: string; toolName: string; inputParams?: string; output?: string; media?: Array<{ kind: string; mediaType: string; data: string; filename?: string }>; startedAt: string; finishedAt: string }>;
  subtasks: Array<{ index: number; title: string; status: string; sessionId: string; iterationIndex?: number; completedAt?: string }>;
  inputs: Array<{ iterationIndex?: number; objective: string }>;
  datasetItems?: Array<{ index: number; itemJson: string }>;
}
export interface MissionEventRecord {
  id: string;
  missionId: string;
  taskId?: string;
  sessionId?: string;
  iterationIndex?: number;
  eventType: string;
  dataJson: string;
  createdAt: string;
}
export interface MissionEventsResponse { events: MissionEventRecord[] }
export interface CostSummaryResponse {
  totals: { totalCost: number; inputCost: number; outputCost: number; cacheReadCost: number; cacheWriteCost: number; totalTurns: number; totalInputTokens: number; totalOutputTokens: number };
  byGroup: Array<{ groupKey: string; turns: number; totalCost: number; inputCost: number; outputCost: number; cacheReadCost: number; cacheWriteCost: number }>;
  recentMissions: Array<{ missionId: string; missionName: string; status: string; turns: number; totalCost: number; startedAt: string }>;
}
