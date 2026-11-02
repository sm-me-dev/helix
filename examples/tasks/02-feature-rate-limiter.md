# Feature: Token Bucket Rate Limiter Tier Support

## Objective

Implement tiered rate-limiting in `src/limiter.ts`.

## Requirements

1. Support standard tiers: `anonymous` (10 req/min), `user` (100 req/min), and `enterprise` (1000 req/min).
2. Export `class TieredTokenBucketLimiter` implementing `acquire(key: string, tier: string): boolean`.
3. Add unit tests in `src/limiter.test.ts` covering bucket replenishment and burst limits.
4. Ensure all gate checks pass cleanly: `npm run lint && npm run typecheck && npm test`.
