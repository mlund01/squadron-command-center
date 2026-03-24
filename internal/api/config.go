package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/mlund01/squadron-wire/protocol"

	"commander/internal/hub"
)

func handleReloadConfig(h *hub.Hub) http.HandlerFunc {
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

		req, err := protocol.NewRequest(protocol.TypeReloadConfig, &protocol.ReloadConfigPayload{})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		resp, err := h.SendRequest(instanceID, req, proxyTimeout)
		if err != nil {
			writeJSON(w, http.StatusGatewayTimeout, map[string]string{"error": fmt.Sprintf("request failed: %v", err)})
			return
		}

		var result protocol.ReloadConfigResultPayload
		if err := protocol.DecodePayload(resp, &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		if !result.Success {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"success": "false",
				"error":   result.Error,
			})
			return
		}

		// Update cached config in registry
		h.GetRegistry().UpdateConfig(instanceID, result.Config)

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"success": true,
			"config":  result.Config,
		})
	}
}

func handleListConfigFiles(h *hub.Hub) http.HandlerFunc {
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

		req, err := protocol.NewRequest(protocol.TypeListConfigFiles, &protocol.ListConfigFilesPayload{})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		resp, err := h.SendRequest(instanceID, req, proxyTimeout)
		if err != nil {
			writeJSON(w, http.StatusGatewayTimeout, map[string]string{"error": fmt.Sprintf("request failed: %v", err)})
			return
		}

		var result protocol.ListConfigFilesResultPayload
		if err := protocol.DecodePayload(resp, &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"files":           result.Files,
			"path":            result.Path,
			"allowConfigEdit": h.AllowConfigEdit,
		})
	}
}

func handleGetConfigFile(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		fileName := r.PathValue("name")

		instance := h.GetRegistry().GetInstance(instanceID)
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		if !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		req, err := protocol.NewRequest(protocol.TypeGetConfigFile, &protocol.GetConfigFilePayload{
			Name: fileName,
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

		var result protocol.GetConfigFileResultPayload
		if err := protocol.DecodePayload(resp, &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		writeJSON(w, http.StatusOK, result)
	}
}

func handleValidateConfig(h *hub.Hub) http.HandlerFunc {
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

		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read body"})
			return
		}

		var payload protocol.ValidateConfigPayload
		if err := json.Unmarshal(body, &payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}

		req, err := protocol.NewRequest(protocol.TypeValidateConfig, &payload)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		resp, err := h.SendRequest(instanceID, req, proxyTimeout)
		if err != nil {
			writeJSON(w, http.StatusGatewayTimeout, map[string]string{"error": fmt.Sprintf("request failed: %v", err)})
			return
		}

		var result protocol.ValidateConfigResultPayload
		if err := protocol.DecodePayload(resp, &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		writeJSON(w, http.StatusOK, result)
	}
}

func handleWriteConfigFile(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !h.AllowConfigEdit {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "config editing is disabled"})
			return
		}

		instanceID := r.PathValue("id")
		fileName := r.PathValue("name")

		instance := h.GetRegistry().GetInstance(instanceID)
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		if !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1MB limit
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read body"})
			return
		}

		var payload struct {
			Content string `json:"content"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}

		req, err := protocol.NewRequest(protocol.TypeWriteConfigFile, &protocol.WriteConfigFilePayload{
			Name:    fileName,
			Content: payload.Content,
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

		var result protocol.WriteConfigFileResultPayload
		if err := protocol.DecodePayload(resp, &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		if !result.Success {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": result.Error})
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"success": "true"})
	}
}
