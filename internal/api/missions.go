package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/mlund01/squadron-wire/protocol"

	"commander/internal/auth"
	"commander/internal/controlplane"
	"commander/internal/hub"
)

const proxyTimeout = 30 * time.Second

type missionRunProxy interface {
	GetRegistry() *hub.Registry
	SendRequest(string, *protocol.Envelope, time.Duration) (*protocol.Envelope, error)
}

func handleRunMission(h missionRunProxy, stores ...AuthorizationStore) http.HandlerFunc {
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
			Inputs             map[string]string `json:"inputs"`
			ServicePrincipalID string            `json:"servicePrincipalId"`
		}
		if r.Body != nil {
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
				return
			}
		}
		if body.Inputs == nil {
			body.Inputs = make(map[string]string)
		}

		var actor controlplane.User
		var actorServicePrincipal string
		var runAsServicePrincipal bool
		if len(stores) > 0 && stores[0] != nil && instance.WorkspaceID != "" {
			session := auth.SessionFromContext(r.Context())
			var allowed bool
			var err error
			if session != nil && session.Kind == "service_principal" {
				if body.ServicePrincipalID != "" {
					writeJSON(w, http.StatusBadRequest, map[string]string{"error": "service principals cannot select another run identity"})
					return
				}
				actorServicePrincipal = session.Sub
				allowed, err = stores[0].CanRunMissionServicePrincipal(r.Context(), session.Sub, instance.WorkspaceID, missionName)
			} else {
				var ok bool
				actor, ok = currentControlPlaneUser(w, r, stores[0])
				if !ok {
					return
				}
				if body.ServicePrincipalID != "" {
					actorServicePrincipal = body.ServicePrincipalID
					runAsServicePrincipal = true
					allowed, err = stores[0].CanUserRunAsServicePrincipal(r.Context(), actor, body.ServicePrincipalID, instance.WorkspaceID, missionName)
				} else {
					allowed, err = stores[0].CanRunMission(r.Context(), actor, instance.WorkspaceID, missionName)
				}
			}
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "authorization unavailable"})
				return
			}
			if !allowed {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "Run permission is required for this mission"})
				return
			}
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
		if len(stores) > 0 && stores[0] != nil && instance.WorkspaceID != "" && actor.ID != "" && !runAsServicePrincipal {
			if err := stores[0].RecordMissionRunActor(r.Context(), actor, instance.WorkspaceID, ack.MissionID, missionName); err != nil {
				log.Printf("record mission run actor: %v", err)
			}
		}
		if len(stores) > 0 && stores[0] != nil && instance.WorkspaceID != "" && actor.ID != "" && runAsServicePrincipal {
			if err := stores[0].RecordMissionRunAsServicePrincipal(r.Context(), actor, actorServicePrincipal, instance.WorkspaceID, ack.MissionID, missionName); err != nil {
				log.Printf("record run-as service principal mission actor: %v", err)
			}
		}
		if len(stores) > 0 && stores[0] != nil && instance.WorkspaceID != "" && actorServicePrincipal != "" && actor.ID == "" {
			if err := stores[0].RecordMissionRunServicePrincipal(r.Context(), actorServicePrincipal, instance.WorkspaceID, ack.MissionID, missionName); err != nil {
				log.Printf("record service principal mission run actor: %v", err)
			}
		}

		writeJSON(w, http.StatusAccepted, map[string]string{
			"missionId": ack.MissionID,
			"status":    "started",
		})
	}
}

func handleMissionRunIdentities(h *hub.Hub, store AuthorizationStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instance := h.GetRegistry().GetInstance(r.PathValue("id"))
		if instance == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "instance not found"})
			return
		}
		if store == nil || instance.WorkspaceID == "" {
			writeJSON(w, http.StatusOK, map[string]any{"identities": []controlplane.MissionRunIdentity{}})
			return
		}
		session := auth.SessionFromContext(r.Context())
		if session == nil || session.Kind == "service_principal" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "user access is required"})
			return
		}
		actor, ok := currentControlPlaneUser(w, r, store)
		if !ok {
			return
		}
		identities, err := store.ListMissionRunIdentities(r.Context(), actor, instance.WorkspaceID, r.PathValue("name"))
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "authorization unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"identities": identities})
	}
}

func handleStopMission(h *hub.Hub, stores ...AuthorizationStore) http.HandlerFunc {
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
		if len(stores) > 0 && stores[0] != nil && instance.WorkspaceID != "" {
			session := auth.SessionFromContext(r.Context())
			var allowed bool
			var err error
			if session != nil && session.Kind == "service_principal" {
				allowed, err = stores[0].CanControlMissionRunServicePrincipal(r.Context(), session.Sub, instance.WorkspaceID, missionID)
			} else {
				actor, ok := currentControlPlaneUser(w, r, stores[0])
				if !ok {
					return
				}
				allowed, err = stores[0].CanControlMissionRun(r.Context(), actor, instance.WorkspaceID, missionID)
			}
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "authorization unavailable"})
				return
			}
			if !allowed {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "You may only control runs you started"})
				return
			}
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

func handleResumeMission(h *hub.Hub, stores ...AuthorizationStore) http.HandlerFunc {
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
		if len(stores) > 0 && stores[0] != nil && instance.WorkspaceID != "" {
			session := auth.SessionFromContext(r.Context())
			var allowed bool
			var err error
			if session != nil && session.Kind == "service_principal" {
				allowed, err = stores[0].CanControlMissionRunServicePrincipal(r.Context(), session.Sub, instance.WorkspaceID, missionID)
			} else {
				actor, ok := currentControlPlaneUser(w, r, stores[0])
				if !ok {
					return
				}
				allowed, err = stores[0].CanControlMissionRun(r.Context(), actor, instance.WorkspaceID, missionID)
			}
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "authorization unavailable"})
				return
			}
			if !allowed {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "You may only control runs you started"})
				return
			}
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
