#!/usr/bin/env bash
set -euo pipefail

# push.sh - create and push a git tag, then push with --follow-tags
# Usage: ./push.sh <tag> [message]
# Environment:
#   ALLOW_DIRTY=1  - allow creating a tag even if working tree is dirty

if [[ ${#} -lt 1 ]]; then
  echo "Usage: $0 <tag> [message]"
  exit 2
fi

TAG="$1"

case "$TAG" in
  v*) ;;
  *) TAG="v$TAG" ;;
esac

MESSAGE="${2:-"Release $TAG"}"

if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "Not a git repository (or no git installed)."
  exit 3
fi

if git rev-parse "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "Tag '$TAG' already exists. Aborting."
  exit 4
fi

if [[ "${ALLOW_DIRTY:-0}" != "1" ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree is dirty. Commit or set ALLOW_DIRTY=1 to proceed."
    git status --porcelain
    exit 5
  fi
fi

git tag -a "$TAG" -m "$MESSAGE"

echo "Pushing tag '$TAG'..."

git push origin "refs/tags/$TAG"

git push --follow-tags

echo "Tag '$TAG' created and pushed successfully."
exit 0
