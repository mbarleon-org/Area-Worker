import { WorkflowJobPayload } from '../types';
import { buildJobManifest, buildPayload } from './jobManifest';
import { KubeConfig, BatchV1Api, V1Job } from '@kubernetes/client-node';

/**
 * Get environment defaults used to construct the Job manifest.
 * @returns object with K8S_IMAGE, K8S_NAMESPACE and KUBECTL_CMD
 */
function getEnvDefaults() {
    const { K8S_IMAGE = 'area-backend:dev', K8S_NAMESPACE = 'default' } = process.env as any;
    return { K8S_IMAGE, K8S_NAMESPACE };
}


/**
 * Apply a Kubernetes manifest via kubectl.
 * @param kubectlCmd - command name or path to kubectl
 * @param manifestObj - manifest object to apply (will be stringified)
 */
async function applyManifest(manifestObj: V1Job): Promise<void> {
    const kc = new KubeConfig();
    try {
        kc.loadFromDefault();
    } catch (e) {
        try { kc.loadFromCluster(); } catch (e2) { /* ignore */ }
    }
    const client = kc.makeApiClient(BatchV1Api);
    const namespace = manifestObj.metadata && manifestObj.metadata.namespace ? String(manifestObj.metadata.namespace) : 'default';
    try {
        try {
            await (client as any).createNamespacedJob({ namespace, body: manifestObj } as any);
            return;
        } catch (e) { }
        await (client as any).createNamespacedJob(namespace, manifestObj as any);
    } catch (err: any) {
        console.error('[kindRunner] failed creating Job via Kubernetes API', err && err.body ? err.body : err && err.message ? err.message : err);
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
    const { K8S_IMAGE, K8S_NAMESPACE } = getEnvDefaults();

    const name = `ephemeral-runner-${String(job.jobId).slice(0, 8)}`;

    const payload = buildPayload(job, modulesBase);

    const manifest = buildJobManifest(name, K8S_NAMESPACE, K8S_IMAGE, payload, job) as unknown as V1Job;

    await applyManifest(manifest);
    return { jobName: name, namespace: K8S_NAMESPACE };
}

export default { submitK8sJob };
