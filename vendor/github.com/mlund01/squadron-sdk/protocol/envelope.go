package protocol

import (
	"encoding/json"
	"time"
)

// MessageType identifies the type of a WebSocket message.
type MessageType string

const (
	// Registration
	TypeRegister    MessageType = "register"
	TypeRegisterAck MessageType = "register_ack"

	// Heartbeat
	TypeHeartbeat    MessageType = "heartbeat"
	TypeHeartbeatAck MessageType = "heartbeat_ack"

	// Config queries
	TypeGetConfig       MessageType = "get_config"
	TypeGetConfigResult MessageType = "get_config_result"

	// Mission execution
	TypeRunMission    MessageType = "run_mission"
	TypeRunMissionAck MessageType = "run_mission_ack"
	TypeMissionEvent  MessageType = "mission_event"
	TypeMissionComplete MessageType = "mission_complete"

	// Historical queries
	TypeGetMissions       MessageType = "get_missions"
	TypeGetMissionsResult MessageType = "get_missions_result"
	TypeGetMission        MessageType = "get_mission"
	TypeGetMissionResult  MessageType = "get_mission_result"
	TypeGetTaskDetail       MessageType = "get_task_detail"
	TypeGetTaskDetailResult MessageType = "get_task_detail_result"
	TypeGetEvents       MessageType = "get_events"
	TypeGetEventsResult MessageType = "get_events_result"
	TypeGetDatasets           MessageType = "get_datasets"
	TypeGetDatasetsResult     MessageType = "get_datasets_result"
	TypeGetDatasetItems       MessageType = "get_dataset_items"
	TypeGetDatasetItemsResult MessageType = "get_dataset_items_result"

	// Agent chat
	TypeChatMessage    MessageType = "chat_message"
	TypeChatMessageAck MessageType = "chat_message_ack"
	TypeChatEvent      MessageType = "chat_event"
	TypeChatComplete   MessageType = "chat_complete"

	// Chat history & management
	TypeGetChatHistory        MessageType = "get_chat_history"
	TypeGetChatHistoryResult  MessageType = "get_chat_history_result"
	TypeGetChatMessages       MessageType = "get_chat_messages"
	TypeGetChatMessagesResult MessageType = "get_chat_messages_result"
	TypeArchiveChat           MessageType = "archive_chat"
	TypeArchiveChatAck        MessageType = "archive_chat_ack"

	// Config reload
	TypeReloadConfig       MessageType = "reload_config"
	TypeReloadConfigResult MessageType = "reload_config_result"

	// Config file operations
	TypeListConfigFiles       MessageType = "list_config_files"
	TypeListConfigFilesResult MessageType = "list_config_files_result"
	TypeGetConfigFile         MessageType = "get_config_file"
	TypeGetConfigFileResult   MessageType = "get_config_file_result"
	TypeWriteConfigFile       MessageType = "write_config_file"
	TypeWriteConfigFileResult MessageType = "write_config_file_result"
	TypeValidateConfig        MessageType = "validate_config"
	TypeValidateConfigResult  MessageType = "validate_config_result"

	// Error
	TypeError MessageType = "error"
)

// Envelope is the wire format for all WebSocket messages.
// Every message is a JSON envelope with a type discriminator and a raw payload.
type Envelope struct {
	Type      MessageType     `json:"type"`
	RequestID string          `json:"requestId,omitempty"`
	Timestamp time.Time       `json:"timestamp"`
	Payload   json.RawMessage `json:"payload"`
}
