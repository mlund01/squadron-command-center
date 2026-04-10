package protocol

// MissionEventType identifies a specific event during mission execution.
// Each type maps to a MissionHandler or ChatHandler callback.
type MissionEventType string

const (
	// Mission lifecycle
	EventMissionStarted   MissionEventType = "mission_started"
	EventMissionCompleted MissionEventType = "mission_completed"
	EventMissionFailed    MissionEventType = "mission_failed"
	EventMissionStopped   MissionEventType = "mission_stopped"
	EventMissionResumed   MissionEventType = "mission_resumed"

	// Task lifecycle
	EventTaskStarted   MissionEventType = "task_started"
	EventTaskCompleted MissionEventType = "task_completed"
	EventTaskFailed    MissionEventType = "task_failed"

	// Task iteration lifecycle
	EventTaskIterationStarted   MissionEventType = "task_iteration_started"
	EventTaskIterationCompleted MissionEventType = "task_iteration_completed"

	// Individual iteration events
	EventIterationStarted   MissionEventType = "iteration_started"
	EventIterationCompleted MissionEventType = "iteration_completed"
	EventIterationFailed    MissionEventType = "iteration_failed"
	EventIterationRetrying  MissionEventType = "iteration_retrying"
	EventIterationReasoning MissionEventType = "iteration_reasoning"
	EventIterationAnswer    MissionEventType = "iteration_answer"

	// Commander events
	EventCommanderReasoningStarted   MissionEventType = "commander_reasoning_started"
	EventCommanderReasoningCompleted MissionEventType = "commander_reasoning_completed"
	EventCommanderAnswer             MissionEventType = "commander_answer"
	EventCommanderCallingTool        MissionEventType = "commander_calling_tool"
	EventCommanderToolComplete       MissionEventType = "commander_tool_complete"

	// Compaction events
	EventCompaction MissionEventType = "compaction"

	// Session turn telemetry
	EventSessionTurn MissionEventType = "session_turn"

	// Agent events
	EventAgentStarted              MissionEventType = "agent_started"
	EventAgentCompleted            MissionEventType = "agent_completed"
	EventAgentReasoningStarted     MissionEventType = "agent_reasoning_started"
	EventAgentReasoningCompleted   MissionEventType = "agent_reasoning_completed"
	EventAgentCallingTool          MissionEventType = "agent_calling_tool"
	EventAgentToolComplete         MissionEventType = "agent_tool_complete"
	EventAgentAnswer               MissionEventType = "agent_answer"
	EventAgentAskCommander         MissionEventType = "agent_ask_commander"
	EventAgentCommanderResponse    MissionEventType = "agent_commander_response"
	EventRouteChosen       MissionEventType = "route_chosen"

	// Schedule/trigger events
	EventScheduledRun  MissionEventType = "scheduled_run"
	EventTriggeredRun  MissionEventType = "triggered_run"
	EventScheduleSkip  MissionEventType = "schedule_skip"
)

// =============================================================================
// Event data structs — one per MissionEventType
// =============================================================================

// Mission lifecycle

type MissionStartedData struct {
	MissionName string `json:"missionName"`
	MissionID   string `json:"missionId"`
	TaskCount   int    `json:"taskCount"`
}

type MissionCompletedData struct {
	MissionName string `json:"missionName"`
}

type MissionFailedData struct {
	MissionName string `json:"missionName"`
	Error       string `json:"error"`
}

type MissionStoppedData struct {
	MissionID string `json:"missionId"`
}

type MissionResumedData struct {
	MissionID string `json:"missionId"`
}

// Task lifecycle

type TaskStartedData struct {
	TaskName  string `json:"taskName"`
	Objective string `json:"objective"`
}

type TaskCompletedData struct {
	TaskName string `json:"taskName"`
}

type TaskFailedData struct {
	TaskName string `json:"taskName"`
	Error    string `json:"error"`
}

// Task iteration lifecycle

type TaskIterationStartedData struct {
	TaskName   string `json:"taskName"`
	TotalItems int    `json:"totalItems"`
	Parallel   bool   `json:"parallel"`
}

type TaskIterationCompletedData struct {
	TaskName       string `json:"taskName"`
	CompletedCount int    `json:"completedCount"`
}

// Individual iteration events

type IterationStartedData struct {
	TaskName  string `json:"taskName"`
	Index     int    `json:"index"`
	Objective string `json:"objective"`
}

type IterationCompletedData struct {
	TaskName string `json:"taskName"`
	Index    int    `json:"index"`
}

type IterationFailedData struct {
	TaskName string `json:"taskName"`
	Index    int    `json:"index"`
	Error    string `json:"error"`
}

type IterationRetryingData struct {
	TaskName   string `json:"taskName"`
	Index      int    `json:"index"`
	Attempt    int    `json:"attempt"`
	MaxRetries int    `json:"maxRetries"`
	Error      string `json:"error"`
}

type IterationReasoningData struct {
	TaskName string `json:"taskName"`
	Index    int    `json:"index"`
	Content  string `json:"content"`
}

type IterationAnswerData struct {
	TaskName string `json:"taskName"`
	Index    int    `json:"index"`
	Content  string `json:"content"`
}

// Commander events

type CommanderReasoningStartedData struct {
	TaskName string `json:"taskName"`
}

