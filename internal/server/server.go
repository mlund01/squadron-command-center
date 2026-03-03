package server

import (
	"context"
	"fmt"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"commander/internal/api"
	"commander/internal/hub"
)

// Server is the main HTTP server that serves the React frontend,
// REST API, and WebSocket endpoint.
type Server struct {
	httpServer *http.Server
	hub        *hub.Hub
}

// New creates a new Server listening on the given address.
// webFS should be an fs.FS pointing at the web/dist directory.
func New(addr string, webFS fs.FS, allowConfigEdit bool) (*Server, error) {
	h := hub.New(allowConfigEdit)
	mux := http.NewServeMux()

	// WebSocket endpoint for squadron instances
	mux.HandleFunc("/ws", h.ServeWS)

	// REST API routes
	api.RegisterRoutes(mux, h)

	// Serve React frontend with SPA fallback
	fileServer := http.FileServer(http.FS(webFS))
	mux.HandleFunc("/", spaFallback(webFS, fileServer))

	return &Server{
		httpServer: &http.Server{
			Addr:    addr,
			Handler: mux,
		},
		hub: h,
	}, nil
}

// spaFallback serves static files, falling back to index.html for SPA routes.
func spaFallback(distFS fs.FS, fileServer http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// Don't intercept API or WS paths — let them 404 properly
		if strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/ws") {
			http.NotFound(w, r)
			return
		}

		if path == "/" {
			fileServer.ServeHTTP(w, r)
			return
		}

		// Check if the file exists in the embedded FS
		if _, err := fs.Stat(distFS, path[1:]); err == nil {
			fileServer.ServeHTTP(w, r)
			return
		}

		// SPA fallback: serve index.html for unmatched routes
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
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
