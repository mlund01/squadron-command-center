package protocol

// =============================================================================
// Registration
// =============================================================================

// RegisterPayload is sent by an instance when it connects to commander.
type RegisterPayload struct {
	InstanceName string         `json:"instanceName"`
	Version      string         `json:"version"`
	ConfigDigest string         `json:"configDigest"`
	Config       InstanceConfig `json:"config"`
}

// RegisterAckPayload is the commander's response to a registration.
type RegisterAckPayload struct {
	InstanceID string `json:"instanceId"`
	Accepted   bool   `json:"accepted"`
	Reason     string `json:"reason,omitempty"`
}

// =============================================================================
// Instance Config (JSON-safe mirror of squadron config)
// =============================================================================

// InstanceConfig is a JSON-serializable snapshot of a squadron instance's config.
// No HCL expressions or cty values — only plain types.
type InstanceConfig struct {
	Models    []ModelInfo    `json:"models"`
	Agents    []AgentInfo    `json:"agents"`
	Missions  []MissionInfo  `json:"missions"`
	Plugins   []PluginInfo   `json:"plugins"`
	Variables []VariableInfo `json:"variables"`
}

type ModelInfo struct {
	Name     string `json:"name"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
}

type AgentInfo struct {
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Role        string   `json:"role,omitempty"`
	Model       string   `json:"model"`
	Tools       []string `json:"tools,omitempty"`
}

type MissionInfo struct {
	Name        string             `json:"name"`
	Description string             `json:"description,omitempty"`
	Commander   string             `json:"commander,omitempty"`
	Agents      []string           `json:"agents,omitempty"`
	Inputs      []MissionInputInfo `json:"inputs,omitempty"`
	Datasets    []DatasetInfo      `json:"datasets,omitempty"`
	Tasks       []TaskInfo         `json:"tasks,omitempty"`
}

type DatasetInfo struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	BindTo      string          `json:"bindTo,omitempty"`
	Schema      []DatasetField  `json:"schema,omitempty"`
}

type DatasetField struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Required bool   `json:"required,omitempty"`
}

type MissionInputInfo struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Type        string `json:"type,omitempty"`
	Required    bool   `json:"required"`
}

type TaskInfo struct {
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Objective   string            `json:"objective,omitempty"`
	Agent       string            `json:"agent,omitempty"`
	Commander   string            `json:"commander,omitempty"`
	DependsOn   []string          `json:"dependsOn,omitempty"`
	Iterator    *TaskIteratorInfo `json:"iterator,omitempty"`
}

type TaskIteratorInfo struct {
	Dataset          string `json:"dataset"`
	Parallel         bool   `json:"parallel"`
	MaxRetries       int    `json:"maxRetries,omitempty"`
	ConcurrencyLimit int    `json:"concurrencyLimit,omitempty"`
}


type PluginInfo struct {
	Name    string     `json:"name"`
	Path    string     `json:"path"`
	Builtin bool       `json:"builtin,omitempty"`
	Tools   []ToolInfo `json:"tools,omitempty"`
}

type ToolInfo struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Parameters  *ToolSchema     `json:"parameters,omitempty"`
}

type ToolSchema struct {
	Type       string                  `json:"type"`
	Properties map[string]ToolProperty `json:"properties,omitempty"`
	Required   []string                `json:"required,omitempty"`
}

type ToolProperty struct {
	Type        string                  `json:"type"`
	Description string                  `json:"description,omitempty"`
	Items       *ToolProperty           `json:"items,omitempty"`
	Properties  map[string]ToolProperty `json:"properties,omitempty"`
	Required    []string                `json:"required,omitempty"`
}

type VariableInfo struct {
	Name   string `json:"name"`
	Secret bool   `json:"secret"`
}

// =============================================================================
// Heartbeat
// =============================================================================

type HeartbeatPayload struct{}

type HeartbeatAckPayload struct{}

// =============================================================================
// Config queries
// =============================================================================

type GetConfigPayload struct{}

type GetConfigResultPayload struct {
	Config InstanceConfig `json:"config"`
}

// =============================================================================
// Mission execution
// =============================================================================

// RunMissionPayload is sent by commander to trigger a mission on an instance.
type RunMissionPayload struct {
	MissionName string            `json:"missionName"`
	Inputs      map[string]string `json:"inputs"`
}

// RunMissionAckPayload is the instance's response to a run request.
type RunMissionAckPayload struct {
	Accepted  bool   `json:"accepted"`
	MissionID string `json:"missionId,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

// MissionEventPayload wraps a streaming mission execution event.
type MissionEventPayload struct {
	MissionID string          `json:"missionId"`
	EventType MissionEventType `json:"eventType"`
	Data      interface{}     `json:"data"`
}

// MissionCompletePayload signals terminal status for a mission.
type MissionCompletePayload struct {
	MissionID string `json:"missionId"`
	Status    string `json:"status"` // "completed" or "failed"
	Error     string `json:"error,omitempty"`
}

// =============================================================================
// Historical queries
// =============================================================================

type GetMissionsPayload struct {
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
}

type GetMissionsResultPayload struct {
	Missions []MissionRecordInfo `json:"missions"`
	Total    int                 `json:"total"`
}

type GetMissionPayload struct {
	MissionID string `json:"missionId"`
}

type GetMissionResultPayload struct {
	Mission MissionRecordInfo `json:"mission"`
	Tasks   []MissionTaskInfo `json:"tasks"`
}

type GetTaskDetailPayload struct {
	TaskID string `json:"taskId"`
}

type GetTaskDetailResultPayload struct {
	Task        MissionTaskInfo  `json:"task"`
	Outputs     []TaskOutputInfo `json:"outputs"`
	Sessions    []SessionInfoDTO `json:"sessions"`
	ToolResults []ToolResultDTO  `json:"toolResults"`
}

type ToolResultDTO struct {
	ID          string `json:"id"`
	SessionID   string `json:"sessionId"`
	ToolName    string `json:"toolName"`
	InputParams string `json:"inputParams,omitempty"`
	StartedAt   string `json:"startedAt"`
	FinishedAt  string `json:"finishedAt"`
}

type GetEventsPayload struct {
	MissionID string `json:"missionId"`
	Limit     int    `json:"limit"`
	Offset    int    `json:"offset"`
}

type GetEventsResultPayload struct {
	Events []MissionEventInfo `json:"events"`
}

// =============================================================================
// Dataset queries
// =============================================================================

type GetDatasetsPayload struct {
	MissionID string `json:"missionId"`
}

type DatasetRecordInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	ItemCount   int    `json:"itemCount"`
}

