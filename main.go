package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"commander/internal/server"
)

func main() {
	addr := flag.String("addr", ":8080", "HTTP server listen address")
	webDir := flag.String("web-dir", "", "Path to web/dist directory (defaults to web/dist relative to executable)")
	disableConfigEdit := flag.Bool("disable-config-edit", false, "Disable editing config files from the web UI")
	flag.Parse()

	// Resolve web directory
	dir := *webDir
	if dir == "" {
		exe, err := os.Executable()
		if err != nil {
			log.Fatalf("Failed to find executable path: %v", err)
		}
		dir = filepath.Join(filepath.Dir(exe), "web", "dist")
	}

	if _, err := os.Stat(dir); err != nil {
		log.Fatalf("Web directory not found at %s: %v", dir, err)
	}

	srv, err := server.New(*addr, os.DirFS(dir), !*disableConfigEdit)
	if err != nil {
		log.Fatalf("Failed to create server: %v", err)
	}

	// Graceful shutdown on SIGINT/SIGTERM
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		fmt.Printf("Commander listening on %s (web: %s)\n", *addr, dir)
		if err := srv.Start(); err != nil {
			log.Fatalf("Server error: %v", err)
		}
	}()

	<-stop
	fmt.Println("\nShutting down...")
	srv.Stop()
}
