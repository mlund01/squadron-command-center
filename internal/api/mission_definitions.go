package api

import (
	"net/http"

	"commander/internal/hub"
	"github.com/mlund01/squadron-wire/protocol"
)

type missionDefinitionRequest struct {
	MissionName string `json:"missionName"`
}

func handleMissionDefinition(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		instance := h.GetRegistry().GetInstanceByWorkspaceID(r.PathValue("id"))
		if instance == nil || !instance.Connected {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Connect the workspace runner to view raw configuration."})
			return
		}
		req, err := protocol.NewRequest("get_mission_definition", missionDefinitionRequest{MissionName: r.PathValue("name")})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Unable to create request."})
			return
		}
		resp, err := h.SendRequest(instance.ID, req, proxyTimeout)
		if err != nil {
			writeJSON(w, http.StatusGatewayTimeout, map[string]string{"error": "The runner did not respond. Check its connection and version."})
			return
		}
		if resp.Type == protocol.TypeError {
			var failure protocol.ErrorPayload
			if protocol.DecodePayload(resp, &failure) != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Invalid runner response."})
				return
			}
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": failure.Message})
			return
		}
		if resp.Type != "mission_definition_result" {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Update Squadron to view raw mission configuration."})
			return
		}
		var result map[string]any
		if protocol.DecodePayload(resp, &result) != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Invalid runner response."})
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, result)
	}
}
