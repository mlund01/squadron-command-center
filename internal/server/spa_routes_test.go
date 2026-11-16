package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestIdentityManagementRoutesUseSPAFallback(t *testing.T) {
	assets := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("command center app")}}
	handler := spaFallback(assets, http.FileServer(http.FS(assets)))
	for _, path := range []string{"/profile", "/service-principals/49fdb7f1-c441-48ba-ad2c-28f27a6c9bd9"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK || response.Body.String() != "command center app" {
			t.Errorf("%s: status = %d, body = %q", path, response.Code, response.Body.String())
		}
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/unrelated", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("unrelated path status = %d", response.Code)
	}
}
