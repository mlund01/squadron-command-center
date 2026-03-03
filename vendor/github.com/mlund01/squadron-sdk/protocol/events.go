package protocol

// MissionEventType identifies a specific event during mission execution.
// Each type maps to a MissionHandler or ChatHandler callback.
type MissionEventType string

const (
	// Mission lifecycle
	EventMissionStarted   MissionEventType = "mission_started"
	EventMissionCompleted MissionEventType = "mission_completed"
	EventMissionFailed    MissionEventType = "mission_failed"

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

	// Summary aggregation
	EventSummaryAggregation MissionEventType = "summary_aggregation"

	// Commander events
	EventCommanderReasoning   MissionEventType = "commander_reasoning"
	EventCommanderAnswer      MissionEventType = "commander_answer"
	EventCommanderCallingTool MissionEventType = "commander_calling_tool"
	EventCommanderToolComplete MissionEventType = "commander_tool_complete"

	// Agent events
	EventAgentStarted      MissionEventType = "agent_started"
	EventAgentCompleted    MissionEventType = "agent_completed"
	EventAgentThinking     MissionEventType = "agent_thinking"
	EventAgentCallingTool  MissionEventType = "agent_calling_tool"
	EventAgentToolComplete MissionEventType = "agent_tool_complete"
	EventAgentAnswer       MissionEventType = "agent_answer"
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

// Task lifecycle

type TaskStartedData struct {
	TaskName  string `json:"taskName"`
	Objective string `json:"objective"`
}

type TaskCompletedData struct {
	TaskName string `json:"taskName"`
	Summary  string `json:"summary"`
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
	WorkingSummary string `json:"workingSummary"`
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
	Summary  string `json:"summary"`
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

// Summary aggregation

type SummaryAggregationData struct {
	TaskName     string `json:"taskName"`
	SummaryCount int    `json:"summaryCount"`
}

// Commander events

type CommanderReasoningData struct {
	TaskName string `json:"taskName"`
	Content  string `json:"content"`
}

type CommanderAnswerData struct {
	TaskName string `json:"taskName"`
	Content  string `json:"content"`
}

type CommanderCallingToolData struct {
	TaskName string `json:"taskName"`
	ToolName string `json:"toolName"`
	Input    string `json:"input"`
}

type CommanderToolCompleteData struct {
	TaskName string `json:"taskName"`
	ToolName string `json:"toolName"`
	Result   string `json:"result"`
}

// Agent events

type AgentStartedData struct {
	TaskName  string `json:"taskName"`
	AgentName string `json:"agentName"`
}

type AgentCompletedData struct {
	TaskName  string `json:"taskName"`
	AgentName string `json:"agentName"`
}

type AgentThinkingData struct {
	TaskName  string `json:"taskName"`
	AgentName string `json:"agentName"`
	Content   string `json:"content"`
}

type AgentCallingToolData struct {
	TaskName  string `json:"taskName"`
	AgentName string `json:"agentName"`
	ToolName  string `json:"toolName"`
	Payload   string `json:"payload"`
}

type AgentToolCompleteData struct {
	TaskName  string `json:"taskName"`
	AgentName string `json:"agentName"`
	ToolName  string `json:"toolName"`
	Result    string `json:"result"`
}

type AgentAnswerData struct {
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
