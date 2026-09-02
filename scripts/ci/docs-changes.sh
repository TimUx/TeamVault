#!/usr/bin/env bash
# Classify git diff between two refs for docs workflow decisions.
# Writes GITHUB_OUTPUT keys: help_changed, ui_changed, docs_md_changed
set -euo pipefail

FROM="${1:?from ref}"
TO="${2:?to ref}"
OUT="${GITHUB_OUTPUT:-}"

changed="$(git diff --name-only "$FROM" "$TO" 2>/dev/null || true)"

help_changed=false
ui_changed=false
docs_md_changed=false

while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  case "$f" in
    web/static/help/*) help_changed=true ;;
    web/static/*) ui_changed=true ;;
    docs/*.md|docs/planning/*.md) docs_md_changed=true ;;
  esac
done <<< "$changed"

write_out() {
  if [[ -n "$OUT" ]]; then
    echo "help_changed=$help_changed" >> "$OUT"
    echo "ui_changed=$ui_changed" >> "$OUT"
    echo "docs_md_changed=$docs_md_changed" >> "$OUT"
  else
    echo "help_changed=$help_changed"
    echo "ui_changed=$ui_changed"
    echo "docs_md_changed=$docs_md_changed"
  fi
}

write_out
