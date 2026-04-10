// TypeScript mirrors of protocol types

export interface InstanceState {
  id: string;
  name: string;
  version: string;
  configDigest: string;
  configReady: boolean;
  configError?: string;
  config: InstanceConfig;
  connected: boolean;
  connectedAt?: string;
  disconnectedAt?: string;
}

export interface InstanceConfig {
  models: ModelInfo[];
  agents: AgentInfo[];
  missions: MissionInfo[];
  plugins: PluginInfo[];
  variables: VariableInfo[];
  skills?: SkillInfo[];
  sharedFolders?: SharedFolderInfo[];
}

export interface SkillInfo {
  name: string;
  description: string;
  instructions: string;
  tools?: string[];
  agent?: string;
}

export interface ModelInfo {
  name: string;
  provider: string;
  model: string;
}

export interface AgentInfo {
  name: string;
  description?: string;
  role?: string;
  model: string;
  tools?: string[];
  skills?: string[];
  mission?: string;
}

export interface MissionInfo {
  name: string;
  description?: string;
  commander?: string;
  agents?: string[];
  inputs?: MissionInputInfo[];
  datasets?: DatasetInfo[];
  tasks?: TaskInfo[];
  schedules?: ScheduleInfo[];
  trigger?: TriggerInfo;
  maxParallel?: number;
}

export interface ScheduleInfo {
  expression: string;
  at?: string[];
  every?: string;
  weekdays?: string[];
  timezone?: string;
  inputs?: Record<string, string>;
}

export interface TriggerInfo {
  type: string;
  webhookPath?: string;
  hasSecret?: boolean;
  secret?: string;
}

export interface DatasetInfo {
  name: string;
  description?: string;
  bindTo?: string;
  schema?: DatasetField[];
}

export interface DatasetField {
  name: string;
  type: string;
  required?: boolean;
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

export interface TaskIteratorInfo {
  dataset: string;
  parallel: boolean;
  maxRetries?: number;
  concurrencyLimit?: number;
}

export interface TaskRouteInfo {
  target: string;
  condition: string;
  isMission?: boolean;
}

export interface TaskRouterInfo {
  routes: TaskRouteInfo[];
}

export interface TaskInfo {
  name: string;
  description?: string;
  objective?: string;
  sendTo?: string[];
  agent?: string;
  commander?: string;
  dependsOn?: string[];
  iterator?: TaskIteratorInfo;
  router?: TaskRouterInfo;
}

export interface PluginInfo {
  name: string;
  path: string;
  version?: string;
  builtin?: boolean;
  kind?: 'builtin' | 'plugin' | 'mcp';
  tools?: ToolInfo[];
}

export interface ToolInfo {
  name: string;
  description?: string;
  parameters?: ToolSchema;
}

export interface ToolSchema {
  type: string;
  properties?: Record<string, ToolProperty>;
  required?: string[];
}

export interface ToolProperty {
  type: string;
  description?: string;
  items?: ToolProperty;
  properties?: Record<string, ToolProperty>;
  required?: string[];
}

export interface VariableInfo {
  name: string;
  secret: boolean;
}

export interface VariableDetail {
  name: string;
  secret: boolean;
  value: string;
  hasValue: boolean;
  default?: string;
  source: 'override' | 'default' | 'unset';
}

export interface GetVariablesResponse {
  variables: VariableDetail[];
}

export interface MissionRecordInfo {
  id: string;
  name: string;
  status: string;
  inputsJson?: string;
  configJson?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface MissionEvent {
  missionId: string;
  eventType: string;
  data: Record<string, unknown>;
}

export interface MissionHistoryResponse {
  missions: MissionRecordInfo[];
  total: number;
}

export interface RunMissionResponse {
  missionId: string;
  status: string;
}

export interface ChatEvent {
  sessionId: string;
  eventType: string;
  data: Record<string, unknown>;
}

export interface ChatMessageResponse {
  sessionId: string;
  status: string;
}

export interface ChatSessionInfo {
  sessionId: string;
  agentName: string;
  model: string;
  status: string;
  startedAt: string;
}

export interface ChatMessageInfo {
  id: number;
  role: string;
  content: string;
  createdAt: string;
}

export interface ChatHistoryResponse {
  chats: ChatSessionInfo[];
  total: number;
}

export interface ChatMessagesResponse {
  messages: ChatMessageInfo[];
}

export interface ReloadConfigResponse {
  success: boolean;
  error?: string;
}

export interface MissionTaskRecord {
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

export interface GetMissionDetailResponse {
  mission: MissionRecordInfo;
  tasks: MissionTaskRecord[];
}

export interface GetMissionEventsResponse {
  events: MissionEventRecord[];
}

export interface SessionInfoDTO {
  id: string;
  taskId: string;
  role: string;
  agentName?: string;
  model?: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  iterationIndex?: number;
}

export interface TaskOutputInfo {
  id: string;
  taskId: string;
  datasetName?: string;
  datasetIndex?: number;
  itemId?: string;
  outputJson: string;
  createdAt: string;
}

export interface ToolResultDTO {
  id: string;
  sessionId: string;
  toolCallId?: string;
  toolName: string;
  inputParams?: string;
  output?: string;
  startedAt: string;
  finishedAt: string;
}

export interface SubtaskInfo {
  index: number;
  title: string;
  status: string; // pending, in_progress, completed
  sessionId: string;
  iterationIndex?: number;
  completedAt?: string;
}

export interface TaskInputInfo {
  iterationIndex?: number;
  objective: string;
}

export interface DatasetItemInfo {
  index: number;
  itemJson: string;
}

export interface TaskDetailResponse {
  task: MissionTaskRecord;
  outputs: TaskOutputInfo[];
  sessions: SessionInfoDTO[];
  toolResults: ToolResultDTO[];
  subtasks: SubtaskInfo[];
  inputs: TaskInputInfo[];
  datasetItems?: DatasetItemInfo[];
}

export interface DatasetRecordInfo {
  id: string;
  name: string;
  description?: string;
  itemCount: number;
}

export interface GetDatasetsResponse {
  datasets: DatasetRecordInfo[];
}

export interface GetDatasetItemsResponse {
  items: string[];
  total: number;
}

export interface ConfigFileInfo {
  name: string;
  size: number;
}

export interface ListConfigFilesResponse {
  files: ConfigFileInfo[];
  path: string;
  allowConfigEdit: boolean;
}

export interface GetConfigFileResponse {
  name: string;
  content: string;
}

export interface WriteConfigFileResponse {
  success: string;
  error?: string;
}

export interface ValidateConfigResponse {
  valid: boolean;
  errors?: string[];
}

// Shared folder types

export interface SharedFolderInfo {
  name: string;
  path: string;
  label: string;
  description?: string;
  editable: boolean;
  isShared: boolean;
  missions?: string[];
}

export interface BrowseEntryInfo {
  name: string;
  isDir: boolean;
  size: number;
  modTime: string;
}

export interface BrowseDirectoryResponse {
  browserName: string;
  relPath: string;
  entries: BrowseEntryInfo[];
}

export interface ReadBrowseFileResponse {
  browserName: string;
  relPath: string;
  content: string;
  size: number;
  isBinary: boolean;
}

export interface WriteBrowseFileResponse {
  success: boolean;
  error?: string;
}

export interface ListSharedFoldersResponse {
  folders: SharedFolderInfo[];
}
