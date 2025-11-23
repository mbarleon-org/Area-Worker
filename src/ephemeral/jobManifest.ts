import { WorkflowJobPayload } from '../types';

type JobPayload = {
    jobId: string;
    workflowId: string;
    workflowVersion?: string;
    input?: any;
    callbackUrl: string;
    callbackNonce: string;
    modulesBase?: string | null;
};

type JobManifest = Record<string, any>;

/**
 * Rewrite a callback url so in-cluster Jobs can reach the host runner.
 * If the host is localhost-like, replace with `K8S_CALLBACK_HOST` or `host.docker.internal`.
 * @param {string} original - original callback URL
 * @returns {string} rewritten URL (or original on parse error)
 */
export function rewriteCallbackUrl(original: string): string {
    try {
        const url = new URL(original);
        const overrideHost = (process.env.K8S_CALLBACK_HOST as string) || 'host.docker.internal';
        if (['backend', 'localhost', '127.0.0.1'].includes(url.hostname)) {
            url.hostname = overrideHost;
        }
        return url.toString();
    } catch (e) {
        return original;
    }
}

/**
 * Build the payload object that will be serialized into the job's `JOB_JSON` env var.
 * @param {WorkflowJobPayload} job - original workflow job
 * @param {string | null} [modulesBase] - optional modules base URL
 * @returns {JobPayload}
 */
export function buildPayload(job: WorkflowJobPayload, modulesBase?: string | null): JobPayload {
    return {
        jobId: job.jobId,
        workflowId: job.workflowId,
        workflowVersion: job.workflowVersion,
        input: job.input,
        callbackUrl: rewriteCallbackUrl(job.callbackUrl),
        callbackNonce: job.callbackNonce,
        modulesBase: modulesBase || null
    };
}

function buildEnvList(payload: JobPayload, job: WorkflowJobPayload) {
    return [
        { name: 'JOB_JSON', value: JSON.stringify(payload) },
        { name: 'WORKFLOW_ID', value: String(job.workflowId) },
        { name: 'CALLBACK_URL', value: String(job.callbackUrl) },
        { name: 'RUNNER_SHARED_SECRET', value: String(process.env.RUNNER_SHARED_SECRET || '') }
    ];
}

function buildContainerSpec(image: string, payload: JobPayload, job: WorkflowJobPayload) {
    return {
        name: 'runner',
        image: image,
        command: ['sh', '-c', "[ -f /app/dist/ephemeral/execJob.js ] && exec node /app/dist/ephemeral/execJob.js || exec node -r ts-node/register/transpile-only /app/src/ephemeral/execJob.ts"],
        env: buildEnvList(payload, job)
    } as any;
}

/**
 * Build a Kubernetes Job manifest for the ephemeral runner.
 * @param {string} name - job name
 * @param {string} namespace - k8s namespace
 * @param {string} image - container image
 * @param {JobPayload} payload - payload object to include
 * @param {WorkflowJobPayload} job - original workflow job (used for env vars)
 * @returns {JobManifest}
 */
export function buildJobManifest(name: string, namespace: string, image: string, payload: JobPayload, job: WorkflowJobPayload): JobManifest {
    const container = buildContainerSpec(image, payload, job);
    return {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
            name,
            namespace
        },
        spec: {
            template: {
                metadata: { name },
                spec: {
                    restartPolicy: 'Never',
                    containers: [container]
                }
            }
        }
    } as any;
}
