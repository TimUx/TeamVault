package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/buildinfo"
	"github.com/teamvault/teamvault/internal/server"
)

func main() {
	addr := flag.String("addr", envOr("TEAMVAULT_ADDR", ":8080"), "listen address")
	dataDir := flag.String("data", envOr("TEAMVAULT_DATA_DIR", "./data"), "data directory")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("%s %s (%s)\n", buildinfo.Product, buildinfo.Version, buildinfo.Commit)
		fmt.Printf("Developer: %s\n", buildinfo.Developer)
		return
	}

	log.SetFlags(0)
	app, err := bootstrap.Run(bootstrap.Options{DataDir: *dataDir})
	if err != nil {
		log.Fatalf("bootstrap failed: %v", err)
	}
	defer app.Vault.Close()

	api := server.New(app)
	srv := &http.Server{
		Addr:              *addr,
		Handler:           api.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	fmt.Printf("%s %s listening on %s (initialized=%v)\n", buildinfo.Product, buildinfo.Version, *addr, app.Config.Initialized)
	if server.TrustForwardedEnabled() {
		log.Println("WARN: TEAMVAULT_TRUST_FORWARDED is enabled — only use behind a trusted reverse proxy")
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Println(err)
		os.Exit(1)
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
