import { downloadBase } from './runnerApi';
import { ensureGroup, ensureRedis, redis } from './redis';
import { parseJob, processMessage, sleep } from './worker';
import { blockMs, consumerGroup, consumerName, workflowStreamName } from './config';

let stopRequested = false;
let quitting = false;

/**
 * Gracefully close the Redis connection. This function is idempotent and
 * safe to call multiple times; the first call will attempt to quit the
 * client and log any error encountered.
 *
 * @returns Promise<void>
 */
async function quitRedis(): Promise<void> {
    if (quitting) {
        return;
    }
    quitting = true;
    try {
        await redis.quit();
    } catch (err) {
        console.error('[runner] error while quitting redis', err);
    }
}

/**
 * Main runner loop. Connects to Redis, ensures the consumer group exists
 * and continuously polls the configured stream for new workflow jobs.
 * The loop respects `stopRequested` which is set by `registerShutdown`.
 *
 * @returns Promise<void>
 */
export async function run(): Promise<void> {
    await ensureRedis();
    await ensureGroup(workflowStreamName, consumerGroup);
    console.log('[runner] listening on stream', workflowStreamName, 'group', consumerGroup, 'as', consumerName);

    let catchup = true;
    let isBaseDownloaded = false;

    while (!stopRequested) {
        try {
            await ensureGroup(workflowStreamName, consumerGroup);
            const streamId = catchup ? '0' : '>';
            const resp = await (redis as any).xreadgroup(
                'GROUP',
                consumerGroup,
                consumerName,
                'BLOCK',
                blockMs,
                'COUNT',
                1,
                'STREAMS',
                workflowStreamName,
                streamId
            );

            if (!resp) {
                if (catchup) {
                    try {
                        await redis.xlen(workflowStreamName);
                    } catch (lenErr) {
                        console.error('[runner] catchup poll xlen error', lenErr);
                    }
                    catchup = false;
                }
                continue;
            }

            for (const [, messages] of resp as any) {
                for (const [entryId, fields] of messages as any) {
                    const parsed = parseJob(fields);
                    if (!parsed) {
                        await redis.xack(workflowStreamName, consumerGroup, entryId);
                        continue;
                    }
                    if (!isBaseDownloaded) {
                        await downloadBase(parsed.job);
                        isBaseDownloaded = true;
                    }
                    await processMessage(entryId, parsed.job);
                }
            }

            if (catchup) {
                catchup = false;
            }
        } catch (err: any) {
            if (stopRequested) {
                break;
            }
            if (err && typeof err.message === 'string' && err.message.includes('NOGROUP')) {
                console.warn('[runner] group missing, recreating and continuing');
                try {
                    await ensureGroup(workflowStreamName, consumerGroup);
                } catch (gerr) {
                    console.error('[runner] failed recreating group', gerr);
                }
                catchup = true;
                continue;
            }
            console.error('[runner] poll error', err);
            await sleep(1000);
        }
    }

    await quitRedis();
}

/**
 * Register process signal handlers to request a graceful shutdown.
 * Signals are handled once; subsequent signals are ignored to allow
 * natural draining of in-flight work.
 */
export function registerShutdown(): void {
    const handler = (signal: NodeJS.Signals) => {
        if (stopRequested) {
            return;
        }
        console.log(`[runner] received ${signal}, draining then exiting`);
        stopRequested = true;
    };
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
}
