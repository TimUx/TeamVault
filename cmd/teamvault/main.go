package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/teamvault/teamvault/internal/bootstrap"
	"github.com/teamvault/teamvault/internal/server"
)

func main() {
	addr := flag.String("addr", envOr("TEAMVAULT_ADDR", ":8080"), "listen address")
	dataDir := flag.String("data", envOr("TEAMVAULT_DATA_DIR", "./data"), "data directory")
	flag.Parse()

	log.SetFlags(0)
	app, err := bootstrap.Run(bootstrap.Options{DataDir: *dataDir})
	if err != nil {
		log.Fatalf("bootstrap failed: %v", err)
	}
	defer app.Vault.Close()

	api := server.New(app)
	fmt.Printf("teamVault listening on %s (initialized=%v)\n", *addr, app.Config.Initialized)
	if err := http.ListenAndServe(*addr, api.Handler()); err != nil {
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
