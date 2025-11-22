import { Redis } from 'ioredis';
import { redisUrl } from './config';

/**
 * Singleton `ioredis` client used across the runner.
 * The client is created with `lazyConnect: true` so callers must ensure
 * `ensureRedis()` is invoked before using commands in long-running flows.
 */
export const redis: Redis = new Redis(redisUrl, { lazyConnect: true });

/**
 * Ensure the redis client is connected. This function is safe to call
 * multiple times; if the client is already connected nothing happens.
 *
 * @returns Promise<void>
 */
export async function ensureRedis(): Promise<void> {
    if (redis.status === 'wait' || redis.status === 'end') {
        await redis.connect();
    }
}

/**
 * Ensure a Redis stream consumer group exists. On concurrent or repeated
 * attempts the call can raise `BUSYGROUP`, which is treated as success.
 *
 * @param streamName - the Redis stream to create the group on
 * @param groupName - the consumer group name to create
 * @returns Promise<void>
 */
export async function ensureGroup(streamName: string, groupName: string): Promise<void> {
    try {
        await redis.xgroup('CREATE', streamName, groupName, '0', 'MKSTREAM');
    } catch (err: any) {
        // Ignore BUSYGROUP errors which indicate the group already exists.
        if (!err?.message?.includes('BUSYGROUP')) {
            throw err;
        }
    }
}
