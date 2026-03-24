package protocol

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// NewRequest creates an Envelope for a request message.
// A unique RequestID is generated for response correlation.
func NewRequest(msgType MessageType, payload interface{}) (*Envelope, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}
	return &Envelope{
		Type:      msgType,
		RequestID: uuid.New().String(),
		Timestamp: time.Now(),
		Payload:   raw,
	}, nil
}

// NewResponse creates an Envelope that responds to a request.
// It echoes the RequestID from the original request.
func NewResponse(requestID string, msgType MessageType, payload interface{}) (*Envelope, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}
	return &Envelope{
		Type:      msgType,
		RequestID: requestID,
		Timestamp: time.Now(),
		Payload:   raw,
	}, nil
}

// NewEvent creates an Envelope for a one-way event (no RequestID).
func NewEvent(msgType MessageType, payload interface{}) (*Envelope, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}
	return &Envelope{
		Type:      msgType,
		Timestamp: time.Now(),
		Payload:   raw,
	}, nil
}

// NewError creates an error Envelope, optionally responding to a request.
func NewError(requestID, code, message string) (*Envelope, error) {
	return NewResponse(requestID, TypeError, &ErrorPayload{
		Code:    code,
		Message: message,
	})
}

// DecodePayload unmarshals the envelope's raw payload into the given target.
func DecodePayload(env *Envelope, target interface{}) error {
	if err := json.Unmarshal(env.Payload, target); err != nil {
		return fmt.Errorf("decode %s payload: %w", env.Type, err)
	}
	return nil
}
