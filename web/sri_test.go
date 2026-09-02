package web

import (
	"strings"
	"testing"
)

func TestInjectScriptIntegrity(t *testing.T) {
	html := []byte(`<script src="/cryptocore.js"></script><script src="/vault/app.js"></script>`)
	sri := map[string]string{
		"cryptocore.js": "sha384-aaa",
		"app.js":        "sha384-bbb",
	}
	out := string(injectScriptIntegrity(html, sri))
	if !strings.Contains(out, `src="/cryptocore.js" integrity="sha384-aaa" crossorigin="anonymous"`) {
		t.Fatalf("cryptocore: %s", out)
	}
	if !strings.Contains(out, `src="/vault/app.js" integrity="sha384-bbb" crossorigin="anonymous"`) {
		t.Fatalf("app: %s", out)
	}
}
