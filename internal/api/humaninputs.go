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
	"commander/internal/hub"
)

// Human-in-the-loop (ask_human) endpoints. Commander is a pure proxy:
// squadron owns the records, the mission event stream carries live
// updates. These handlers translate REST requests into wire RPCs.

func handleListHumanInputs(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		conn := h.GetConnection(instanceID)
		if conn == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		q := r.URL.Query()
		payload := protocol.GetHumanInputsPayload{
			State:       q.Get("state"),
			MissionID:   q.Get("missionId"),
			OldestFirst: q.Get("order") != "newest",
		}
		if v := q.Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				payload.Limit = n
			}
		}
		if v := q.Get("offset"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n >= 0 {
				payload.Offset = n
			}
		}

		reqEnv, err := protocol.NewRequest(protocol.TypeGetHumanInputs, &payload)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		resp, err := h.SendRequest(instanceID, reqEnv, proxyTimeout)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}
		if resp.Type == protocol.TypeError {
			var errPayload protocol.ErrorPayload
			_ = protocol.DecodePayload(resp, &errPayload)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": errPayload.Message})
			return
		}
		var result protocol.GetHumanInputsResultPayload
		if err := protocol.DecodePayload(resp, &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"humanInputs": result.HumanInputs,
			"total":       result.Total,
		})
	}
}

func handleResolveHumanInput(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		toolCallID := r.PathValue("callId")

		conn := h.GetConnection(instanceID)
		if conn == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		var body struct {
			Response string `json:"response"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		if body.Response == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "response is required"})
			return
		}

		reqEnv, err := protocol.NewRequest(protocol.TypeResolveHumanInput, &protocol.ResolveHumanInputPayload{
			ToolCallID:      toolCallID,
			Response:        body.Response,
			ResponderUserID: responderIDFromRequest(r),
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		resp, err := h.SendRequest(instanceID, reqEnv, proxyTimeout)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}
		if resp.Type == protocol.TypeError {
			var errPayload protocol.ErrorPayload
			_ = protocol.DecodePayload(resp, &errPayload)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": errPayload.Message})
			return
		}
		var result protocol.ResolveHumanInputResultPayload
		if err := protocol.DecodePayload(resp, &result); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if !result.Accepted {
			status := http.StatusBadGateway
			if result.Reason == "not found" {
				status = http.StatusNotFound
			}
			writeJSON(w, status, map[string]string{"error": result.Reason})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"humanInput": result.HumanInput})
	}
}

// handleStreamHumanInputs is an SSE endpoint that pushes every
// human_input_requested / human_input_resolved mission event for the
// given squadron to the browser as it happens. Browsers get instant
// alerts without polling, and the stream survives background-tab
// throttling the way EventSource connections do.
//
// Commander already subscribes globally to squadron events on register,
// so by the time the browser opens this stream, the hub is seeing every
// relevant event in real time; we just fan them out to the SSE client.
func handleStreamHumanInputs(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		conn := h.GetConnection(instanceID)
		if conn == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering
		w.Header().Set("Access-Control-Allow-Origin", "*")

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming not supported", http.StatusInternalServerError)
			return
		}

		// Send an opening comment so proxies don't buffer the first
		// real event, and the client sees the connection is live.
		fmt.Fprintf(w, ": open %d\n\n", time.Now().Unix())
		flusher.Flush()

		ch, cleanup := conn.SubscribeHumanInputEvents()
		defer cleanup()

		// Keepalive pulses prevent intermediaries (and some browsers)
		// from closing an idle stream after ~30s of silence.
		pulse := time.NewTicker(20 * time.Second)
		defer pulse.Stop()

		ctx := r.Context()
		for {
			select {
			case <-ctx.Done():
				return
			case <-pulse.C:
				fmt.Fprintf(w, ": ping %d\n\n", time.Now().Unix())
				flusher.Flush()
			case ev, ok := <-ch:
				if !ok {
					return
				}
				data, err := json.Marshal(ev)
				if err != nil {
					log.Printf("human-input SSE marshal: %v", err)
					continue
				}
				fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.EventType, data)
				flusher.Flush()
			}
		}
	}
}

// responderIDFromRequest returns a stable identifier for the user who
// submitted the response. Falls back gracefully when auth is disabled so
// local dev still works.
func responderIDFromRequest(r *http.Request) string {
	sess := auth.SessionFromContext(r.Context())
	if sess == nil {
		return ""
	}
	if sess.Sub != "" {
		return sess.Sub
	}
	return sess.Email
}
