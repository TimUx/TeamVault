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
		}
		if strings.HasPrefix(path, "/") {
			r.URL.Path = path
		}
		fileServer.ServeHTTP(w, r)
	})
}
