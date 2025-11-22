import * as fs from 'fs';
import * as path from 'path';
import { WorkflowJobPayload } from '../types.js';
import { downloadModules } from '../modules/download.js';
import { fetchCredentials, fetchWorkflow, sendCallback, computeRunnerToken, getApiBase } from '../runnerApi.js';

const { executeActions } = require('../api/engine.js');
const { loadModules } = require('../modules/registry.js');

async function run() {
    try {
        const raw = process.env.JOB_JSON;
        if (!raw) throw new Error('JOB_JSON env missing');
        const job = JSON.parse(raw) as WorkflowJobPayload;

        await sendCallback(job, { jobId: job.jobId, workflowId: job.workflowId, status: 'running' });

        const wf = await fetchWorkflow(job);
        const credsResp = wf.credentialIds && wf.credentialIds.length
            ? await fetchCredentials(job, wf.credentialIds)
            : { credentials: {} };

        const headers = {
            'x-runner-token': computeRunnerToken(job.callbackNonce),
            'x-runner-job': job.jobId
        };

        let modulesDir: string | null = null;
        if (wf.modulesUrl) {
            const base = getApiBase(job);
            const absModulesUrl = new URL(wf.modulesUrl, base).toString();
            const modulesBase = absModulesUrl.endsWith('/') ? absModulesUrl : `${absModulesUrl}/`;
            const manifestUrl = new URL('manifest', modulesBase).toString();
            modulesDir = await downloadModules({ manifestUrl, filesBaseUrl: modulesBase, headers });
        }

        const actionsList = (wf.workflow && Array.isArray(wf.workflow.actions)) ? wf.workflow.actions : [];
        const triggerOutputs = (job.input && (job.input as any).triggerOutputs) || { body: {}, params: {}, query: {} };
        const initialNodeOutputs = (job.input && (job.input as any).initialNodeOutputs) || {};
        const credentialMap = (credsResp && (credsResp as any).credentials) || {};

        const registry = loadModules(modulesDir || path.resolve(process.cwd(), 'src', 'modules'));

        const result = await executeActions(actionsList, null, triggerOutputs, initialNodeOutputs, wf.workflow, registry, {
            getCredentialById: (credentialId: string) => {
                const cred = credentialMap[credentialId];
                if (!cred) return null;
                if (cred.type && cred.data) return { type: cred.type, data: cred.data };
                return cred;
            }
        });

        await sendCallback(job, { jobId: job.jobId, workflowId: job.workflowId, status: 'succeeded', result });

        if (modulesDir) {
            try { await fs.promises.rm(modulesDir, { recursive: true, force: true }); } catch (e) { }
        }
        process.exit(0);
    } catch (err: any) {
        console.error('[ephemeral-exec] job failed', err && err.message);
        try {
            const raw = process.env.JOB_JSON;
            if (raw) {
                const job = JSON.parse(raw) as WorkflowJobPayload;
                await sendCallback(job, { jobId: job.jobId, workflowId: job.workflowId, status: 'failed', errorMessage: err.message });
            }
        } catch (e) { }
        process.exit(1);
    }
}

run();
