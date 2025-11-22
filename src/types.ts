export type WorkflowJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type RunnerCallbackStatus = 'running' | 'succeeded' | 'failed';

export interface WorkflowJobPayload {
    jobId: string;
    workflowId: string;
    workflowVersion?: string;
    startedByUser?: string;
    input?: Record<string, any>;
    deadline?: string;
    callbackUrl: string;
    callbackNonce: string;
}

export interface RunnerCallbackPayload {
    jobId: string;
    workflowId: string;
    status: RunnerCallbackStatus;
    result?: any;
    errorMessage?: string;
    finishedAt?: string;
}

export interface RunnerWorkflowResponse {
    workflow: any;
    version?: string;
    credentialIds?: string[];
    modulesUrl?: string;
}

export interface RunnerCredentialsRequest {
    credentialIds: string[];
}

export interface RunnerCredentialsResponse {
    credentials: Record<string, any>;
}
