import { execSync } from 'child_process';
import { WorkflowJobPayload } from '../types';

export async function submitK8sJob(job: WorkflowJobPayload, wf: any, modulesBase?: string | null, headers?: Record<string, string>) {
    const { KIND_IMAGE = 'area-backend:dev', KIND_NAMESPACE = 'default', KUBECTL_CMD = 'kubectl' } = process.env as any;

    const name = `ephemeral-runner-${job.jobId.slice(0, 8)}`;

    const payload = {
        jobId: job.jobId,
        workflowId: job.workflowId,
        workflowVersion: job.workflowVersion,
        input: job.input,
        callbackUrl: rewriteCallbackUrl(job.callbackUrl),
        callbackNonce: job.callbackNonce,
        modulesBase: modulesBase || null
    };

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

    const jobManifest = {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
            name,
            namespace: KIND_NAMESPACE
        },
        spec: {
            template: {
                metadata: { name },
                spec: {
                    restartPolicy: 'Never',
                    containers: [
                        {
                            name: 'runner',
                            image: KIND_IMAGE,
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

    const yaml = JSON.stringify(jobManifest);

    try {
        const out = execSync(`${KUBECTL_CMD} apply -f -`, { input: yaml, encoding: 'utf8' });
    } catch (err: any) {
        console.error('[kindRunner] failed applying manifest', err && err.message);
        throw err;
    }
}

export default { submitK8sJob };
