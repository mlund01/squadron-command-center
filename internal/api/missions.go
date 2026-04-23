package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/mlund01/squadron-wire/protocol"

	"commander/internal/hub"
)

const proxyTimeout = 30 * time.Second

func handleRunMission(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		missionName := r.PathValue("name")

		instance := h.GetRegistry().GetInstance(instanceID)
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		if !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		var body struct {
			Inputs map[string]string `json:"inputs"`
		}
		if r.Body != nil {
			json.NewDecoder(r.Body).Decode(&body)
		}
		if body.Inputs == nil {
			body.Inputs = make(map[string]string)
		}

		req, err := protocol.NewRequest(protocol.TypeRunMission, &protocol.RunMissionPayload{
			MissionName: missionName,
			Inputs:      body.Inputs,
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

		var ack protocol.RunMissionAckPayload
		if err := protocol.DecodePayload(resp, &ack); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		if !ack.Accepted {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": ack.Reason})
			return
		}

		writeJSON(w, http.StatusAccepted, map[string]string{
			"missionId": ack.MissionID,
			"status":    "started",
		})
	}
}

func handleStopMission(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		missionID := r.PathValue("mid")

		instance := h.GetRegistry().GetInstance(instanceID)
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		if !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		req, err := protocol.NewRequest(protocol.TypeStopMission, &protocol.StopMissionPayload{
			MissionID: missionID,
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

		var ack protocol.StopMissionAckPayload
		if err := protocol.DecodePayload(resp, &ack); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		if !ack.Accepted {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": ack.Reason})
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
	}
}

func handleResumeMission(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		missionID := r.PathValue("mid")

		instance := h.GetRegistry().GetInstance(instanceID)
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		if !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		var body struct {
			MissionName string `json:"missionName"`
		}
		if r.Body != nil {
			json.NewDecoder(r.Body).Decode(&body)
		}

		req, err := protocol.NewRequest(protocol.TypeResumeMission, &protocol.ResumeMissionPayload{
			MissionID:   missionID,
			MissionName: body.MissionName,
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

		var ack protocol.ResumeMissionAckPayload
		if err := protocol.DecodePayload(resp, &ack); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		if !ack.Accepted {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": ack.Reason})
			return
		}

		writeJSON(w, http.StatusAccepted, map[string]string{
			"missionId": ack.MissionID,
			"status":    "resumed",
		})
	}
}

func handleMissionEvents(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		missionID := r.PathValue("mid")

		conn := h.GetConnection(instanceID)
		if conn == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		// Set SSE headers
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming not supported", http.StatusInternalServerError)
			return
		}

		// Subscribe to mission events from the connection's local fanout
		ch, cleanup := conn.SubscribeMissionEvents(missionID)
		defer cleanup()

		// Tell squadron to send events for this mission
		subEnv, _ := protocol.NewRequest(protocol.TypeSubscribe, &protocol.SubscribePayload{
			Scope:     "mission",
			MissionID: missionID,
		})
		h.SendMessage(instanceID, subEnv)

		// Unsubscribe when SSE closes
		defer func() {
			unsubEnv, _ := protocol.NewRequest(protocol.TypeUnsubscribe, &protocol.UnsubscribePayload{
				Scope:     "mission",
				MissionID: missionID,
			})
			h.SendMessage(instanceID, unsubEnv)
		}()

		// Pulse to keep subscription alive
		pulse := time.NewTicker(15 * time.Second)
		defer pulse.Stop()

		ctx := r.Context()

		for {
			select {
			case <-ctx.Done():
				return
			case <-pulse.C:
				// Re-subscribe as a heartbeat
				pulseEnv, _ := protocol.NewRequest(protocol.TypeSubscribe, &protocol.SubscribePayload{
					Scope:     "mission",
					MissionID: missionID,
				})
				h.SendMessage(instanceID, pulseEnv)
			case event, ok := <-ch:
				if !ok {
					return
				}

				data, err := json.Marshal(event)
				if err != nil {
					log.Printf("SSE marshal error: %v", err)
					continue
				}

				fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.EventType, data)
				flusher.Flush()

				// Close on terminal events
				if event.EventType == protocol.EventMissionCompleted || event.EventType == protocol.EventMissionFailed {
					return
				}
			}
		}
	}
}

func handleGetMission(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		missionID := r.PathValue("mid")

		instance := h.GetRegistry().GetInstance(instanceID)
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		if !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		req, err := protocol.NewRequest(protocol.TypeGetMission, &protocol.GetMissionPayload{
			MissionID: missionID,
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

		var result protocol.GetMissionResultPayload
		if err := protocol.DecodePayload(resp, &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		writeJSON(w, http.StatusOK, result)
	}
}

func handleGetMissionEvents(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		missionID := r.PathValue("mid")

		instance := h.GetRegistry().GetInstance(instanceID)
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		if !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		req, err := protocol.NewRequest(protocol.TypeGetEvents, &protocol.GetEventsPayload{
			MissionID: missionID,
			Limit:     5000,
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

		var result protocol.GetEventsResultPayload
		if err := protocol.DecodePayload(resp, &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		writeJSON(w, http.StatusOK, result)
	}
}

func handleGetTaskDetail(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		taskID := r.PathValue("tid")

		instance := h.GetRegistry().GetInstance(instanceID)
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		if !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		req, err := protocol.NewRequest(protocol.TypeGetTaskDetail, &protocol.GetTaskDetailPayload{
			TaskID: taskID,
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

		var result protocol.GetTaskDetailResultPayload
		if err := protocol.DecodePayload(resp, &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		writeJSON(w, http.StatusOK, result)
	}
}

func handleGetDatasets(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		missionID := r.PathValue("mid")

		instance := h.GetRegistry().GetInstance(instanceID)
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		if !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		req, err := protocol.NewRequest(protocol.TypeGetDatasets, &protocol.GetDatasetsPayload{
			MissionID: missionID,
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

		var result protocol.GetDatasetsResultPayload
		if err := protocol.DecodePayload(resp, &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		writeJSON(w, http.StatusOK, result)
	}
}

func handleGetDatasetItems(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		datasetID := r.PathValue("did")

		instance := h.GetRegistry().GetInstance(instanceID)
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		if !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		offset := 0
		limit := 50
		if v := r.URL.Query().Get("offset"); v != "" {
			fmt.Sscanf(v, "%d", &offset)
		}
		if v := r.URL.Query().Get("limit"); v != "" {
			fmt.Sscanf(v, "%d", &limit)
		}

		req, err := protocol.NewRequest(protocol.TypeGetDatasetItems, &protocol.GetDatasetItemsPayload{
			DatasetID: datasetID,
			Offset:    offset,
			Limit:     limit,
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

		var result protocol.GetDatasetItemsResultPayload
		if err := protocol.DecodePayload(resp, &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		writeJSON(w, http.StatusOK, result)
	}
}

func handleMissionHistory(h *hub.Hub) http.HandlerFunc {
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

		limit := 50
		offset := 0
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
				limit = n
			}
		}
		if v := r.URL.Query().Get("offset"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n >= 0 {
				offset = n
			}
		}

		req, err := protocol.NewRequest(protocol.TypeGetMissions, &protocol.GetMissionsPayload{
			Limit:  limit,
			Offset: offset,
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

		var result protocol.GetMissionsResultPayload
		if err := protocol.DecodePayload(resp, &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid response from instance"})
			return
		}

		writeJSON(w, http.StatusOK, result)
	}
}
