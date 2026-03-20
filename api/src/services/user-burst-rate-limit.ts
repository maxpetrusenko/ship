type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const namespaces = new Map<string, Map<string, RateLimitEntry>>();

export type UserBurstRateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export function consumeUserBurstRateLimit(
  namespace: string,
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): UserBurstRateLimitResult {
  const bucket = namespaces.get(namespace) ?? new Map<string, RateLimitEntry>();
  namespaces.set(namespace, bucket);

  const existing = bucket.get(key);
  if (!existing || now >= existing.resetAt) {
    bucket.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      limit: max,
      remaining: Math.max(0, max - 1),
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  if (existing.count >= max) {
    return {
      allowed: false,
      limit: max,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    limit: max,
    remaining: Math.max(0, max - existing.count),
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

export function resetUserBurstRateLimit(namespace?: string): void {
  if (namespace) {
    namespaces.delete(namespace);
    return;
  }

  namespaces.clear();
}
