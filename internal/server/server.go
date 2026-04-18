package server

import (
	"context"
	"fmt"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"commander/internal/api"
	"commander/internal/auth"
	"commander/internal/hub"
	"commander/internal/keepalive"
)

// Server is the main HTTP server that serves the React frontend,
// REST API, and WebSocket endpoint.
type Server struct {
	httpServer *http.Server
	hub        *hub.Hub
}

// New creates a new Server listening on the given address.
// webFS should be an fs.FS pointing at the web/dist directory.
// ka is an optional KeepAlive for managed lifecycle (nil to disable).
// authProv is an optional OIDC auth provider; when non-nil, all non-/ws
// traffic is gated behind a login cookie.
func New(addr string, webFS fs.FS, allowConfigEdit bool, ka *keepalive.KeepAlive, authProv *auth.Provider) (*Server, error) {
	h := hub.New(allowConfigEdit)

	// Inner mux: API + SPA + (if enabled) auth endpoints. This is what gets
	// wrapped by the auth middleware.
	innerMux := http.NewServeMux()
	api.RegisterRoutes(innerMux, h, ka)
	fileServer := http.FileServer(http.FS(webFS))
	innerMux.HandleFunc("/", spaFallback(webFS, fileServer))

	var protectedHandler http.Handler = innerMux
	if authProv != nil {
		authProv.RegisterRoutes(innerMux)
		protectedHandler = authProv.Middleware(innerMux)
	}

	// Outer mux: routes /ws directly to the hub (bypassing auth — it's
	// machine-to-machine for squadron instances) and forwards everything
	// else to the (optionally protected) inner mux. /oauth/callback is also
	// unauthenticated so OAuth IdPs (which don't carry session cookies) can
	// reach it; security comes from the state parameter being unguessable
	// and single-use.
	outerMux := http.NewServeMux()
	outerMux.HandleFunc("/ws", h.ServeWS)
	outerMux.HandleFunc("GET /oauth/callback", api.HandleOAuthCallback(h))
	outerMux.Handle("/", protectedHandler)

	return &Server{
		httpServer: &http.Server{
			Addr:    addr,
			Handler: outerMux,
		},
		hub: h,
	}, nil
}

// spaRoutePrefix lists URL prefixes that are known SPA (client-side) routes.
// Only these prefixes get the index.html fallback; everything else 404s properly.
var spaRoutePrefixes = []string{
	"/instances/",
}

// spaFallback serves static files, falling back to index.html for SPA routes.
func spaFallback(distFS fs.FS, fileServer http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		if path == "/" {
			fileServer.ServeHTTP(w, r)
			return
		}

		// Check if the file exists in the embedded FS (JS, CSS, images, etc.)
		if _, err := fs.Stat(distFS, path[1:]); err == nil {
			fileServer.ServeHTTP(w, r)
			return
		}

		// SPA fallback: only serve index.html for known client-side route prefixes
		for _, prefix := range spaRoutePrefixes {
			if strings.HasPrefix(path, prefix) {
				r.URL.Path = "/"
				fileServer.ServeHTTP(w, r)
				return
			}
		}

		http.NotFound(w, r)
	}
}

// Start begins listening for HTTP connections.
func (s *Server) Start() error {
	s.hub.Start()
	if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("listen: %w", err)
	}
	return nil
}

// Stop gracefully shuts down the server.
func (s *Server) Stop() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	s.httpServer.Shutdown(ctx)
	s.hub.Stop()
}
