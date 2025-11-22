/**
 * Optional override for the API base URL. When set, runner will use this
 * value instead of the default discovered API base.
 */
export const apiBaseOverride: string | undefined = process.env.RUNNER_API_URL;

/**
 * Shared secret used to sign/verify callbacks between runner and API.
 * Required at process startup.
 */
export const sharedSecret: string | undefined = process.env.RUNNER_SHARED_SECRET;

/**
 * Poll interval (milliseconds) used by workers when waiting for new jobs.
 * Defaults to 5000ms.
 */
export const blockMs: number = Number(process.env.WORKFLOW_POLL_MS || 5000);

/**
 * Redis connection URL used by the worker for streams and coordination.
 */
export const redisUrl: string = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Name of the Redis stream where workflow jobs are published.
 */
export const workflowStreamName: string = process.env.WORKFLOW_STREAM || 'workflow_jobs';

/**
 * Consumer group name for Redis stream consumers.
 */
export const consumerGroup: string = process.env.WORKFLOW_CONSUMER_GROUP || 'workflow-runners';

/**
 * Consumer name for this worker instance. Defaults to a process-specific name.
 */
export const consumerName: string = process.env.WORKFLOW_CONSUMER_NAME || `runner-${process.pid}`;

/**
 * Platform fetch implementation. Node 18+ provides a global fetch; otherwise
 * the runner expects the environment to polyfill or assign `globalThis.fetch`.
 */
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
