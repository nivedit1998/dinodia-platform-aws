import { createClient } from 'redis';

export type RateLimitKey = string;

export interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
}

type RateLimitBucket = {
  count: number;
  expiresAt: number;
};

const memoryBuckets = new Map<RateLimitKey, RateLimitBucket>();

let redisClient: ReturnType<typeof createClient> | null = null;
let redisConnectPromise: Promise<ReturnType<typeof createClient>> | null = null;

function hasRedisConfig(): boolean {
  return Boolean(process.env.REDIS_URL);
}

async function getRedisClient(): Promise<ReturnType<typeof createClient>> {
  if (redisClient) return redisClient;
  if (redisConnectPromise) return redisConnectPromise;

  redisConnectPromise = (async () => {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL is not configured');
    const client = createClient({ url });

    client.on('error', (err) => {
      console.warn('[rateLimit] Redis client error', err);
    });

    await client.connect();
    redisClient = client;
    return client;
  })();

  return redisConnectPromise;
}

async function checkRateLimitRedis(key: RateLimitKey, options: RateLimitOptions) {
  const { maxRequests, windowMs } = options;
  const bucketKey = `rl:${key}`;

  const client = await getRedisClient();
  const txn = client.multi();
  txn.incr(bucketKey);
  txn.expire(bucketKey, Math.ceil(windowMs / 1000));
  const execResult = await txn.exec();
  const count = Array.isArray(execResult) ? execResult[0] : null;

  if (typeof count !== 'number') return true;
  return count <= maxRequests;
}

function checkRateLimitMemory(key: RateLimitKey, options: RateLimitOptions) {
  const { maxRequests, windowMs } = options;
  const now = Date.now();
  const existing = memoryBuckets.get(key);

  if (!existing || existing.expiresAt < now) {
    memoryBuckets.set(key, { count: 1, expiresAt: now + windowMs });
    return true;
  }

  if (existing.count < maxRequests) {
    existing.count += 1;
    return true;
  }

  return false;
}

export async function checkRateLimit(
  key: RateLimitKey,
  options: RateLimitOptions
): Promise<boolean> {
  if (hasRedisConfig()) {
    try {
      return await checkRateLimitRedis(key, options);
    } catch (err) {
      console.warn('[rateLimit] Redis unavailable, falling back to memory', err);
    }
  }
  return checkRateLimitMemory(key, options);
}
