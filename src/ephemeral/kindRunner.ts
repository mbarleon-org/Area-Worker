import { execSync } from 'child_process';
import { WorkflowJobPayload } from '../types';

/**
 * Get environment defaults used to construct the Job manifest.
 * @returns object with KIND_IMAGE, KIND_NAMESPACE and KUBECTL_CMD
 */
function getEnvDefaults() {
    const { KIND_IMAGE = 'area-backend:dev', KIND_NAMESPACE = 'default', KUBECTL_CMD = 'kubectl' } = process.env as any;
    return { KIND_IMAGE, KIND_NAMESPACE, KUBECTL_CMD };
}

/**
 * Rewrite a callback url so in-kind clusters can reach the host runner.
 * If the host is localhost-like, replace with `KIND_CALLBACK_HOST` or `host.docker.internal`.
 * @param original - original callback URL string
 * @returns possibly rewritten URL string
 */
function rewriteCallbackUrl(original: string) {
    try {
        const url = new URL(original);
        const overrideHost = (process.env.KIND_CALLBACK_HOST as string) || 'host.docker.internal';
        if (['backend', 'localhost', '127.0.0.1'].includes(url.hostname)) {
            url.hostname = overrideHost;
        }
        return url.toString();
    } catch (e) {
        return original;
    }
}

/**
 * Build the payload placed into the Job container `JOB_JSON` env var.
 * @param job - job payload from the API
 * @param modulesBase - optional modules base url
 * @returns object payload
 */
function buildPayload(job: WorkflowJobPayload, modulesBase?: string | null) {
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

/**
 * Build a Kubernetes Job manifest object for the ephemeral runner.
 * @param name - job name
 * @param namespace - k8s namespace
 * @param image - container image to run
 * @param payload - job payload object to inject as `JOB_JSON`
 * @param job - original job payload (used to populate envs)
 * @returns manifest object
 */
function buildJobManifest(name: string, namespace: string, image: string, payload: any, job: WorkflowJobPayload) {
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
                    containers: [
                        {
                            name: 'runner',
                            image: image,
                            command: ['sh', '-c', "[ -f /app/dist/ephemeral/execJob.js ] && exec node /app/dist/ephemeral/execJob.js || exec node -r ts-node/register/transpile-only /app/src/ephemeral/execJob.ts"],
                            env: [
                                { name: 'JOB_JSON', value: JSON.stringify(payload) },
                                { name: 'WORKFLOW_ID', value: String(job.workflowId) },
                                { name: 'CALLBACK_URL', value: String(job.callbackUrl) },
                                { name: 'RUNNER_SHARED_SECRET', value: String(process.env.RUNNER_SHARED_SECRET || '') }
                            ]
                        }
                    ]
                }
            }
        }
    };
}

/**
 * Apply a Kubernetes manifest via kubectl.
 * @param kubectlCmd - command name or path to kubectl
 * @param manifestObj - manifest object to apply (will be stringified)
 */
function applyManifest(kubectlCmd: string, manifestObj: any) {
    const yaml = JSON.stringify(manifestObj);
    try {
        execSync(`${kubectlCmd} apply -f -`, { input: yaml, encoding: 'utf8' });
    } catch (err: any) {
        console.error('[kindRunner] failed applying manifest', err && err.message);
        throw err;
    }
}

/**
 * Submit a Kubernetes Job manifest to the cluster for ephemeral execution.
 *
 * @param job - workflow job payload
 * @param _wf - workflow object (not used by this runner)
 * @param modulesBase - optional base URL for modules to pass into the job
 * @param _headers - optional headers (not used)
 */
export async function submitK8sJob(job: WorkflowJobPayload, _wf: any, modulesBase?: string | null, _headers?: Record<string, string>) {
    const { KIND_IMAGE, KIND_NAMESPACE, KUBECTL_CMD } = getEnvDefaults();

    const name = `ephemeral-runner-${job.jobId.slice(0, 8)}`;

    const payload = buildPayload(job, modulesBase);

    const manifest = buildJobManifest(name, KIND_NAMESPACE, KIND_IMAGE, payload, job);

    applyManifest(KUBECTL_CMD, manifest);
}

export default { submitK8sJob };
