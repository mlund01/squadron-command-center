package api

import (
	"encoding/json"
	"fmt"
	"html"
	"log"
	"net/http"
	"time"

	"github.com/mlund01/squadron-wire/protocol"

	"commander/internal/hub"
)

// HandleOAuthCallback serves GET /oauth/callback, the public URL IdPs
// redirect the user's browser to after authorization. The callback is
// routed to the right squadron instance via the cryptographic `state`
// value (which squadron reserved in advance via OAuthRegisterFlow).
//
// This handler is intentionally unauthenticated — IdPs do not carry
// commander session cookies. Security comes from the state value being
// unguessable and single-use.
func HandleOAuthCallback(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		state := q.Get("state")
		code := q.Get("code")
		idpErr := q.Get("error")
		if idpErrDesc := q.Get("error_description"); idpErrDesc != "" && idpErr != "" {
			idpErr = idpErr + ": " + idpErrDesc
		}

		if state == "" {
			writeOAuthErrorPage(w, "callback missing state parameter")
			return
		}

		flow, ok := h.PendingFlows().Claim(state)
		if !ok {
			writeOAuthErrorPage(w, "no matching OAuth flow (it may have expired)")
			return
		}

		// Forward to the originating squadron.
		env, err := protocol.NewRequest(protocol.TypeOAuthCallbackDelivery, &protocol.OAuthCallbackDeliveryPayload{
			State: state,
			Code:  code,
			Error: idpErr,
		})
		if err != nil {
			writeOAuthErrorPage(w, "internal error building delivery: "+err.Error())
			return
		}
		resp, err := h.SendRequest(flow.InstanceID, env, 30*time.Second)
		if err != nil {
			writeOAuthErrorPage(w, "failed to deliver callback to squadron: "+err.Error())
			return
		}
		if resp.Type == protocol.TypeError {
			var perr protocol.ErrorPayload
			_ = protocol.DecodePayload(resp, &perr)
			writeOAuthErrorPage(w, "squadron rejected callback: "+perr.Message)
			return
		}

		// Notify any open commander tabs for this instance.
		success := idpErr == "" && code != ""
		noteType := "oauth_completed"
		if !success {
			noteType = "oauth_failed"
		}
		h.Notifications().Publish(flow.InstanceID, hub.Notification{
			Type: noteType,
			Data: map[string]interface{}{
				"mcpName": flow.McpName,
				"error":   idpErr,
			},
		})

		if success {
			writeOAuthSuccessPage(w, flow.McpName)
		} else {
			writeOAuthErrorPage(w, idpErr)
		}
	}
}

// HandleStartOAuth kicks off a commander-initiated OAuth login for the
// named MCP server on the specified squadron. Returns the authorization URL
// for the browser to open in a new tab.
func HandleStartOAuth(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		mcpName := r.PathValue("name")

		env, err := protocol.NewRequest(protocol.TypeStartMCPLogin, &protocol.StartMCPLoginPayload{
			McpName: mcpName,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		resp, err := h.SendRequest(instanceID, env, 30*time.Second)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		if resp.Type == protocol.TypeError {
			var perr protocol.ErrorPayload
			_ = protocol.DecodePayload(resp, &perr)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": perr.Message})
			return
		}
		var ack protocol.StartMCPLoginAckPayload
		if err := protocol.DecodePayload(resp, &ack); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if !ack.Accepted {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": ack.Reason})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"authUrl": ack.AuthURL})
	}
}

// HandleNotifications opens an SSE stream of per-instance notifications
// (e.g. oauth_completed). Used by the commander SPA to surface toasts.
func HandleNotifications(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instanceID := r.PathValue("id")
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")

		ch, cleanup := h.Notifications().Subscribe(instanceID)
		defer cleanup()

		// Initial comment line so the connection is flushed immediately.
		fmt.Fprint(w, ": connected\n\n")
		flusher.Flush()

		keepalive := time.NewTicker(30 * time.Second)
		defer keepalive.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case note, ok := <-ch:
				if !ok {
					return
				}
				data, err := json.Marshal(note)
				if err != nil {
					log.Printf("notification marshal: %v", err)
					continue
				}
				fmt.Fprintf(w, "data: %s\n\n", data)
				flusher.Flush()
			case <-keepalive.C:
				fmt.Fprint(w, ": keepalive\n\n")
				flusher.Flush()
			}
		}
	}
}

func writeOAuthSuccessPage(w http.ResponseWriter, mcpName string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = fmt.Fprintf(w, `<!doctype html>
<html><head><title>Authorized</title></head>
<body style="font-family:system-ui;padding:3rem;max-width:40rem;margin:auto">
<h1>Authorization complete</h1>
<p>%s is now connected. You can close this window.</p>
<script>setTimeout(function(){window.close();},2000);</script>
</body></html>`, html.EscapeString(mcpName))
}

func writeOAuthErrorPage(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusBadRequest)
	_, _ = fmt.Fprintf(w, `<!doctype html>
<html><head><title>Authorization failed</title></head>
<body style="font-family:system-ui;padding:3rem;max-width:40rem;margin:auto">
<h1>Authorization failed</h1>
<p>%s</p>
<p>You can close this window and try again from the command center UI.</p>
</body></html>`, html.EscapeString(msg))
}
