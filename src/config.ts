export const apiBaseOverride = process.env.RUNNER_API_URL;
export const sharedSecret = process.env.RUNNER_SHARED_SECRET;
export const blockMs = Number(process.env.WORKFLOW_POLL_MS || 5000);
export const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
export const workflowStreamName = process.env.WORKFLOW_STREAM || 'workflow_jobs';
export const consumerGroup = process.env.WORKFLOW_CONSUMER_GROUP || 'workflow-runners';
export const consumerName = process.env.WORKFLOW_CONSUMER_NAME || `runner-${process.pid}`;
export const fetchFn: typeof fetch | undefined = (globalThis as any).fetch;

export const RUNNER_EPHEMERAL_KIND = process.env.RUNNER_EPHEMERAL_KIND || 'false';
export const KIND_IMAGE = process.env.KIND_IMAGE || 'area-backend:dev';
export const KIND_NAMESPACE = process.env.KIND_NAMESPACE || 'default';
export const KUBECTL_CMD = process.env.KUBECTL_CMD || 'kubectl';

if (!sharedSecret) {
    throw new Error('env.RUNNER_SHARED_SECRET must be set in order to use workers.');
}

if (!fetchFn) {
    throw new Error('global fetch is required (Node 18+). If unavailable, install node-fetch and wire it here.');
}
