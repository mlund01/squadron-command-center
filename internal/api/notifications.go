package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"commander/internal/hub"
)

// handleListNotifications returns the recent mission-lifecycle notifications
// buffered for an instance so a freshly-opened browser can backfill without a
// database. Newest last.
func handleListNotifications(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		conn := h.GetConnection(instanceID)
		if conn == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "instance disconnected"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"notifications": conn.RecentNotifications()})
	}
}

// handleStreamNotifications is an SSE endpoint pushing every mission-lifecycle
// notification for the given squadron to the browser as it happens.
func handleStreamNotifications(h *hub.Hub) http.HandlerFunc {
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
		w.Header().Set("X-Accel-Buffering", "no")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming not supported", http.StatusInternalServerError)
			return
		}

		fmt.Fprintf(w, ": open %d\n\n", time.Now().Unix())
		flusher.Flush()

		ch, cleanup := conn.SubscribeNotifications()
		defer cleanup()

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
					log.Printf("notification SSE marshal: %v", err)
					continue
				}
				fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Event, data)
				flusher.Flush()
			}
		}
	}
}
