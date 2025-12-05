import * as fs from 'fs';
import * as path from 'path';
import { redis } from './redis';
import { RUNNER_EPHEMERAL_K8S } from './config';
import { submitK8sJob } from './ephemeral/kindRunner';
import { downloadModules } from './modules/download.js';
import { consumerGroup, workflowStreamName } from './config';
import { fetchCredentials, fetchWorkflow, sendCallback, computeRunnerToken, getApiBase } from './runnerApi';
import { RunnerCallbackPayload, WorkflowJobPayload, RunnerWorkflowResponse, RunnerCredentialsResponse } from './types';

let executeActions: ((...args: any[]) => any) | null = null;
let loadModules: ((...args: any[]) => any) | null = null;

function getExecuteActions() {
    if (!executeActions) {
        try {
            executeActions = require('./api/engine.js').executeActions;
        } catch {
            throw new Error('engine.js not available yet');
        }
    }
    return executeActions;
}

function getLoadModules() {
    if (!loadModules) {
        try {
            loadModules = require('./modules/registry.js').loadModules;
        } catch {
            throw new Error('registry.js not available yet');
        }
    }
    return loadModules;
}

export function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize various Redis XREAD/XREADGROUP field shapes into a JS object
 * and parse the `job` JSON payload.
 *
 * @param fields - raw fields as returned by ioredis (array or object)
 * @returns parsed job wrapper or null on parse/validation failure
 */
export function parseJob(fields: unknown): { id: string; job: WorkflowJobPayload } | null {
    const obj: Record<string, string> = {};

    try {
        if (Array.isArray(fields) && fields.length > 0 && Array.isArray(fields[0])) {
            for (const [k, v] of fields) {
                obj[String(k)] = String(v);
            }
        } else if (Array.isArray(fields)) {
            for (let i = 0; i < fields.length; i += 2) {
                const k = fields[i];
                const v = fields[i + 1];
                if (typeof k !== 'undefined') obj[String(k)] = typeof v === 'undefined' ? '' : String(v);
            }
        } else if (fields && typeof fields === 'object') {
            for (const k of Object.keys(fields)) {
                obj[k] = String((fields as any)[k]);
            }
        }
    } catch (err) {
        console.error('[runner] parseJob error while normalizing fields', err);
        return null;
    }

    if (!obj.job) {
        return null;
    }
    try {
        const job = JSON.parse(obj.job) as WorkflowJobPayload;
        if (!job.jobId || !job.workflowId || !job.callbackUrl || !job.callbackNonce) {
            throw new Error('missing required fields');
        }
        return { id: obj.id || '', job };
    } catch (err) {
        console.error('[runner] failed to parse job payload', err);
        return null;
    }
}

export async function processMessage(entryId: string, job: WorkflowJobPayload) {
    let modulesDir: string | null = null;
    console.log('[runner] received job', job.jobId, 'for workflow', job.workflowId);
    try {
        await sendRunningStatus(job);

        const { wf, credsResp } = await fetchWorkflowAndCredentials(job);

        const headers: Record<string, string> = {
            'x-runner-token': computeRunnerToken(job.callbackNonce),
            'x-runner-job': job.jobId
        };

        modulesDir = await downloadModulesIfNeeded(job, wf, headers);

        const ephemeralSubmitted = await maybeSubmitEphemeralJob(entryId, job, wf, modulesDir, headers);
        if (ephemeralSubmitted) return;

        const result = await runWorkflowActions(job, wf, credsResp, modulesDir);

        await sendCallback(job, {
            jobId: job.jobId,
            workflowId: job.workflowId,
            status: 'succeeded',
            result
        });

        await redis.xack(workflowStreamName, consumerGroup, entryId);
        await cleanupModulesDir(modulesDir);
    } catch (err) {
        console.error('[runner] job failed', job.jobId, err);
        try {
            await sendCallback(job, {
                jobId: job.jobId,
                workflowId: job.workflowId,
                status: 'failed',
                errorMessage: err instanceof Error ? err.message : String(err)
            } as RunnerCallbackPayload);
        } catch (cbErr) {
            console.error('[runner] failed sending failure callback', cbErr);
        } finally {
            await redis.xack(workflowStreamName, consumerGroup, entryId);
            await cleanupModulesDir(modulesDir);
        }
    }
}