type GetDatasetsResultPayload struct {
	Datasets []DatasetRecordInfo `json:"datasets"`
}

type GetDatasetItemsPayload struct {
	DatasetID string `json:"datasetId"`
	Offset    int    `json:"offset"`
	Limit     int    `json:"limit"`
}

type GetDatasetItemsResultPayload struct {
	Items []string `json:"items"`
	Total int      `json:"total"`
}

// =============================================================================
// Historical data types (JSON mirrors of store types)
// =============================================================================

type MissionRecordInfo struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Status     string  `json:"status"`
	InputsJSON string  `json:"inputsJson,omitempty"`
	ConfigJSON string  `json:"configJson,omitempty"`
	StartedAt  string  `json:"startedAt"`
	FinishedAt *string `json:"finishedAt,omitempty"`
}

type MissionTaskInfo struct {
	ID         string  `json:"id"`
	MissionID  string  `json:"missionId"`
	TaskName   string  `json:"taskName"`
	Status     string  `json:"status"`
	ConfigJSON string  `json:"configJson,omitempty"`
	StartedAt  *string `json:"startedAt,omitempty"`
	FinishedAt *string `json:"finishedAt,omitempty"`
	Summary    *string `json:"summary,omitempty"`
	OutputJSON *string `json:"outputJson,omitempty"`
	Error      *string `json:"error,omitempty"`
}

type TaskOutputInfo struct {
	ID           string  `json:"id"`
	TaskID       string  `json:"taskId"`
	DatasetName  *string `json:"datasetName,omitempty"`
	DatasetIndex *int    `json:"datasetIndex,omitempty"`
	ItemID       *string `json:"itemId,omitempty"`
	OutputJSON   string  `json:"outputJson"`
	Summary      string  `json:"summary"`
	CreatedAt    string  `json:"createdAt"`
}

