import { createHmac } from 'crypto';
import { apiBaseOverride, fetchFn, sharedSecret } from './config';
import { RunnerCallbackPayload, RunnerCredentialsResponse, RunnerWorkflowResponse, WorkflowJobPayload } from './types';

export function computeRunnerToken(nonce: string): string {
    const hmac = createHmac('sha256', sharedSecret!);
    hmac.update(nonce);
    return hmac.digest('hex');
}

export function getApiBase(job: WorkflowJobPayload) {
    if (apiBaseOverride) {
        return apiBaseOverride;
    }
    try {
        const url = new URL(job.callbackUrl);
        const pathname = url.pathname || '';
        const runnerIndex = pathname.indexOf('/runner/');
        const basePath = runnerIndex !== -1 ? pathname.substring(0, runnerIndex) : '';
        return `${url.protocol}//${url.host}${basePath}`;
    } catch (err) {
        throw new Error('cannot derive API base from callbackUrl');
    }
}

export async function sendCallback(job: WorkflowJobPayload, payload: RunnerCallbackPayload) {
    const res = await fetchFn!(job.callbackUrl, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-runner-token': computeRunnerToken(job.callbackNonce),
            'x-runner-job': job.jobId
        },
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`callback failed: ${res.status} ${res.statusText} ${text}`);
    }
}

export async function fetchWorkflow(job: WorkflowJobPayload): Promise<RunnerWorkflowResponse> {
    const base = getApiBase(job);
    const baseWithSlash = base.endsWith('/') ? base : `${base}/`;
    const url = new URL(`runner/workflows/${job.workflowId}`, baseWithSlash);
    if (job.workflowVersion) {
        url.searchParams.set('version', job.workflowVersion);
    }
    const res = await fetchFn!(url.toString(), {
        headers: {
            'x-runner-token': computeRunnerToken(job.callbackNonce),
            'x-runner-job': job.jobId
        }
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`workflow fetch failed ${res.status}: ${text}`);
    }
    return res.json() as Promise<RunnerWorkflowResponse>;
}

export async function fetchCredentials(job: WorkflowJobPayload, credentialIds: string[]): Promise<RunnerCredentialsResponse> {
    const base = getApiBase(job);
    const baseWithSlash = base.endsWith('/') ? base : `${base}/`;
    const url = new URL(`runner/credentials`, baseWithSlash);
    const res = await fetchFn!(url.toString(), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-runner-token': computeRunnerToken(job.callbackNonce),
            'x-runner-job': job.jobId
        },
        body: JSON.stringify({ credentialIds })
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`credentials fetch failed ${res.status}: ${text}`);
    }
    return res.json() as Promise<RunnerCredentialsResponse>;
}
