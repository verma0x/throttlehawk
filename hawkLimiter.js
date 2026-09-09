/**
 * middleware/hawkLimiter.js
 * -----------------------------------------------------------------------
 * ThrottleHAWK — Sliding Window Log rate limiter.
 *
 * Algorithm
 * ---------
 * For each client we maintain a Redis Sorted Set (ZSET) keyed by
 * `hawk:{clientId}`. Every accepted or rejected request attempt is scored
 * by its arrival timestamp (ms epoch), and the *member* is a unique token
 * (timestamp + random suffix) so concurrent requests in the same
 * millisecond never collide and silently overwrite one another.
 *
 * On every request we run a single atomic Redis pipeline that:
 *   1. ZREMRANGEBYSCORE — evicts all entries older than (now - windowMs),
 *      i.e. anything that has "slid" out of the window.
 *   2. ZCARD           — counts how many timestamps remain in the window.
 *   3. If under the limit: ZADD the new request's timestamp + EXPIRE the
 *      key (so idle clients' keys are garbage collected automatically).
 *
 * Because all of this executes as a single pipelined round-trip, the
 * check-then-act sequence is effectively atomic from the perspective of
 * a single Redis instance — there is no window between "count" and
 * "increment" where two concurrent requests could both slip through
 * (the classic race condition in naive counter-based limiters). Unlike
 * fixed-window counters, a sliding window log also has no "boundary
 * reset spike": because the log holds exact timestamps rather than a
 * bucketed counter, the window slides continuously rather than resetting
 * to zero every N seconds.
 *
 * Fault tolerance
 * ---------------
 * If Redis is unreachable (connection error, timeout, pipeline throws),
 * the middleware FAILS OPEN: it logs the error and calls next() so a
 * Redis outage degrades to "no rate limiting" rather than taking the
 * entire API down. This is a deliberate availability-over-strictness
 * trade-off appropriate for most production APIs.
 * -----------------------------------------------------------------------
 */

const crypto = require('crypto');
const { redisClient, getIsRedisHealthy } = require('../services/redis');
const { broadcastEvent } = require('../services/telemetry');

/**
 * Resolves a stable identifier for the caller. Prefers an API key header
 * if present (so authenticated clients get their own bucket), falling
 * back to the request's IP address.
 * @param {import('express').Request} req
 */
function resolveClientId(req) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey) return `key:${apiKey}`;
  return `ip:${req.ip}`;
}

/**
 * Factory that produces an Express middleware enforcing a sliding-window
 * rate limit.
 *
 * @param {Object} options
 * @param {number} options.windowMs   - Size of the sliding window, in milliseconds.
 * @param {number} options.maxRequests - Max requests permitted per window.
 * @param {string} [options.keyPrefix] - Redis key namespace prefix.
 * @returns {import('express').RequestHandler}
 */
function hawkLimiter({ windowMs, maxRequests, keyPrefix = 'hawk' }) {
  if (!windowMs || !maxRequests) {
    throw new Error('hawkLimiter requires both windowMs and maxRequests');
  }

  return async function hawkLimiterMiddleware(req, res, next) {
    const clientId = resolveClientId(req);
    const redisKey = `${keyPrefix}:${clientId}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Fast fail-open: skip Redis entirely if we already know it's down,
    // rather than paying for a doomed round-trip on every request.
    if (!getIsRedisHealthy()) {
      console.error(
        `[hawkLimiter] Redis unhealthy — failing open for ${clientId}`
      );
      return next();
    }

    try {
      // A unique member per request prevents same-millisecond collisions
      // from being deduplicated by the sorted set.
      const member = `${now}-${crypto.randomBytes(4).toString('hex')}`;

      // --- Atomic pipeline: evict expired entries, then count. ---
      const pipeline = redisClient.pipeline();
      pipeline.zremrangebyscore(redisKey, 0, windowStart);
      pipeline.zcard(redisKey);
      const pipelineResults = await pipeline.exec();

      // pipeline.exec() resolves to an array of [err, result] tuples.
      const [zremErr] = pipelineResults[0];
      const [zcardErr, currentCount] = pipelineResults[1];
      if (zremErr) throw zremErr;
      if (zcardErr) throw zcardErr;

      const remaining = Math.max(maxRequests - currentCount, 0);

      if (currentCount >= maxRequests) {
        // ---- Over the limit: reject with 429 ----
        // Oldest entry in the window tells us when a slot frees up.
        const oldest = await redisClient.zrange(redisKey, 0, 0, 'WITHSCORES');
        const oldestTimestamp = oldest.length ? Number(oldest[1]) : now;
        const retryAfterMs = Math.max(oldestTimestamp + windowMs - now, 0);
        const retryAfterSec = Math.ceil(retryAfterMs / 1000);

        res.set({
          'X-RateLimit-Limit': maxRequests,
          'X-RateLimit-Remaining': 0,
          'Retry-After': retryAfterSec,
        });

        broadcastEvent({
          clientId,
          route: req.originalUrl,
          statusCode: 429,
          allowed: false,
          windowCount: currentCount,
          limit: maxRequests,
        });

        return res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit of ${maxRequests} requests per ${windowMs / 1000}s exceeded.`,
          retryAfterSeconds: retryAfterSec,
        });
      }

      // ---- Under the limit: record this request and let it through ----
      const recordPipeline = redisClient.pipeline();
      recordPipeline.zadd(redisKey, now, member);
      // TTL slightly larger than the window so idle keys expire on their
      // own instead of accumulating in Redis forever.
      recordPipeline.expire(redisKey, Math.ceil(windowMs / 1000) + 1);
      await recordPipeline.exec();

      const newCount = currentCount + 1;

      res.set({
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': Math.max(maxRequests - newCount, 0),
      });

      broadcastEvent({
        clientId,
        route: req.originalUrl,
        statusCode: 200,
        allowed: true,
        windowCount: newCount,
        limit: maxRequests,
      });

      return next();
    } catch (err) {
      // ---- Fail-open on any Redis/runtime error ----
      console.error(`[hawkLimiter] error, failing open: ${err.message}`);
      return next();
    }
  };
}

module.exports = hawkLimiter;
