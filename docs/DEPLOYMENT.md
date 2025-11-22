# Deployment — Docker, docker-compose and KinD

This document covers common ways to run the runner in containers and
Kubernetes (KinD). The repository contains `Dockerfile`, `docker-compose.yml` and helper
scripts in `./scripts` for KinD bootstrapping.

Docker image (local)

```bash
# build the image locally
npm run build-image

# run using docker (example)
docker run --rm \
  -e RUNNER_SHARED_SECRET=your-secret \
  -e REDIS_URL=redis://host:6379 \
  area-worker:dev
```

docker-compose

The repo includes `docker-compose.yml`. Use it to run a quick local
stack for development. Example:

```bash
docker compose up --build
```

KinD (Kubernetes-in-Docker)

The project contains scripts that help bootstrap a KinD cluster and
install the runner as an ephemeral job image. The `KIND_IMAGE` env var
controls the image used for the job.

Quick KinD flow (local dev):

```bash
# build image
npm run build-image

# create kind cluster and load image (the repo includes helper script)
npm run bootstrap:kind

# submit ephemeral jobs via the application. Clean up after tests:
npm run cleanup:k8s
```

Notes and tips
- Ensure `RUNNER_SHARED_SECRET` is available as an env var or Kubernetes secret when running in containers.
- When running via KinD the runner may need network access to your API endpoint; ensure the callback URL is reachable from the cluster (or use cluster DNS/port-forwarding).
- The runner supports `RUNNER_EPHEMERAL_KIND=true` to offload job execution to Kubernetes Jobs instead of running actions inline.