type SessionInfoDTO struct {
	ID             string  `json:"id"`
	TaskID         string  `json:"taskId"`
	Role           string  `json:"role"`
	AgentName      string  `json:"agentName,omitempty"`
	Model          string  `json:"model,omitempty"`
	Status         string  `json:"status"`
	StartedAt      string  `json:"startedAt"`
	FinishedAt     *string `json:"finishedAt,omitempty"`
	IterationIndex *int    `json:"iterationIndex,omitempty"`
}

type MissionEventInfo struct {
	ID             string  `json:"id"`
	MissionID      string  `json:"missionId"`
	TaskID         *string `json:"taskId,omitempty"`
	SessionID      *string `json:"sessionId,omitempty"`
	IterationIndex *int    `json:"iterationIndex,omitempty"`
	EventType      string  `json:"eventType"`
	DataJSON       string  `json:"dataJson"`
	CreatedAt      string  `json:"createdAt"`
}

// =============================================================================
// Agent chat
// =============================================================================

// ChatMessagePayload is sent by commander to start/continue a chat with an agent.
type ChatMessagePayload struct {
	SessionID string `json:"sessionId,omitempty"`
	AgentName string `json:"agentName"`
	Content   string `json:"content"`
}

// ChatMessageAckPayload is the instance's acknowledgement.
type ChatMessageAckPayload struct {
	SessionID string `json:"sessionId"`
	Accepted  bool   `json:"accepted"`
	Reason    string `json:"reason,omitempty"`
}

// ChatEventPayload wraps a streaming chat event.
type ChatEventPayload struct {
	SessionID string        `json:"sessionId"`
	EventType ChatEventType `json:"eventType"`
	Data      interface{}   `json:"data"`
}

// ChatCompletePayload signals the agent finished its turn.
type ChatCompletePayload struct {
	SessionID string `json:"sessionId"`
	Status    string `json:"status"` // "completed" or "error"
	Error     string `json:"error,omitempty"`
}

// =============================================================================
// Chat history queries
// =============================================================================

type GetChatHistoryPayload struct {
	AgentName string `json:"agentName,omitempty"`
	Limit     int    `json:"limit"`
	Offset    int    `json:"offset"`
}

type GetChatHistoryResultPayload struct {
	Chats []ChatSessionInfo `json:"chats"`
	Total int               `json:"total"`
}

type GetChatMessagesPayload struct {
	SessionID string `json:"sessionId"`
}

type GetChatMessagesResultPayload struct {
	Messages []ChatMessageInfo `json:"messages"`
}

type ChatSessionInfo struct {
	SessionID string `json:"sessionId"`
	AgentName string `json:"agentName"`
	Model     string `json:"model"`
	Status    string `json:"status"`
	StartedAt string `json:"startedAt"`
}

type ChatMessageInfo struct {
	ID        int    `json:"id"`
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
}

// =============================================================================
// Chat management
// =============================================================================

type ArchiveChatPayload struct {
	SessionID string `json:"sessionId"`
}

type ArchiveChatAckPayload struct {
	Accepted bool   `json:"accepted"`
	Reason   string `json:"reason,omitempty"`
}

// =============================================================================
// Config reload
// =============================================================================

type ReloadConfigPayload struct{}

type ReloadConfigResultPayload struct {
	Success bool           `json:"success"`
	Error   string         `json:"error,omitempty"`
	Config  InstanceConfig `json:"config,omitempty"`
}

// =============================================================================
// Config file operations
// =============================================================================

type ListConfigFilesPayload struct{}

type ConfigFileInfo struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

type ListConfigFilesResultPayload struct {
	Files []ConfigFileInfo `json:"files"`
	Path  string           `json:"path"`
}

type GetConfigFilePayload struct {
	Name string `json:"name"`
}

type GetConfigFileResultPayload struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

type WriteConfigFilePayload struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

type WriteConfigFileResultPayload struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

type ValidateConfigPayload struct {
	Files map[string]string `json:"files"` // filename → proposed content
}

type ValidateConfigResultPayload struct {
	Valid  bool     `json:"valid"`
	Errors []string `json:"errors,omitempty"`
}

// =============================================================================
// Error
// =============================================================================

type ErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
