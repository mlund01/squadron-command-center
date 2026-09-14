package api

import (
	"net/http/httptest"
	"strings"
	"testing"

	"commander/internal/controlplane"
)

func TestDecodeScheduleRequestAllowsEmptyName(t *testing.T) {
	actor := controlplane.User{ID: "11111111-1111-1111-1111-111111111111"}
	request := httptest.NewRequest("POST", "/", strings.NewReader(`{
		"name":"",
		"cronExpression":"0 9 * * 1-5",
		"timezone":"UTC",
		"runAsKind":"user"
	}`))
	response := httptest.NewRecorder()

	decoded, values, ok := decodeScheduleRequest(response, request, actor)
	if !ok {
		t.Fatalf("expected optional name to be accepted, got status %d and body %s", response.Code, response.Body.String())
	}
	if decoded.Name != "" || values.Name != "" {
		t.Fatalf("expected empty name to be preserved, got decoded=%q values=%q", decoded.Name, values.Name)
	}
	if values.RunAsUserID == nil || *values.RunAsUserID != actor.ID {
		t.Fatalf("expected schedule to default to the current user")
	}
}

func TestDecodeScheduleRequestStillRequiresExpression(t *testing.T) {
	actor := controlplane.User{ID: "11111111-1111-1111-1111-111111111111"}
	request := httptest.NewRequest("POST", "/", strings.NewReader(`{"runAsKind":"user"}`))
	response := httptest.NewRecorder()

	_, _, ok := decodeScheduleRequest(response, request, actor)
	if ok {
		t.Fatal("expected an empty cron expression to be rejected")
	}
	if !strings.Contains(response.Body.String(), "cron expression is required") {
		t.Fatalf("unexpected response: %s", response.Body.String())
	}
}
