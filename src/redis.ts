import { Redis } from 'ioredis';
import { redisUrl } from './config';

export const redis = new Redis(redisUrl, { lazyConnect: true });

export async function ensureRedis() {
    if (redis.status === 'wait' || redis.status === 'end') {
        await redis.connect();
    }
}

export async function ensureGroup(streamName: string, groupName: string) {
    try {
        await redis.xgroup('CREATE', streamName, groupName, '0', 'MKSTREAM');
    } catch (err: any) {
        if (!err?.message?.includes('BUSYGROUP')) {
            throw err;
        }
    }
}
