package web

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed static/*
var staticFS embed.FS

func Handler() http.Handler {
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		switch path {
		case "/", "/setup", "/login", "/onboard", "/app":
			http.ServeFileFS(w, r, sub, "index.html")
			return
		case "/help", "/help/":
			http.ServeFileFS(w, r, sub, "help/index.html")
			return
		case "/help/cli", "/help/cli/":
			http.ServeFileFS(w, r, sub, "help/cli.html")
			return
		case "/help/extension", "/help/extension/":
			http.ServeFileFS(w, r, sub, "help/extension.html")
			return
		}
		if strings.HasPrefix(path, "/") {
			r.URL.Path = path
		}
		fileServer.ServeHTTP(w, r)
	})
}
