import { RegisteredAction, ActionContext } from './_module.spec';

/**
 * Options accepted by `runAction`.
 */
export interface RunActionOptions {
    /** Map of credential type -> credential value available to action */
    credentials?: Record<string, any>;
    /** Action timeout in milliseconds. <= 0 disables the timeout. Defaults to 30000. */
    timeoutMs?: number;
    /** Outputs from previously executed nodes (used by actions that read other nodes' outputs) */
    previousOutputs?: Record<string, any>;
}

/**
 * Create a minimal logger passed to action handlers.
 * The logger is intentionally small and simply proxies to console methods.
 */
function createLogger() {
    return {
        info: (...args: any[]) => console.log('[action]', ...args),
        debug: (...args: any[]) => (typeof console.debug === 'function' ? console.debug('[action]', ...args) : console.log('[action]', ...args)),
        warn: (...args: any[]) => console.warn('[action]', ...args),
        error: (...args: any[]) => console.error('[action]', ...args),
    };
}

/**
 * Run a registered action with the provided inputs and options.
 *
 * @param action - the registered action object (spec + handler)
 * @param inputs - input map passed to the action handler
 * @param options - optional runtime options (credentials, timeout, previousOutputs)
 * @returns the value returned by the action handler (or a promise resolving to it)
 */
export async function runAction(
    action: RegisteredAction,
    inputs: Record<string, any> = {},
    options: RunActionOptions = {}
) {
    const { credentials = {}, timeoutMs = 30000, previousOutputs = {} } = options;

    /**
     * Build the execution context passed into the action handler. The
     * context exposes helpers for fetching credentials and reading other
     * node outputs, plus a small logger instance.
     */
    const createContext = (): ActionContext => {
        return {
            getCredential: async (type: string) => {
                return (credentials as Record<string, any>)[type] || null;
            },
            logger: createLogger(),
            getNodeOutput: (nodeId: string, key?: string) => {
                const node = (previousOutputs || {})[nodeId];
                if (node === undefined) {
                    return undefined;
                }
                if (typeof key === 'string') {
                    return node[key];
                }
                return node;
            },
            nodeOutputs: { ...(previousOutputs || {}) },
        };
    };

    const ctx = createContext();

    // Invoke the handler. Handlers can be sync or async (returning a Promise).
    const p = action.handler(ctx, inputs || {});

    // If timeout is disabled (<= 0) return the handler's result directly.
    if ((timeoutMs as number) <= 0) {
        return p;
    }

    // Race the handler promise against a timeout promise to enforce execution time limits.
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('action timeout')), timeoutMs));
    return Promise.race([p, timeout]);
}

// Keep CommonJS export for compatibility with other modules that `require` this file.
module.exports = { runAction };
