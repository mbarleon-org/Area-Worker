import * as fs from 'fs';
import * as path from 'path';
import { redis } from './redis';
import { executeActions } from './api/engine.js';
import { submitK8sJob } from './ephemeral/kindRunner';
import { downloadModules } from './modules/download.js';
import { consumerGroup, workflowStreamName } from './config';
import { RunnerCallbackPayload, WorkflowJobPayload } from './types';
import { fetchCredentials, fetchWorkflow, sendCallback, computeRunnerToken, getApiBase } from './runnerApi';

const { loadModules } = require('./modules/registry.js');

export function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseJob(fields: any): { id: string; job: WorkflowJobPayload } | null {
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
        await sendCallback(job, {
            jobId: job.jobId,
            workflowId: job.workflowId,
            status: 'running'
        });

        const wf = await fetchWorkflow(job);
        const credsResp = wf.credentialIds && wf.credentialIds.length
            ? await fetchCredentials(job, wf.credentialIds)
            : { credentials: {} };

        const headers = {
            'x-runner-token': computeRunnerToken(job.callbackNonce),
            'x-runner-job': job.jobId
        };

        if (wf.modulesUrl) {
            const base = getApiBase(job);
            const absModulesUrl = new URL(wf.modulesUrl, base).toString();
            const modulesBase = absModulesUrl.endsWith('/') ? absModulesUrl : `${absModulesUrl}/`;
            const manifestUrl = new URL('manifest', modulesBase).toString();
            modulesDir = await downloadModules({ manifestUrl, filesBaseUrl: modulesBase, headers });
        }

        const { RUNNER_EPHEMERAL_KIND } = require('./config');
        if (RUNNER_EPHEMERAL_KIND === 'true') {
            try {
                console.log('[runner] submitting ephemeral k8s job for', job.jobId);
                await submitK8sJob(job, wf, modulesDir, headers);
                await sendCallback(job, { jobId: job.jobId, workflowId: job.workflowId, status: 'running' });
                await redis.xack(workflowStreamName, consumerGroup, entryId);
                if (modulesDir) {
                    try { await fs.promises.rm(modulesDir, { recursive: true, force: true }); } catch (e) { }
                }
                return;
            } catch (err) {
                console.error('[runner] failed submitting k8s job', err);
            }
        }

        const registry = loadModules(modulesDir || path.resolve(process.cwd(), 'src', 'modules'));
        const actionsList = (wf.workflow && Array.isArray(wf.workflow.actions)) ? wf.workflow.actions : [];
        const triggerOutputs = (job.input && (job.input as any).triggerOutputs) || { body: {}, params: {}, query: {} };
        const initialNodeOutputs = (job.input && (job.input as any).initialNodeOutputs) || {};
        const credentialMap = (credsResp && (credsResp as any).credentials) || {};

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

        await sendCallback(job, {
            jobId: job.jobId,
            workflowId: job.workflowId,
            status: 'succeeded',
            result
        });

        await redis.xack(workflowStreamName, consumerGroup, entryId);
        if (modulesDir) {
            try { await fs.promises.rm(modulesDir, { recursive: true, force: true }); } catch (e) { }
        }
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
            if (modulesDir) {
                try { await fs.promises.rm(modulesDir, { recursive: true, force: true }); } catch (e) { }
            }
        }
    }
}
