package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/mlund01/squadron-wire/protocol"

	"commander/internal/hub"
)

func handleGetVariables(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")

		instance := h.GetRegistry().GetInstance(instanceID)
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		if !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		req, err := protocol.NewRequest(protocol.TypeGetVariables, &protocol.GetVariablesPayload{})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		resp, err := h.SendRequest(instanceID, req, proxyTimeout)
		if err != nil {
			writeJSON(w, http.StatusGatewayTimeout, map[string]string{"error": fmt.Sprintf("request failed: %v", err)})
			return
		}

		var result protocol.GetVariablesResultPayload
		if err := protocol.DecodePayload(resp, &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		writeJSON(w, http.StatusOK, result)
	}
}

func handleSetVariable(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		varName := r.PathValue("name")

		instance := h.GetRegistry().GetInstance(instanceID)
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		if !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read body"})
			return
		}

		var payload struct {
			Value string `json:"value"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}

		req, err := protocol.NewRequest(protocol.TypeSetVariable, &protocol.SetVariablePayload{
			Name:  varName,
			Value: payload.Value,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		resp, err := h.SendRequest(instanceID, req, proxyTimeout)
		if err != nil {
			writeJSON(w, http.StatusGatewayTimeout, map[string]string{"error": fmt.Sprintf("request failed: %v", err)})
			return
		}

		var result protocol.SetVariableResultPayload
		if err := protocol.DecodePayload(resp, &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		if !result.Success {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": result.Error})
			return
		}

		writeJSON(w, http.StatusOK, map[string]bool{"success": true})
	}
}

func handleDeleteVariable(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		varName := r.PathValue("name")

		instance := h.GetRegistry().GetInstance(instanceID)
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		if !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		req, err := protocol.NewRequest(protocol.TypeDeleteVariable, &protocol.DeleteVariablePayload{
			Name: varName,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		resp, err := h.SendRequest(instanceID, req, proxyTimeout)
		if err != nil {
			writeJSON(w, http.StatusGatewayTimeout, map[string]string{"error": fmt.Sprintf("request failed: %v", err)})
			return
		}

		var result protocol.DeleteVariableResultPayload
		if err := protocol.DecodePayload(resp, &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		if !result.Success {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": result.Error})
			return
		}

		writeJSON(w, http.StatusOK, map[string]bool{"success": true})
	}
}
