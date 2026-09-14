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
	"commander/internal/controlplane"
	"commander/internal/hub"
	"commander/internal/keepalive"
	"commander/internal/scheduling"
)

// Server is the main HTTP server that serves the React frontend,
// REST API, and WebSocket endpoint.
type Server struct {
	httpServer *http.Server
	hub        *hub.Hub
	scheduler  *scheduling.Scheduler
}

// New creates a new Server listening on the given address.
// webFS should be an fs.FS pointing at the web/dist directory.
// ka is an optional KeepAlive for managed lifecycle (nil to disable).
// authProv is an optional OIDC auth provider; when non-nil, all non-/ws
// traffic is gated behind a login cookie.
func New(addr string, webFS fs.FS, allowConfigEdit bool, ka *keepalive.KeepAlive, authProv *auth.Provider, publicURL string, controlStore *controlplane.Store) (*Server, error) {
	h := hub.New(allowConfigEdit)
	if controlStore != nil {
		h = hub.New(allowConfigEdit, controlStore)
	}

	// Inner mux: API + SPA + (if enabled) auth endpoints. This is what gets
	// wrapped by the auth middleware.
	innerMux := http.NewServeMux()
	api.RegisterRoutes(innerMux, h, ka, publicURL, controlStore)
	fileServer := http.FileServer(http.FS(webFS))
	innerMux.HandleFunc("/", spaFallback(webFS, fileServer))

	var protectedHandler http.Handler = innerMux
	if authProv != nil {
		authProv.RegisterRoutes(innerMux)
		protectedHandler = authProv.Middleware(innerMux)
	}

	// Outer mux: routes /ws directly to the hub (bypassing auth — it's
	// machine-to-machine for squadron instances) and forwards everything
	// else to the (optionally protected) inner mux.
	outerMux := http.NewServeMux()
	// Health probes deliberately bypass browser authentication. Readiness is
	// process-level for now; database readiness joins it with the persistent
	// control-plane store.
	outerMux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	outerMux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if controlStore != nil && controlStore.Ping(r.Context()) != nil {
			http.Error(w, "database unavailable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	coreMux := http.NewServeMux()
	coreMux.HandleFunc("/ws", h.ServeWS)
	coreMux.Handle("/", protectedHandler)
	outerMux.Handle("/", claimGate(coreMux, controlStore, authProv))

	var scheduleRunner *scheduling.Scheduler
	if controlStore != nil {
		scheduleRunner = scheduling.New(controlStore, h)
	}
	return &Server{
		httpServer: &http.Server{
			Addr:    addr,
			Handler: outerMux,
		},
		hub:       h,
		scheduler: scheduleRunner,
	}, nil
}

func claimGate(next http.Handler, store *controlplane.Store, authProv *auth.Provider) http.Handler {
	if store == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claimed, err := store.IsClaimed(r.Context())
		if err != nil {
			http.Error(w, "setup status unavailable", http.StatusServiceUnavailable)
			return
		}
		if claimed {
			next.ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/setup" || r.URL.Path == "/invite" || r.URL.Path == "/api/setup" || r.URL.Path == "/api/auth/invitation" || strings.HasPrefix(r.URL.Path, "/auth/") || isSetupAsset(r) {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method == http.MethodGet && strings.Contains(r.Header.Get("Accept"), "text/html") {
			if authProv != nil {
				http.Redirect(w, r, "/auth/login?next=/", http.StatusFound)
			} else {
				http.Redirect(w, r, "/setup", http.StatusFound)
			}
			return
		}
		http.Error(w, "command center setup is required", http.StatusServiceUnavailable)
	})
}

// isSetupAsset permits the compiled frontend resources required to render the
// otherwise-public first-run setup route. Keeping this list narrow prevents a
// fresh instance from exposing application APIs before its initial claim.
func isSetupAsset(r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	return strings.HasPrefix(r.URL.Path, "/assets/") ||
		r.URL.Path == "/favicon.svg" ||
		r.URL.Path == "/squadron-logo.svg"
}

// spaRoutePrefix lists URL prefixes that are known SPA (client-side) routes.
// Only these prefixes get the index.html fallback; everything else 404s properly.
var spaRoutePrefixes = []string{
	"/instances/",
	"/login",
	"/setup",
	"/invite",
	"/workspaces",
	"/users",
	"/service-principals",
	"/access",
	"/audit",
	"/settings",
	"/w/",
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
	s.scheduler.Start()
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
	s.scheduler.Stop()
	s.hub.Stop()
}