type CommanderReasoningCompletedData struct {
	TaskName string `json:"taskName"`
	Content  string `json:"content"`
}

type CommanderAnswerData struct {
	TaskName string `json:"taskName"`
	Content  string `json:"content"`
}

type CommanderCallingToolData struct {
	TaskName   string `json:"taskName"`
	ToolCallId string `json:"toolCallId"`
	ToolName   string `json:"toolName"`
	Input      string `json:"input"`
}

type CommanderToolCompleteData struct {
	TaskName   string `json:"taskName"`
	ToolCallId string `json:"toolCallId"`
	ToolName   string `json:"toolName"`
	Result     string `json:"result"`
}

// Compaction events

type CompactionData struct {
	TaskName          string `json:"taskName"`
	Entity            string `json:"entity"` // "commander" or "agent"
	InputTokens       int    `json:"inputTokens"`
	TokenLimit        int    `json:"tokenLimit"`
	MessagesCompacted int    `json:"messagesCompacted"`
	TurnRetention     int    `json:"turnRetention"`
}

// Session turn telemetry

type SessionTurnData struct {
	TaskName                 string  `json:"taskName"`
	Entity                   string  `json:"entity"` // "commander" or agent name
	Model                    string  `json:"model"`
	InputTokens              int     `json:"inputTokens"`
	OutputTokens             int     `json:"outputTokens"`
	CacheWriteTokens         int     `json:"cacheWriteTokens,omitempty"`
	CacheReadTokens          int     `json:"cacheReadTokens,omitempty"`
	UserMessages             int     `json:"userMessages"`
	AssistantMessages        int     `json:"assistantMessages"`
	SystemMessages           int     `json:"systemMessages"`
	PayloadBytes             int     `json:"payloadBytes"`
	TurnDurationMs           int64   `json:"turnDurationMs"`
	Cost                     float64 `json:"cost,omitempty"`     // Total cost for this turn in USD
	InputCost                float64 `json:"inputCost,omitempty"`
	OutputCost               float64 `json:"outputCost,omitempty"`
	CacheReadCost            float64 `json:"cacheReadCost,omitempty"`
	CacheWriteCost           float64 `json:"cacheWriteCost,omitempty"`
}

// Agent events

type AgentStartedData struct {
	TaskName    string `json:"taskName"`
	AgentName   string `json:"agentName"`
	Instruction string `json:"instruction,omitempty"`
}

type AgentCompletedData struct {
	TaskName  string `json:"taskName"`
	AgentName string `json:"agentName"`
}

type AgentReasoningStartedData struct {
	TaskName  string `json:"taskName"`
	AgentName string `json:"agentName"`
}

type AgentReasoningCompletedData struct {
	TaskName  string `json:"taskName"`
	AgentName string `json:"agentName"`
	Content   string `json:"content"`
}

type AgentCallingToolData struct {
	TaskName   string `json:"taskName"`
	AgentName  string `json:"agentName"`
	ToolCallId string `json:"toolCallId"`
	ToolName   string `json:"toolName"`
	Payload    string `json:"payload"`
}

type AgentToolCompleteData struct {
	TaskName   string `json:"taskName"`
	AgentName  string `json:"agentName"`
	ToolCallId string `json:"toolCallId"`
	ToolName   string `json:"toolName"`
	Result     string `json:"result"`
}

type AgentAnswerData struct {
	TaskName  string `json:"taskName"`
	AgentName string `json:"agentName"`
	Content   string `json:"content"`
}

type AgentAskCommanderData struct {
	TaskName  string `json:"taskName"`
	AgentName string `json:"agentName"`
	Content   string `json:"content"`
}

type AgentCommanderResponseData struct {
	TaskName  string `json:"taskName"`
	AgentName string `json:"agentName"`
	Content   string `json:"content"`
}

// =============================================================================
// Agent chat event types
// =============================================================================

// ChatEventType identifies a specific event during an agent chat session.
type ChatEventType string

const (
	ChatEventThinking       ChatEventType = "thinking"
	ChatEventReasoningChunk ChatEventType = "reasoning_chunk"
	ChatEventReasoningDone  ChatEventType = "reasoning_done"
	ChatEventAnswerChunk    ChatEventType = "answer_chunk"
	ChatEventAnswerDone     ChatEventType = "answer_done"
	ChatEventCallingTool    ChatEventType = "calling_tool"
	ChatEventToolComplete   ChatEventType = "tool_complete"
	ChatEventTurnComplete   ChatEventType = "turn_complete"
	ChatEventError          ChatEventType = "error"
)

// Chat event data structs

type ChatChunkData struct {
	Content string `json:"content"`
}

type ChatToolData struct {
	ToolName string `json:"toolName"`
	Payload  string `json:"payload,omitempty"`
	Result   string `json:"result,omitempty"`
}

type ChatErrorData struct {
	Message string `json:"message"`
}

type RouteChosenData struct {
	RouterTask string `json:"routerTask"`
	TargetTask string `json:"targetTask"`
	Condition  string `json:"condition"`
	IsMission  bool   `json:"isMission,omitempty"`
}

// Schedule/trigger events

type ScheduleSkipData struct {
	MissionName string `json:"missionName"`
	Source      string `json:"source"` // "schedule", "schedule[1]", "manual", "webhook"
	Reason      string `json:"reason"`
}
