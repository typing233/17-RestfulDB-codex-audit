import { Request, Response, NextFunction } from 'express';
import { Config } from '../config';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export function createRateLimiter(config: Config['rateLimit']) {
  if (!config.enabled) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  const buckets = new Map<string, TokenBucket>();
  const { windowMs, maxRequests } = config;
  const refillRate = maxRequests / windowMs;

  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastRefill > windowMs * 2) {
        buckets.delete(key);
      }
    }
  }, windowMs);

  return (req: Request, res: Response, next: NextFunction) => {
    const key = config.keyBy === 'role' ? (req.dbRole || req.ip || 'unknown') : (req.ip || 'unknown');
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: maxRequests, lastRefill: now };
      buckets.set(key, bucket);
    }

    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(maxRequests, bucket.tokens + elapsed * refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      const retryAfter = Math.ceil((1 - bucket.tokens) / refillRate / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      });
      return;
    }

    bucket.tokens -= 1;
    next();
  };
}
