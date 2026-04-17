package main

import (
	"context"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/signal"
	"syscall"

	"commander/internal/auth"
	"commander/internal/keepalive"
	"commander/internal/server"
)

func main() {
	addr := flag.String("addr", ":8080", "HTTP server listen address")
	webDir := flag.String("web-dir", "", "Path to web/dist directory (defaults to web/dist relative to executable)")
	disableConfigEdit := flag.Bool("disable-config-edit", false, "Disable editing config files from the web UI")
	keepAliveSecs := flag.Int("keep-alive", 0, "Self-terminate if no keep-alive ping within N seconds (0=disabled)")
	flag.Parse()

	// Resolve web assets: use --web-dir if provided, otherwise embedded assets
	var webFS fs.FS
	webDirLabel := "(embedded)"
	if *webDir != "" {
		if _, err := os.Stat(*webDir); err != nil {
			log.Fatalf("Web directory not found at %s: %v", *webDir, err)
		}
		webFS = os.DirFS(*webDir)
		webDirLabel = *webDir
	} else {
		sub, err := fs.Sub(embeddedWeb, "web/dist")
		if err != nil {
			log.Fatalf("Failed to access embedded web assets: %v", err)
		}
		webFS = sub
	}

	// Set up optional keep-alive death clock
	var ka *keepalive.KeepAlive
	if *keepAliveSecs > 0 {
		ka = keepalive.New(*keepAliveSecs)
	}

	// Load optional auth config from env. Nil means auth is disabled.
	authCfg, err := auth.LoadFromEnv()
	if err != nil {
		log.Fatalf("Auth config: %v", err)
	}
	var authProv *auth.Provider
	if authCfg != nil {
		authProv, err = auth.NewProvider(context.Background(), authCfg)
		if err != nil {
			log.Fatalf("Auth provider init failed: %v", err)
		}
		switch authCfg.Mode {
		case auth.ModeOIDC:
			log.Printf("Auth enabled: OIDC (issuer=%s)", authCfg.IssuerURL)
		case auth.ModeBasic:
			log.Printf("Auth enabled: basic (user=%s) — OIDC is recommended for real deployments", authCfg.BasicUsername)
		}
	}

	srv, err := server.New(*addr, webFS, !*disableConfigEdit, ka, authProv)
	if err != nil {
		log.Fatalf("Failed to create server: %v", err)
	}

	// Graceful shutdown on SIGINT/SIGTERM
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		fmt.Printf("Commander listening on %s (web: %s)\n", *addr, webDirLabel)
		if err := srv.Start(); err != nil {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Start keep-alive death clock after server is running
	if ka != nil {
		ka.Start(func() {
			log.Println("Keep-alive expired, shutting down...")
			stop <- syscall.SIGTERM
		})
	}

	<-stop
	fmt.Println("\nShutting down...")
	srv.Stop()
}
