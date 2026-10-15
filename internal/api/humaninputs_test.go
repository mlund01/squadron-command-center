package api

import (
	"net/http"
	"testing"
)

func TestHumanInputResolveStatus(t *testing.T) {
	cases := map[string]int{
		"not found":        http.StatusNotFound,
		"already resolved": http.StatusConflict,
		"expired":          http.StatusGone,
		"unexpected":       http.StatusBadGateway,
	}
	for reason, want := range cases {
		if got := humanInputResolveStatus(reason); got != want {
			t.Errorf("reason %q: got %d, want %d", reason, got, want)
		}
	}
}
