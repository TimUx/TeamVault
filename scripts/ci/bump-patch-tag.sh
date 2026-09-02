#!/usr/bin/env bash
# Create next vX.Y.Z patch tag when online help (web/static/help/) changed.
# Writes GITHUB_OUTPUT: needs_release, new_tag (if created)
set -euo pipefail

FROM="${1:?from ref}"
TO="${2:?to ref}"
OUT="${GITHUB_OUTPUT:-}"

if ! git diff --name-only "$FROM" "$TO" | grep -qE '^web/static/help/'; then
  if [[ -n "$OUT" ]]; then
    echo "needs_release=false" >> "$OUT"
  else
    echo "needs_release=false"
  fi
  echo "No online help changes between $FROM and $TO — skip patch release."
  exit 0
fi

latest="$(git tag -l 'v*' --sort=-v:refname | head -1)"
if [[ -z "$latest" ]]; then
  latest="v0.0.0"
fi

ver="${latest#v}"
major="$(echo "$ver" | cut -d. -f1)"
minor="$(echo "$ver" | cut -d. -f2)"
patch="$(echo "$ver" | cut -d. -f3 | sed 's/-.*//')"
patch=$((patch + 1))
new_tag="v${major}.${minor}.${patch}"

if git rev-parse "$new_tag" >/dev/null 2>&1; then
  echo "Tag $new_tag already exists on $TO — skip."
  if [[ -n "$OUT" ]]; then
    echo "needs_release=false" >> "$OUT"
  fi
  exit 0
fi

git tag -a "$new_tag" "$TO" -m "TeamVault ${new_tag}

Patch release: online help or embedded help images updated."

if [[ -n "$OUT" ]]; then
  echo "needs_release=true" >> "$OUT"
  echo "new_tag=$new_tag" >> "$OUT"
else
  echo "needs_release=true"
  echo "new_tag=$new_tag"
fi
echo "Created tag $new_tag"
