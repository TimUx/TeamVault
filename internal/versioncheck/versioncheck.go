package versioncheck

import (
	"strconv"
	"strings"
)

// Newer reports whether remote is a release version newer than local.
func Newer(local, remote string) bool {
	cmp, ok := Compare(local, remote)
	return ok && cmp < 0
}

// Compare compares local and remote SemVer-like versions.
// It returns -1/0/1 for local < remote, equal, local > remote and ok=false
// when either value is not a comparable release version (for example "dev").
func Compare(local, remote string) (int, bool) {
	l, ok := parse(local)
	if !ok {
		return 0, false
	}
	r, ok := parse(remote)
	if !ok {
		return 0, false
	}
	for i := 0; i < 3; i++ {
		if l.core[i] < r.core[i] {
			return -1, true
		}
		if l.core[i] > r.core[i] {
			return 1, true
		}
	}
	return comparePre(l.pre, r.pre), true
}

type version struct {
	core [3]int
	pre  string
}

func parse(s string) (version, bool) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "v")
	if s == "" {
		return version{}, false
	}
	if i := strings.IndexByte(s, '+'); i >= 0 {
		s = s[:i]
	}
	pre := ""
	if i := strings.IndexByte(s, '-'); i >= 0 {
		pre = s[i+1:]
		s = s[:i]
	}
	parts := strings.Split(s, ".")
	if len(parts) == 0 || len(parts) > 3 {
		return version{}, false
	}
	var out version
	out.pre = pre
	for i, p := range parts {
		if p == "" {
			return version{}, false
		}
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return version{}, false
		}
		out.core[i] = n
	}
	return out, true
}

func comparePre(local, remote string) int {
	if local == "" && remote == "" {
		return 0
	}
	if local == "" {
		return 1
	}
	if remote == "" {
		return -1
	}
	ls := strings.Split(local, ".")
	rs := strings.Split(remote, ".")
	for i := 0; i < len(ls) || i < len(rs); i++ {
		if i >= len(ls) {
			return -1
		}
		if i >= len(rs) {
			return 1
		}
		ln, le := strconv.Atoi(ls[i])
		rn, re := strconv.Atoi(rs[i])
		if le == nil && re == nil {
			if ln < rn {
				return -1
			}
			if ln > rn {
				return 1
			}
			continue
		}
		if le == nil {
			return -1
		}
		if re == nil {
			return 1
		}
		if ls[i] < rs[i] {
			return -1
		}
		if ls[i] > rs[i] {
			return 1
		}
	}
	return 0
}
