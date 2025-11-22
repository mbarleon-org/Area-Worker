#!/usr/bin/env bash
set -euo pipefail

AUTO_YES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      AUTO_YES=true
      shift
      ;;
    *)
      break
      ;;
  esac
done

CLUSTER_NAME="${1:-kind}"
KUBECONFIG_FILE="${2:-$HOME/.kube/config.docker}"
KUBECONFIG_HOST_FILE="${3:-$HOME/.kube/config.host}"

echo "This script will:
 - stop docker-compose services
 - delete kind cluster '$CLUSTER_NAME'
 - backup and remove kubeconfig: $KUBECONFIG_FILE, $KUBECONFIG_HOST_FILE
"

if [[ "$AUTO_YES" == false ]]; then
  read -rp "Proceed? [y/N] " CONFIRM
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Aborted by user."
    exit 0
  fi
else
  echo "Auto-confirm enabled (-y). Proceeding..."
fi

echo "Stopping docker-compose services (if any)..."
if command -v docker-compose >/dev/null 2>&1; then
  docker-compose down --remove-orphans || true
else
  echo "docker-compose not found, skipping compose shutdown."
fi

echo "Deleting kind cluster '$CLUSTER_NAME'..."
if command -v kind >/dev/null 2>&1; then
  kind delete cluster --name "$CLUSTER_NAME" || true
else
  echo "kind not installed, skipping kind delete."
fi

if [[ -f "$KUBECONFIG_FILE" ]]; then
  BACKUP="$KUBECONFIG_FILE.backup.$(date +%s)"
  echo "Backing up existing kubeconfig to $BACKUP"
  mv "$KUBECONFIG_FILE" "$BACKUP"
else
  echo "No kubeconfig found at $KUBECONFIG_FILE"
fi

if [[ -f "$KUBECONFIG_HOST_FILE" ]]; then
  BACKUP="$KUBECONFIG_HOST_FILE.backup.$(date +%s)"
  echo "Backing up existing kubeconfig to $BACKUP"
  mv "$KUBECONFIG_HOST_FILE" "$BACKUP"
else
  echo "No kubeconfig found at $KUBECONFIG_HOST_FILE"
fi

echo "Cleanup complete."
exit 0
