package backend

import (
	"encoding/json"
	"runtime"
	"strings"

	"github.com/teamvault/teamvault/internal/versioncheck"
)

// UpdateInfo describes the update state for the local desktop client.
type UpdateInfo struct {
	Current     string `json:"current"`
	Latest      string `json:"latest"`
	Update      bool   `json:"update"`
	DownloadURL string `json:"download_url,omitempty"`
}

type desktopArtifact struct {
	Name     string `json:"name"`
	Platform string `json:"platform"`
	Arch     string `json:"arch"`
	Kind     string `json:"kind"`
	URL      string `json:"url"`
}

type desktopDownloads struct {
	Desktop []desktopArtifact `json:"desktop"`
}

// CheckForUpdate queries the configured TeamVault server and compares its
// release version with the local desktop client version.
func CheckForUpdate(serverURL, current string) (UpdateInfo, error) {
	c, err := NewClient(serverURL, "")
	if err != nil {
		return UpdateInfo{}, err
	}
	info, err := c.GetJSON("/api/version")
	if err != nil {
		return UpdateInfo{}, err
	}
	latest, _ := info["version"].(string)
	out := UpdateInfo{Current: current, Latest: latest, Update: versioncheck.Newer(current, latest)}
	if out.Update {
		out.DownloadURL = desktopDownloadURL(c)
	}
	return out, nil
}

func desktopDownloadURL(c *Client) string {
	raw, err := c.GetRaw("/api/client-downloads")
	if err != nil {
		return ""
	}
	var dl desktopDownloads
	if json.Unmarshal(raw, &dl) != nil {
		return ""
	}
	best := ""
	bestRank := -1
	for _, a := range dl.Desktop {
		if a.Platform != runtime.GOOS || a.Arch != runtime.GOARCH || a.URL == "" {
			continue
		}
		rank := desktopArtifactRank(a.Kind)
		if rank > bestRank {
			best = absoluteDownloadURL(c.BaseURL(), a.URL)
			bestRank = rank
		}
	}
	return best
}

func desktopArtifactRank(kind string) int {
	switch {
	case runtime.GOOS == "windows" && kind == "installer":
		return 3
	case runtime.GOOS == "linux" && kind == "appimage":
		return 3
	case kind == "portable":
		return 2
	default:
		return 1
	}
}

func absoluteDownloadURL(base, ref string) string {
	if ref == "" || strings.HasPrefix(ref, "http://") || strings.HasPrefix(ref, "https://") {
		return ref
	}
	return strings.TrimRight(base, "/") + "/" + strings.TrimLeft(ref, "/")
}
