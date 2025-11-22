/**
 * Possible lifecycle states for a workflow job.
 */
export type WorkflowJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/**
 * Status values used when the runner posts callback updates to the API.
 */
export type RunnerCallbackStatus = 'running' | 'succeeded' | 'failed';

/**
 * Payload provided to the runner when a job is scheduled.
 *
 * - `callbackUrl` and `callbackNonce` are required for authenticated callbacks.
 * - `input` is arbitrary data consumed by the workflow.
 */
export interface WorkflowJobPayload {
    /** Unique identifier for the job */
    jobId: string;
    /** Identifier of the workflow to execute */
    workflowId: string;
    /** Optional workflow version to target */
    workflowVersion?: string;
    /** User who started the workflow (optional) */
    startedByUser?: string;
    /** Arbitrary workflow input passed to the runner */
    input?: Record<string, any>;
    /** ISO timestamp indicating a deadline for the job (optional) */
    deadline?: string;
    /** Callback URL the runner must POST updates to */
    callbackUrl: string;
    /** Per-job nonce used to compute the runner token */
    callbackNonce: string;
}

/**
 * Payload the runner sends back to the API to report job progress or result.
 */
export interface RunnerCallbackPayload {
    /** Job identifier matching the original `WorkflowJobPayload.jobId` */
    jobId: string;
    /** Workflow identifier matching the original `WorkflowJobPayload.workflowId` */
    workflowId: string;
    /** One of the `RunnerCallbackStatus` values */
    status: RunnerCallbackStatus;
    /** Arbitrary result produced by the workflow when `status` is `succeeded` */
    result?: any;
    /** Error message when the job failed */
    errorMessage?: string;
    /** ISO timestamp when the job finished (optional) */
    finishedAt?: string;
}

/**
 * Response returned by the API when fetching a workflow definition.
 * - `workflow` contains the workflow payload (structure is domain-specific).
 * - `credentialIds` lists credential identifiers the runner should fetch.
 */
export interface RunnerWorkflowResponse {
    workflow: any;
    version?: string;
    credentialIds?: string[];
    modulesUrl?: string;
}

/**
 * Request shape used when asking the API to resolve credential values.
 */
export interface RunnerCredentialsRequest {
    credentialIds: string[];
}

/**
 * Response from the API containing credential values mapped by id.
 */
export interface RunnerCredentialsResponse {
    credentials: Record<string, any>;
}
