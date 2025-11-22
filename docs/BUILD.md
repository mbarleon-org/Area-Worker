# Build & Run — Area Runner

Prerequisites
- Node.js 18+ (global `fetch` is required)
- npm (or yarn)
- Docker (optional, for images)
- kubectl / kind (optional, for KinD)

Install

```bash
npm ci
```

Type-check and build

```bash
npx tsc -p tsconfig.json
npm run build    # project has a `build` script which runs tsc
```

Run locally (development)

You can run the runner directly using `ts-node` or after building the
JS output under `dist`.

Using `ts-node` (fast iterate):

```bash
npx ts-node src/index.ts
```

Using the compiled build (recommended for production-like runs):

```bash
npm run build
node dist/src/index.js
```

Configuration (environment variables)
- `RUNNER_SHARED_SECRET` (required): secret used to compute HMAC tokens for callbacks.
- `RUNNER_API_URL` (optional): override API base URL used to fetch workflows/credentials.
- `WORKFLOW_POLL_MS` (optional): poll interval (ms), default `5000`.
- `REDIS_URL` (optional): default `redis://localhost:6379`.
- `WORKFLOW_STREAM` (optional): Redis stream name (default `workflow_jobs`).
- `WORKFLOW_CONSUMER_GROUP`, `WORKFLOW_CONSUMER_NAME`: defaults are `workflow-runners` and `runner-<pid>` respectively.
- `RUNNER_EPHEMERAL_KIND` (optional): when `true`, the runner will submit ephemeral KinD jobs instead of executing inline.
- `KIND_IMAGE`, `KIND_NAMESPACE`, `KUBECTL_CMD`: KinD/job configuration when running ephemeral jobs.

Notes
- The runtime expects a global `fetch` (Node 18+). If you are on an older Node, polyfill `globalThis.fetch`.
- `vm2` is used to sandbox template evaluation in `src/api/engine.ts` — ensure the dependency is present in `package.json` (it's included).
