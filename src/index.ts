import { registerShutdown, run } from './main';

registerShutdown();

run().catch((err) => {
    console.error('[runner] fatal', err);
    process.exit(1);
});
