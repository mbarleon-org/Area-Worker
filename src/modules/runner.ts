import { RegisteredAction, ActionContext } from './_module.spec';

export async function runAction(
    action: RegisteredAction,
    inputs: Record<string, any> = {},
    options: { credentials?: Record<string, any>; timeoutMs?: number; previousOutputs?: Record<string, any> } = {}
) {
    const { credentials = {}, timeoutMs = 30000, previousOutputs = {} } = options;

    const createLogger = () => ({
        info: (...args: any[]) => console.log('[action]', ...args),
        debug: (...args: any[]) => (typeof console.debug === 'function' ? console.debug('[action]', ...args) : console.log('[action]', ...args)),
        warn: (...args: any[]) => console.warn('[action]', ...args),
        error: (...args: any[]) => console.error('[action]', ...args),
    });

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

    const p = action.handler(ctx, inputs || {});

    if ((timeoutMs as number) <= 0) {
        return p;
    }

    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('action timeout')), timeoutMs));
    return Promise.race([p, timeout]);
}

module.exports = { runAction };
