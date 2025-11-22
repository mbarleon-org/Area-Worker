import { createHmac } from 'crypto';
import { apiBaseOverride, fetchFn, sharedSecret } from './config';
import { RunnerCallbackPayload, RunnerCredentialsResponse, RunnerWorkflowResponse, WorkflowJobPayload } from './types';

/**
 * Compute the HMAC token used to authenticate runner callbacks to the API.
 * The function expects `sharedSecret` to be available (the application
 * enforces this at startup), and will throw if it's missing.
 *
 * @param nonce - per-job nonce provided by the API
 * @returns hex-encoded HMAC-SHA256 digest
 */
export function computeRunnerToken(nonce: string): string {
    if (!sharedSecret) {
        throw new Error('sharedSecret is not configured');
    }
    const hmac = createHmac('sha256', sharedSecret);
    hmac.update(nonce);
    return hmac.digest('hex');
}

/**
 * Derive the API base URL from the job's callback URL. If
 * `apiBaseOverride` is set it will be returned directly. Otherwise the
 * function strips any `/runner/...` suffix from the callback URL path
 * to compute the API base.
 *
 * @param job - workflow job payload containing the callback URL
 * @returns base URL string (protocol + host + optional basePath)
 */
export function getApiBase(job: WorkflowJobPayload): string {
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

/**
 * Send a JSON callback to the job's `callbackUrl`. The request is
 * authenticated using the HMAC token returned by `computeRunnerToken`.
 *
 * @param job - workflow job payload
 * @param payload - callback payload to POST
 */
export async function sendCallback(job: WorkflowJobPayload, payload: RunnerCallbackPayload): Promise<void> {
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

/**
 * Fetch the workflow definition from the API for the given job.
 *
 * @param job - workflow job payload
 * @returns the workflow response object
 */
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

/**
 * Fetch credential values from the API for the requested credential IDs.
 *
 * @param job - workflow job payload
 * @param credentialIds - array of credential identifiers to fetch
 * @returns credential values mapped by id
 */
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
