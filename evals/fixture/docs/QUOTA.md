# Quota policy (the only spec — read this before implementing quotas)

- API-key clients get a daily quota of 1000 requests per key.
- Quota windows are UTC calendar days (`YYYY-MM-DD`).
- Anonymous clients have no quota, only the rate limiter.
- Exceeding quota returns `{ allowed: false, reason: "quota" }`.
- The counter key is `quota:<apiKey>:<day>` in the store.
- Counting a request and checking the quota must be one store call
  (`checkAndIncrement`), never read-then-write.