/**
 * Send an initial `running` status callback for the job.
 */
async function sendRunningStatus(job: WorkflowJobPayload): Promise<void> {
    await sendCallback(job, {
        jobId: job.jobId,
        workflowId: job.workflowId,
        status: 'running'
    });
}

/**
 * Fetch workflow definition and credentials (if any) from the API.
 */
async function fetchWorkflowAndCredentials(job: WorkflowJobPayload): Promise<{ wf: RunnerWorkflowResponse; credsResp: RunnerCredentialsResponse }> {
    const wf = await fetchWorkflow(job);
    const credsResp = wf.credentialIds && wf.credentialIds.length
        ? await fetchCredentials(job, wf.credentialIds)
        : { credentials: {} } as RunnerCredentialsResponse;
    return { wf, credsResp };
}

/**
 * Download module files if the workflow declares `modulesUrl`.
 */
async function downloadModulesIfNeeded(job: WorkflowJobPayload, wf: RunnerWorkflowResponse, headers: Record<string, string>): Promise<string | null> {
    if (!wf.modulesUrl) return null;
    const base = getApiBase(job);
    const absModulesUrl = new URL(wf.modulesUrl, base).toString();
    const modulesBase = absModulesUrl.endsWith('/') ? absModulesUrl : `${absModulesUrl}/`;
    const manifestUrl = new URL('manifest', modulesBase).toString();
    return await downloadModules({ manifestUrl, filesBaseUrl: modulesBase, headers });
}

/**
 * If configured to run ephemeral jobs in KinD, submit a Kubernetes Job
 * and return true when submission succeeded (the caller should then return).
 */
async function maybeSubmitEphemeralJob(entryId: string, job: WorkflowJobPayload, wf: RunnerWorkflowResponse, modulesDir: string | null, headers: Record<string, string>): Promise<boolean> {
    if (RUNNER_EPHEMERAL_K8S !== 'true') return false;
    try {
        console.log('[runner] submitting ephemeral k8s job for', job.jobId);
        await submitK8sJob(job, wf, modulesDir, headers);
        await sendCallback(job, { jobId: job.jobId, workflowId: job.workflowId, status: 'running' });
        await redis.xack(workflowStreamName, consumerGroup, entryId);
        await cleanupModulesDir(modulesDir);
        return true;
    } catch (err) {
        console.error('[runner] failed submitting k8s job', err);
        return false;
    }
}

/**
 * Load modules, prepare inputs and run `executeActions`. Returns the
 * actions result to be posted back to the API.
 */
async function runWorkflowActions(job: WorkflowJobPayload, wf: RunnerWorkflowResponse, credsResp: RunnerCredentialsResponse, modulesDir: string | null): Promise<any> {
    const registry = getLoadModules()(modulesDir || path.resolve(process.cwd(), 'src', 'modules'));
    const actionsList = (wf.workflow && Array.isArray(wf.workflow.actions)) ? wf.workflow.actions : [];
    const triggerOutputs = (job.input && (job.input as any).triggerOutputs) || { body: {}, params: {}, query: {} };
    const initialNodeOutputs = (job.input && (job.input as any).initialNodeOutputs) || {};
    const credentialMap = (credsResp && (credsResp as any).credentials) || {};

    return await getExecuteActions()(actionsList, null, triggerOutputs, initialNodeOutputs, wf.workflow, registry, {
        getCredentialById: (credentialId: string) => {
            const cred = credentialMap[credentialId];
            if (!cred) {
                return null;
            }
            if (cred.type && cred.data) {
                return { type: cred.type, data: cred.data };
            }
            return cred;
        }
    });
}

/**
 * Remove the modules directory if present. This centralizes the
 * cleanup logic and avoids repeating the same try/catch in multiple
 * places.
 *
 * @param modulesDir - path returned by `downloadModules` or null
 */
async function cleanupModulesDir(modulesDir: string | null): Promise<void> {
    if (!modulesDir) return;
    try {
        await fs.promises.rm(modulesDir, { recursive: true, force: true });
    } catch (e) {
        console.warn('[runner] failed cleaning modules dir', modulesDir, e);
    }
}
