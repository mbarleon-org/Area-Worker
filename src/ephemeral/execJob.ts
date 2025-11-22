import * as fs from 'fs';
import * as path from 'path';
import { WorkflowJobPayload } from '../types.js';
import { executeActions } from '../api/engine.js';
import { loadModules } from '../modules/registry.js';
import { downloadModules } from '../modules/download.js';
import { fetchCredentials, fetchWorkflow, sendCallback, computeRunnerToken, getApiBase } from '../runnerApi.js';

/**
 * Parse the JOB_JSON environment variable and return the job payload.
 * @returns parsed WorkflowJobPayload
 * @throws when JOB_JSON is missing or malformed
 */
function parseJobEnv(): WorkflowJobPayload {
    const raw = process.env.JOB_JSON;
    if (!raw) throw new Error('JOB_JSON env missing');
    return JSON.parse(raw) as WorkflowJobPayload;
}

/**
 * Send a lightweight status callback for the job.
 * @param job - workflow job payload
 * @param statusPayload - partial status payload passed to sendCallback
 */
async function reportStatus(job: WorkflowJobPayload, statusPartial: Record<string, any>) {
    // Ensure required callback fields are present; merge provided fields.
    const payload = {
        jobId: job.jobId,
        workflowId: job.workflowId,
        status: 'running',
        ...statusPartial
    };
    await sendCallback(job, payload as any);
}

/**
 * Fetch workflow and credentials required to execute it.
 * @param job - workflow job payload
 * @returns object containing workflow response and credentials response
 */
async function fetchWorkflowAndCredentials(job: WorkflowJobPayload) {
    const wf = await fetchWorkflow(job);
    const credsResp = (wf.credentialIds && wf.credentialIds.length)
        ? await fetchCredentials(job, wf.credentialIds)
        : { credentials: {} };
    return { wf, credsResp };
}

/**
 * Compute headers used when downloading module artifacts.
 * @param job - workflow job payload
 * @returns headers object
 */
function computeDownloadHeaders(job: WorkflowJobPayload) {
    return {
        'x-runner-token': computeRunnerToken(job.callbackNonce),
        'x-runner-job': job.jobId
    };
}

/**
 * Download modules to a temporary directory when the workflow specifies a `modulesUrl`.
 * @param wf - workflow response object
 * @param job - workflow job payload
 * @param headers - headers to include when fetching module files
 * @returns path to downloaded modules directory or null when not downloaded
 */
async function maybeDownloadModules(wf: any, job: WorkflowJobPayload, headers: Record<string, string>) {
    if (!wf.modulesUrl) {
        return null;
    }
    const base = getApiBase(job);
    const absModulesUrl = new URL(wf.modulesUrl, base).toString();
    const modulesBase = absModulesUrl.endsWith('/') ? absModulesUrl : `${absModulesUrl}/`;
    const manifestUrl = new URL('manifest', modulesBase).toString();
    return await downloadModules({ manifestUrl, filesBaseUrl: modulesBase, headers });
}

/**
 * Build an action registry by loading local or downloaded modules.
 * @param modulesDir - directory where modules are located
 * @returns registry object
 */
function buildRegistry(modulesDir: string | null) {
    return loadModules(modulesDir || path.resolve(process.cwd(), 'src', 'modules'));
}

/**
 * Convert credentials response to a lookup map usable by executor.
 * @param credsResp - credentials response object
 * @returns credential map
 */
function buildCredentialMap(credsResp: any) {
    return (credsResp && (credsResp as any).credentials) || {};
}

/**
 * Clean up a downloaded modules directory if one was created.
 * @param modulesDir - path returned by maybeDownloadModules
 */
async function cleanupModulesDir(modulesDir: string | null) {
    if (!modulesDir) {
        return;
    }
    try {
        await fs.promises.rm(modulesDir, { recursive: true, force: true });
    } catch (e) { /* ignore cleanup errors */ }
}

/**
 * Execute the workflow actions and report success via callback.
 * @param job - workflow job payload
 * @param wf - workflow response (should include .workflow)
 * @param credsResp - credentials response
 * @param modulesDir - optional modules directory
 */
async function executeJob(job: WorkflowJobPayload, wf: any, credsResp: any, modulesDir: string | null) {
    const actionsList = (wf.workflow && Array.isArray(wf.workflow.actions)) ? wf.workflow.actions : [];
    const triggerOutputs = (job.input && (job.input as any).triggerOutputs) || { body: {}, params: {}, query: {} };
    const initialNodeOutputs = (job.input && (job.input as any).initialNodeOutputs) || {};
    const credentialMap = buildCredentialMap(credsResp);

    const registry = buildRegistry(modulesDir);

    const result = await executeActions(actionsList, null, triggerOutputs, initialNodeOutputs, wf.workflow, registry, {
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

    await reportStatus(job, { jobId: job.jobId, workflowId: job.workflowId, status: 'succeeded', result });
}

/**
 * Main entrypoint: parse job, run the workflow, send callbacks and exit.
 */
async function run() {
    try {
        const job = parseJobEnv();

        await reportStatus(job, { jobId: job.jobId, workflowId: job.workflowId, status: 'running' });

        const { wf, credsResp } = await fetchWorkflowAndCredentials(job);

        const headers = computeDownloadHeaders(job);

        const modulesDir = await maybeDownloadModules(wf, job, headers);

        await executeJob(job, wf, credsResp, modulesDir);

        await cleanupModulesDir(modulesDir);
        process.exit(0);
    } catch (err: any) {
        console.error('[ephemeral-exec] job failed', err && err.message);
        try {
            const job = process.env.JOB_JSON ? JSON.parse(process.env.JOB_JSON) as WorkflowJobPayload : null;
            if (job) {
                await reportStatus(job, { jobId: job.jobId, workflowId: job.workflowId, status: 'failed', errorMessage: err.message });
            }
        } catch (e) { /* ignore callback errors */ }
        process.exit(1);
    }
}

run();
