package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/mlund01/squadron-wire/protocol"

	"commander/internal/hub"
)

// handleWebhook handles incoming webhook requests at POST /webhooks/{instanceName}/{webhookPath...}.
// It looks up the instance by name, finds the mission with a matching webhook path,
// validates the secret header if configured, and dispatches TypeRunMission to the instance.
func handleWebhook(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Extract instance name and webhook path from the URL.
		// Route pattern: POST /webhooks/{instanceName}/{webhookPath...}
		instanceName := r.PathValue("instanceName")
		webhookPath := "/" + r.PathValue("webhookPath")

		if instanceName == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing instance name"})
			return
		}

		// Look up instance by name
		instance := h.GetRegistry().GetInstanceByName(instanceName)
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		if !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		// Find the mission with a matching webhook path
		missionName, trigger := findMissionByWebhookPath(instance.Config, webhookPath)
		if trigger == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": fmt.Sprintf("no webhook registered at %s", webhookPath)})
			return
		}

		// Validate secret if configured
		if trigger.Secret != "" {
			headerSecret := r.Header.Get("X-Webhook-Secret")
			if headerSecret == "" {
				headerSecret = r.Header.Get("x-webhook-secret")
			}
			if headerSecret != trigger.Secret {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid or missing webhook secret"})
				return
			}
		}

		// Extract inputs from JSON body
		inputs := make(map[string]string)
		if r.Body != nil && r.ContentLength > 0 {
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("invalid JSON body: %v", err)})
				return
			}
			// Flatten to string map
			for k, v := range body {
				switch val := v.(type) {
				case string:
					inputs[k] = val
				default:
					b, _ := json.Marshal(val)
					inputs[k] = string(b)
				}
			}
		}

		// Dispatch TypeRunMission to the instance
		req, err := protocol.NewRequest(protocol.TypeRunMission, &protocol.RunMissionPayload{
			MissionName: missionName,
			Inputs:      inputs,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		resp, err := h.SendRequest(instance.ID, req, proxyTimeout)
		if err != nil {
			writeJSON(w, http.StatusGatewayTimeout, map[string]string{"error": fmt.Sprintf("request failed: %v", err)})
			return
		}

		var ack protocol.RunMissionAckPayload
		if err := protocol.DecodePayload(resp, &ack); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		if !ack.Accepted {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": ack.Reason})
			return
		}

		log.Printf("Webhook triggered mission %q on instance %s (missionId=%s)", missionName, instance.Name, ack.MissionID)

		writeJSON(w, http.StatusAccepted, map[string]string{
			"missionId": ack.MissionID,
			"status":    "started",
			"source":    "webhook",
		})
	}
}

// findMissionByWebhookPath searches the instance config for a mission whose trigger
// webhook path matches the given path. Returns the mission name and trigger info.
func findMissionByWebhookPath(config protocol.InstanceConfig, path string) (string, *protocol.TriggerInfo) {
	// Normalize path: ensure leading slash, strip trailing slash
	path = "/" + strings.TrimPrefix(path, "/")
	path = strings.TrimRight(path, "/")

	for _, m := range config.Missions {
		if m.Trigger == nil {
			continue
		}
		triggerPath := "/" + strings.TrimPrefix(m.Trigger.WebhookPath, "/")
		triggerPath = strings.TrimRight(triggerPath, "/")
		if triggerPath == path {
			return m.Name, m.Trigger
		}
	}
	return "", nil
}
