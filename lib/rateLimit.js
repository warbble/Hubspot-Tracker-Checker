import Redis from 'ioredis';

const DAILY_LIMIT = 2;
const TTL_SECONDS = 86400;
const FAIL_OPEN_REMAINING = 999;

let defaultClient = null;
if (process.env.REDIS_URL) {
  defaultClient = new Redis(process.env.REDIS_URL);
  defaultClient.on('error', (err) => console.error('Redis error:', err));
}

// Core limiter. `redis` and `now` are injectable so the policy can be tested
// without a live Redis. Returns { allowed, remaining }.
export async function rateLimit(ip, redis = defaultClient, now = new Date()) {
  if (!redis) {
    return { allowed: true, remaining: FAIL_OPEN_REMAINING }; // fail open: no Redis configured
  }

  const day = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const key = `rate:${ip}:${day}`;

  try {
    const count = await redis.incr(key);
    await redis.expire(key, TTL_SECONDS); // refresh TTL every request so a
                                          // failed EXPIRE can't orphan the key
    if (count > DAILY_LIMIT) {
      return { allowed: false, remaining: 0 };
    }
    return { allowed: true, remaining: DAILY_LIMIT - count };
  } catch (err) {
    console.error('Rate limit error:', err);
    return { allowed: true, remaining: FAIL_OPEN_REMAINING }; // fail open: Redis error
  }
}

export function checkRateLimit(ip) {
  return rateLimit(ip);
}
