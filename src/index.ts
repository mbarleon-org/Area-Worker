import { registerShutdown, run } from './main';

/**
 * Entrypoint for the runner process.
 * Registers shutdown handlers and starts the main runner loop.
 */
function handleFatalError(err: unknown): void {
    console.error('[runner] fatal', err);
    // ensure non-zero exit code on unexpected fatal errors
    process.exit(1);
}

registerShutdown();

// Start the runner and let any unhandled rejection pass to the fatal handler.
run().catch(handleFatalError);
