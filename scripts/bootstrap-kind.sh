#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="${1:-kind}"
KIND_CONFIG="${2:-./kind-config.yaml}"
KUBECONFIG_CONTAINER="${3:-$HOME/.kube/config.docker}"

IMAGES=("area-worker:dev" "area-backend:dev")

echo "Bootstrap (alt): cluster=$CLUSTER_NAME, kind-config=$KIND_CONFIG, kubeconfig-container=$KUBECONFIG_CONTAINER"

if ! command -v kind >/dev/null 2>&1; then
  echo "kind CLI is required. Install from https://kind.sigs.k8s.io/"; exit 1
fi

if kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
  echo "Cluster '${CLUSTER_NAME}' already exists; skipping creation."
else
  echo "Creating kind cluster '${CLUSTER_NAME}'..."
  kind create cluster --name "${CLUSTER_NAME}" --config "${KIND_CONFIG}"
fi

echo "Writing container kubeconfig to ${KUBECONFIG_CONTAINER}"
kind get kubeconfig --name "${CLUSTER_NAME}" > "${KUBECONFIG_CONTAINER}"

CP_NAME="kind-control-plane"
CP_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CP_NAME" 2>/dev/null || true)
if [[ -z "$CP_IP" ]]; then
  CP_NAME=$(docker ps --format '{{.Names}}' | grep control-plane | head -n1 || true)
  CP_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CP_NAME" 2>/dev/null || true)
fi

CURRENT_SERVER=$(kubectl --kubeconfig="${KUBECONFIG_CONTAINER}" config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
if [[ -n "$CURRENT_SERVER" && ( "$CURRENT_SERVER" == *"0.0.0.0"* || "$CURRENT_SERVER" == *"127.0.0.1"* ) ]]; then
  if [[ -n "$CP_IP" ]]; then
    echo "Replacing server ${CURRENT_SERVER} -> https://${CP_IP}:6443 in ${KUBECONFIG_CONTAINER}"
    sed -i.bak "s|${CURRENT_SERVER}|https://${CP_IP}:6443|g" "${KUBECONFIG_CONTAINER}"
  else
    echo "Could not determine control-plane IP; leaving ${KUBECONFIG_CONTAINER} as-is."
  fi
else
  echo "Container kubeconfig server looks ok: ${CURRENT_SERVER}"
fi

KUBECONFIG_HOST="${HOME}/.kube/config.host"
HOST_SERVER=""
if [[ -n "$CP_NAME" ]]; then
  HOST_MAPPING=$(docker port "$CP_NAME" 6443/tcp 2>/dev/null | head -n1 || true)
  if [[ -n "$HOST_MAPPING" ]]; then
    HOST_PORT=$(echo "$HOST_MAPPING" | awk -F: '{print $NF}')
    HOST_SERVER="https://127.0.0.1:${HOST_PORT}"
  fi
fi

if [[ -n "$HOST_SERVER" ]]; then
  echo "Creating host kubeconfig at ${KUBECONFIG_HOST} pointing to ${HOST_SERVER}"
  cp "${KUBECONFIG_CONTAINER}" "${KUBECONFIG_HOST}"
  HOST_CURRENT=$(kubectl --kubeconfig="${KUBECONFIG_HOST}" config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
  if [[ -n "$HOST_CURRENT" ]]; then
    sed -i.bak "s|${HOST_CURRENT}|${HOST_SERVER}|g" "${KUBECONFIG_HOST}"
  fi
  echo "You can use host kubeconfig with: kubectl --kubeconfig=${KUBECONFIG_HOST} ..."
else
  echo "No host port mapping found for control-plane; skipping host kubeconfig generation."
fi

for img in "${IMAGES[@]}"; do
  if docker image inspect "$img" >/dev/null 2>&1; then
    echo "Loading $img into kind cluster"
    kind load docker-image "$img" --name "${CLUSTER_NAME}" || true
  else
    echo "Image $img not present locally; skipping kind load."
  fi
done

echo "Waiting for Kubernetes API to become available..."
if [[ -n "$HOST_SERVER" ]]; then
  for i in {1..30}; do
    if curl -k --silent --fail "$HOST_SERVER/readyz" >/dev/null 2>&1; then
      echo "API is ready at $HOST_SERVER"; break
    fi
    echo "  waiting for API... ($i/30)"
    sleep 2
  done
fi

if command -v docker-compose >/dev/null 2>&1; then
  echo "Starting docker-compose services (backend, runner, etc.)"
  docker-compose up -d --build
  echo "Recreating runner to ensure it attaches to networks and picks up kubeconfig"
  docker-compose up -d --force-recreate runner || true
else
  echo "docker-compose not available; please run 'docker-compose up -d --build' manually."
fi

echo "Waiting a few seconds and showing nodes via container kubeconfig"
sleep 3
kubectl --kubeconfig="${KUBECONFIG_HOST}" get nodes || true

echo "Bootstrap complete. If pods don't start, check 'docker logs area-runner' and 'kubectl --kubeconfig=${KUBECONFIG_HOST} get pods -A'."
